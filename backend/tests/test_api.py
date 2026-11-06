"""D2 验证测试：TestClient 走完整 HTTP 层，桩模式（IDENTIFIER=stub）无需权重。

覆盖：
  1. /analyze 四场景（plant_identify / graft_screen 含 recommend+unknown / graft_aftercare / recovery_track）
  2. 追踪管理端点（建追踪、查记录、趋势判定）
  3. 社区端点（发帖、列表、详情、评论、点赞）
  4. 参数错误分支（坏 task_type、缺图、坏图）

运行：
  cd backend && IDENTIFIER=stub python tests/test_api.py
"""
import io
import json
import os
import sys
import tempfile
import uuid

os.environ["IDENTIFIER"] = "stub"
os.environ["APP_DB"] = os.path.join(tempfile.mkdtemp(), "test_api.db")

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)

FAILS = []


def check(name: str, cond: bool, detail: str = ""):
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def jpg_bytes(seed: int = 0) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (60 + seed, 120, 40)).save(buf, "JPEG")
    return buf.getvalue()


# 1) health
r = client.get("/health")
check("health 200", r.status_code == 200 and r.json()["identifier"] == "stub", r.text)

# 2) plant_identify：stub 的分支都应给 info 决策
r = client.post("/analyze", data={"task_type": "plant_identify"},
                files={"image": ("a.jpg", jpg_bytes(1), "image/jpeg")})
body = r.json()
check("plant_identify 200", r.status_code == 200, r.text)
check("plant_identify 字段齐全",
      all(k in body for k in ("species", "disease", "suggestion", "decision"))
      and body["decision"]["code"] == "info", json.dumps(body, ensure_ascii=False))

# 3) graft_screen：同品种 + 温土参数拉高兼容分（70+18=88>=80），
#    扫多组种子覆盖 recommend（双健康）/ cautious（有病害）
codes = set()
for i in range(12):
    r = client.post(
        "/analyze",
        data={"task_type": "graft_screen", "scion_variety": "番茄", "rootstock_variety": "番茄",
              "temperature": "25", "soil_type": "疏松"},
        files={"scion_image": ("s.jpg", jpg_bytes(i), "image/jpeg"),
               "rootstock_image": ("r.jpg", jpg_bytes(i + 50), "image/jpeg")},
    )
    if r.status_code != 200:
        codes.add(f"HTTP{r.status_code}")
        continue
    codes.add(r.json()["decision"]["code"])
check("graft_screen 200 且五档里至少命中 2 档", len([c for c in codes if not c.startswith("HTTP")]) >= 2, str(codes))

# 4) graft_screen unknown 分支（种子图中 h%4==3 的图走回落）
#    用多种子扫到 unsupported 组合
found_unknown = False
for i in range(30, 70):
    r = client.post(
        "/analyze",
        data={"task_type": "graft_screen", "scion_variety": "不存在的品种", "rootstock_variety": "不存在的品种"},
        files={"scion_image": ("s.jpg", jpg_bytes(i), "image/jpeg"),
               "rootstock_image": ("r.jpg", jpg_bytes(i + 50), "image/jpeg")},
    )
    if r.status_code == 200 and r.json()["decision"]["code"] == "cautious" \
            and "覆盖范围" in r.json()["decision"]["explanation"]:
        found_unknown = True
        break
check("graft_screen unknown 分支", found_unknown)

# 5) graft_aftercare
r = client.post("/analyze", data={"task_type": "graft_aftercare"},
                files={"image": ("a.jpg", jpg_bytes(1), "image/jpeg")})
check("graft_aftercare 200", r.status_code == 200 and "suggestion" in r.json(), r.text)

# 6) recovery_track：建追踪 -> 三次记录验证好转
r = client.post("/tracks", data={"name": "番茄 · 测试盆", "crop": "番茄"})
tid = r.json()["track_id"]
check("创建追踪", r.status_code == 200 and len(tid) == 12, r.text)

# 用固定图的桩置信度做趋势：直接 monkeypatch db 层入库太假，这里借桩哈希递减不可控，
# 改为直接调 add_track_record 构造确定性趋势，再验证 /tracks/{id} 的判定。
from app import db as dbm  # noqa: E402
dbm.add_track_record(tid, "2026-10-01", {"label": "番茄 (Tomato)"},
                     {"label": "diseased", "name": "Early Blight", "confidence": 0.9}, None)
dbm.add_track_record(tid, "2026-10-10", {"label": "番茄 (Tomato)"},
                     {"label": "diseased", "name": "Early Blight", "confidence": 0.7}, None)
r = client.get(f"/tracks/{tid}")
body = r.json()
check("追踪记录查询", r.status_code == 200 and len(body["records"]) == 2, r.text)
check("趋势判定-好转", body["verdict"] == "好转", json.dumps(body, ensure_ascii=False))

# 7) recovery_track 上传追加
r = client.post("/analyze", data={"task_type": "recovery_track", "track_id": tid},
                files={"image": ("a.jpg", jpg_bytes(2), "image/jpeg")})
body = r.json()
check("recovery_track 200", r.status_code == 200, r.text)
check("recovery_track 返回趋势",
      body.get("track_id") == tid and len(body.get("trend", [])) == 3
      and body.get("verdict") in ("好转", "恶化", "持平", "波动", "建立基线"),
      json.dumps(body, ensure_ascii=False))

# 8) recovery_track 不存在的 track_id
r = client.post("/analyze", data={"task_type": "recovery_track", "track_id": "nope"},
                files={"image": ("a.jpg", jpg_bytes(2), "image/jpeg")})
check("recovery_track 404", r.status_code == 404, r.text)

# 9) 社区
r = client.post("/posts", data={"nickname": "测试员", "title": "D2 测试帖", "body": "内容", "image_emoji": "🌿"})
pid = r.json().get("post_id")
check("发帖", r.status_code == 200 and pid, r.text)
r = client.get("/posts")
check("帖子列表", r.status_code == 200 and any(p["id"] == pid for p in r.json()), r.text)
r = client.post(f"/posts/{pid}/comments", data={"nickname": "路人", "body": "顶"})
check("评论", r.status_code == 200, r.text)
r = client.get(f"/posts/{pid}")
check("详情含评论", r.status_code == 200 and len(r.json()["comments"]) == 1, r.text)
r = client.post(f"/posts/{pid}/like")
check("点赞", r.status_code == 200 and r.json()["likes"] == 1, r.text)

# 10) 错误分支
r = client.post("/analyze", data={"task_type": "bad"}, files={"image": ("a.jpg", jpg_bytes(1), "image/jpeg")})
check("坏 task_type 400", r.status_code == 400, r.text)
r = client.post("/analyze", data={"task_type": "plant_identify"},
                files={"image": ("a.jpg", b"not-an-image", "image/jpeg")})
check("坏图 400", r.status_code == 400, r.text)
r = client.post("/analyze", data={"task_type": "graft_screen", "scion_variety": "x", "rootstock_variety": "y"},
                files={"scion_image": ("s.jpg", jpg_bytes(1), "image/jpeg")})
check("graft_screen 缺图 400", r.status_code == 400, r.text)

print()
if FAILS:
    print(f"RESULT: {len(FAILS)} FAILED -> {FAILS}")
    sys.exit(1)
print("RESULT: ALL PASS")
