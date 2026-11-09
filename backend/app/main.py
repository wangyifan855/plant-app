"""FastAPI 入口。

POST /analyze：单一端点，task_type 区分四场景（文档 §6）：
  plant_identify   单图：物种 + 病害 + 建议
  graft_screen     双图 + 品种：病害 + 兼容分 + 五档决策
  graft_aftercare  单图：同 plant_identify，文案强调"嫁后异常可能原因"
  recovery_track   单图 + track_id：识别入库 + 趋势判定

社区与追踪端点（文档 §12，与 /analyze 解耦）：
  POST /tracks | GET /tracks | GET /tracks/{id}
  POST /posts  | GET /posts  | GET /posts/{id} | POST /posts/{id}/comments | POST /posts/{id}/like
GET /health 健康检查。
"""
import os
import io
import uuid
from datetime import date
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from PIL import Image

from . import config, models, predict, compatibility, fusion, db
from . import care as care_kb
from . import weather as weather_provider
from .advice import get_suggestion

app = FastAPI(title="GraftCheck API", version="2.0")

# React Native 的 fetch 不像浏览器卡 CORS 预检，加 * 无害
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 启动时后台预热天气缓存，避免第一个 /home 卡在网络上
@app.on_event("startup")
def _warm_weather():
    weather_provider.warmup()


# 启动时加载一次：配置、识别器（桩或真模型）、数据库 + 种子
VARIETIES_DATA, VARIETIES_BY_NAME = config.load_varieties()
# 识别器/手填用的作物俗称 -> 品种库标准名（库里辣椒叫甜椒、橙子叫柑橘）
_VARIETY_ALIAS = {"辣椒": "甜椒", "橙子": "柑橘"}
FUSION_RULES = config.load_fusion_rules()
IDENTIFIER = predict.build_identifier()
db.init_db()
db.seed_if_empty()

MAX_BYTES = 10 * 1024 * 1024  # 后端硬上限 10MB
TASK_TYPES = {"plant_identify", "graft_screen", "graft_aftercare", "recovery_track"}


async def _read_image(data: bytes, name: str) -> None:
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="图片过大，最大 10MB")
    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception:
        raise HTTPException(status_code=400, detail=f"{name}图片格式不支持，仅支持 jpg/png")


@app.get("/")
def index():
    # 根路径直接跳到网页测试台，避免打开根 URL 看到 JSON 404 而误以为"打不开"
    return RedirectResponse(url="/test/live_test.html")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "identifier": os.environ.get("IDENTIFIER", os.environ.get("PREDICTOR", "stub")),
        "disease_gate": getattr(IDENTIFIER, "GATE", None),
    }


@app.get("/varieties")
def varieties():
    """品种列表（下拉框数据源，与 config/varieties.json 单数据源一致）。"""
    return VARIETIES_DATA.get("varieties", [])


# 网页测试台：把 prototype/ 目录挂到 /test 下，
# 访问 http://127.0.0.1:8000/test/live_test.html 即可（仅本地调试用）。
_PROTO_DIR = Path(__file__).resolve().parent.parent.parent / "prototype"
if _PROTO_DIR.is_dir():
    app.mount("/test", StaticFiles(directory=str(_PROTO_DIR)), name="test")

# 花园植物照片：存 backend/data/uploads/，通过 /files/uploads/ 访问
_UPLOAD_DIR = Path(__file__).resolve().parent.parent / "data" / "uploads"
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=str(_UPLOAD_DIR.parent)), name="files")

# 管理员后台网页：把 backend/admin/ 挂到 /admin 下，
# 访问 http://127.0.0.1:8000/admin/ 进入（仅 admin 账号可用）。
_ADMIN_DIR = Path(__file__).resolve().parent.parent / "admin"
if _ADMIN_DIR.is_dir():
    app.mount("/admin", StaticFiles(directory=str(_ADMIN_DIR), html=True), name="admin")


def get_optional_user(authorization: str = Header(None)) -> dict | None:
    """有些接口登录与否都可用（发帖/点赞/识别），登录了就带上身份。"""
    if authorization and authorization.startswith("Bearer "):
        return db.get_user_by_token(authorization[7:].strip())
    return None


@app.post("/analyze")
async def analyze(
    task_type: str = Form(...),
    image: UploadFile | None = File(None),
    scion_image: UploadFile | None = File(None),
    rootstock_image: UploadFile | None = File(None),
    scion_variety: str = Form(None),
    rootstock_variety: str = Form(None),
    temperature: str = Form(None),
    soil_type: str = Form(None),
    track_id: str = Form(None),
    note: str = Form(None),
    plant_id: int | None = Form(None),
    user: dict | None = Depends(get_optional_user),
):
    if task_type not in TASK_TYPES:
        raise HTTPException(status_code=400, detail=f"task_type 必须是 {'/'.join(sorted(TASK_TYPES))}")

    # ---------- 嫁接前初筛（双图，保持 v1 流程 + unknown 分支） ----------
    if task_type == "graft_screen":
        if scion_image is None or rootstock_image is None:
            raise HTTPException(status_code=400, detail="graft_screen 需要 scion_image 与 rootstock_image")
        sb = await scion_image.read()
        rb = await rootstock_image.read()
        await _read_image(sb, "接穗")
        await _read_image(rb, "砧木")

        def _identify_of(raw: bytes):
            return IDENTIFIER.identify(raw)

        sr = _identify_of(sb)
        rr = _identify_of(rb)
        disease = models.DiseaseBlock(
            scion=models.DiseaseResult(label=sr["disease"]["label"], confidence=sr["disease"]["confidence"]),
            rootstock=models.DiseaseResult(label=rr["disease"]["label"], confidence=rr["disease"]["confidence"]),
        )

        # 品种：手选优先；不选则从照片自动推断（病害模型认出 14 种作物即得品种）
        def _resolve_variety(user_input: str, ident: dict) -> models.VarietiesUsed:
            name = (user_input or "").strip()
            if name:
                return models.VarietiesUsed(name=name, source="manual")
            crop = ident.get("crop")
            if crop and ident.get("supported"):
                zh = predict.crop_zh(crop)
                if zh != crop:  # 认出了收录作物
                    return models.VarietiesUsed(name=zh, source="auto")
            return models.VarietiesUsed(name=None, source="none")

        sv_used = _resolve_variety(scion_variety, sr)
        rv_used = _resolve_variety(rootstock_variety, rr)
        sv = VARIETIES_BY_NAME.get(_VARIETY_ALIAS.get(sv_used.name, sv_used.name)) if sv_used.name else None
        rv = VARIETIES_BY_NAME.get(_VARIETY_ALIAS.get(rv_used.name, rv_used.name)) if rv_used.name else None
        compat = compatibility.score_compatibility(sv, rv, temperature, soil_type)
        decision = fusion.decide(disease.model_dump(), compat, FUSION_RULES)
        return models.GraftResponse(
            disease=disease,
            compatibility=models.CompatibilityResult(**compat),
            decision=models.DecisionResult(**decision),
            varieties=models.VarietiesUsedBlock(scion=sv_used, rootstock=rv_used),
        )

    # ---------- 单图三场景共用的识别 ----------
    if image is None:
        raise HTTPException(status_code=400, detail=f"{task_type} 需要 image 字段")
    raw = await image.read()
    await _read_image(raw, "图片")
    result = IDENTIFIER.identify(raw)
    species = models.SpeciesResult(**result["species"])
    disease = models.DiseaseInfo(**result["disease"])

    if task_type in ("plant_identify", "graft_aftercare"):
        # 识别即存档：诊断历史（最近诊断列表、花园健康度都靠它）；
        # 照片与完整结果一并入库，供「最近诊断」点开回看
        suggestion = get_suggestion(disease.label, disease.name, result["supported"])
        if task_type == "graft_aftercare" and disease.label != "healthy":
            suggestion = (
                f"嫁接后出现异常，{suggestion} 另请检查绑扎是否过紧、接口是否积水，"
                "这些非病害因素也会导致萎蔫。"
            )
        # 展示层中文化：建议文案按英文原名匹配，先匹配完再翻译病名
        if disease.name:
            disease = disease.model_copy(update={"name": predict.disease_zh(disease.name)})
        candidates = [
            models.Candidate(**c) for c in (result.get("candidates") or [])
        ]
        if result.get("low_confidence"):
            alt = ""
            if candidates:
                alts = "、".join(f"{c.label}（{c.confidence:.0%}）" for c in candidates)
                alt = f"\n其他相似疑似：{alts}。请结合叶片症状复核，或补拍单叶特写重试。"
            suggestion = (
                f"注意：这张图识别置信度偏低（{disease.confidence:.0%}），"
                "结果供参考，建议补拍一张单叶特写再确认。\n" + suggestion + alt
            )
        try:
            image_url = _save_diag_photo(raw)
        except HTTPException:
            image_url = None
        db.log_diagnosis(
            user["id"] if user else None,
            care_kb.crop_from_species_label(result["species"].get("label")),
            result["species"], result["disease"],
            bool(result.get("low_confidence")),
            suggestion=suggestion,
            candidates=[c.model_dump() for c in candidates],
            image_url=image_url,
        )
        # 从植物档案点「拍照记录」进来：这次结果要落到这株植物的健康追踪里，
        # 否则档案页的历史诊断记录看不到新拍的这张（用户反馈过）。
        linked = None
        if plant_id and user and task_type == "plant_identify":
            plant = db.get_plant(plant_id, user["id"])
            if plant:
                track_of_plant = plant.get("track_id")
                if not track_of_plant:
                    track_of_plant = uuid.uuid4().hex[:12]
                    db.create_track(track_of_plant, plant["nickname"], plant.get("crop"))
                    db.set_plant_track(plant["id"], user["id"], track_of_plant)
                # 追踪记录里的病名统一用中文，档案页展示才一致
                rec_disease = dict(result["disease"])
                if rec_disease.get("name"):
                    rec_disease["name"] = predict.disease_zh(rec_disease["name"])
                else:
                    rec_disease["name"] = {
                        "healthy": "健康", "diseased": "病害", "unknown": "未知",
                    }.get(rec_disease.get("label"), "未知")
                db.add_track_record(track_of_plant, date.today().isoformat(),
                                    result["species"], rec_disease, note)
                linked = models.LinkedPlant(
                    plant_id=plant["id"],
                    plant_name=plant["nickname"],
                    track_id=track_of_plant,
                )
        return models.IdentifyResponse(
            species=species,
            disease=disease,
            suggestion=suggestion,
            candidates=candidates,
            decision=models.SimpleDecision(
                code="low_confidence" if result.get("low_confidence") else "info",
                label="低置信度识别" if result.get("low_confidence") else "识别结果",
            ),
            linked_plant=linked,
        )

    # ---------- recovery_track：识别入库 + 趋势 ----------
    if not track_id:
        raise HTTPException(status_code=400, detail="recovery_track 需要 track_id")
    if not db.track_exists(track_id):
        raise HTTPException(status_code=404, detail=f"追踪 {track_id} 不存在，请先创建")
    # 追踪分支不走建议文案，入库前就把病名翻成中文，趋势展示一致
    if result["disease"].get("name"):
        result["disease"]["name"] = predict.disease_zh(result["disease"]["name"])
    else:
        # 模型没把握（unknown）或只回了 label 没回 name 时，按 label 兜底，
        # 避免 track_records.disease_name 落 NULL → 前端历史记录显示“未知”。
        _fb = {"healthy": "健康", "diseased": "病害", "unknown": "未知"}.get(
            result["disease"].get("label"), "未知")
        result["disease"]["name"] = _fb
    disease = models.DiseaseInfo(**result["disease"])
    # 追踪照片留档（压到 720px 存 uploads），记录详情页可回看
    try:
        track_image_url = _save_diag_photo(raw)
    except HTTPException:
        track_image_url = None
    record_id = db.add_track_record(
        track_id, date.today().isoformat(), result["species"], result["disease"], note,
        track_image_url,
    )
    records = db.get_track_records(track_id)
    verdict, explanation = db.trend_verdict(records)
    return models.TrackResponse(
        track_id=track_id,
        record_id=record_id,
        current=models.CurrentBlock(
            date=date.today().isoformat(),
            species=species,
            disease=disease,
        ),
        trend=[
            models.TrackPoint(date=r["date"], disease_confidence=r["disease_confidence"])
            for r in records
        ],
        verdict=verdict,
        explanation=explanation,
    )


# ---------- 追踪管理 ----------

@app.post("/tracks")
def create_track(name: str = Form(...), crop: str = Form(None)):
    track_id = uuid.uuid4().hex[:12]
    return db.create_track(track_id, name, crop)


@app.get("/tracks")
def list_tracks():
    return db.list_tracks()


@app.get("/tracks/{track_id}")
def get_track(track_id: str):
    if not db.track_exists(track_id):
        raise HTTPException(status_code=404, detail="追踪不存在")
    records = db.get_track_records(track_id)
    verdict, explanation = db.trend_verdict(records)
    return {
        "track_id": track_id,
        "records": [
            {
                "id": r["id"],
                "date": r["date"],
                "species_label": r["species_label"],
                "disease_label": r["disease_label"],
                "disease_name": r["disease_name"],
                "disease_confidence": r["disease_confidence"],
                "note": r["note"],
                "image_url": r.get("image_url"),
            }
            for r in records
        ],
        "verdict": verdict,
        "explanation": explanation,
    }


# ---------- 社区（匿名） ----------

# ---------- 用户认证 ----------

def get_current_user(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录或缺少 token")
    user = db.get_user_by_token(authorization[7:].strip())
    if user is None:
        raise HTTPException(status_code=401, detail="token 无效或已过期")
    return user


def get_current_admin(authorization: str = Header(None)) -> dict:
    """仅管理员角色可过的依赖；否则 401/403。"""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录或缺少 token")
    user = db.get_user_by_token(authorization[7:].strip())
    if user is None:
        raise HTTPException(status_code=401, detail="token 无效或已过期")
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


@app.post("/auth/register")
def auth_register(username: str = Form(...), password: str = Form(...)):
    username = username.strip()
    if not username or not password:
        raise HTTPException(status_code=400, detail="用户名和密码都不能为空")
    if len(username) > 32 or len(password) < 4:
        raise HTTPException(status_code=400, detail="用户名≤32字，密码至少4位")
    try:
        uid = db.create_user(username, password)
    except ValueError:
        raise HTTPException(status_code=409, detail="用户名已存在")
    token = db.create_session(uid)
    return {"token": token, "user_id": uid, "username": username}


@app.post("/auth/login")
def auth_login(username: str = Form(...), password: str = Form(...)):
    uid, reason = db.verify_user(username.strip(), password)
    if uid is None:
        detail = "用户名不存在" if reason == "no_user" else "密码错误"
        raise HTTPException(status_code=401, detail=detail)
    token = db.create_session(uid)
    return {"token": token, "user_id": uid, "username": username.strip()}


@app.post("/auth/demo")
def auth_demo():
    """演示账号一键进入：demo / 1234，首次进入自动种一园示例植物。"""
    uid = db.ensure_demo_user()
    db.seed_demo_garden(uid)
    token = db.create_session(uid)
    return {"token": token, "user_id": uid, "username": "demo"}


@app.post("/auth/logout")
def auth_logout(user: dict = Depends(get_current_user), authorization: str = Header(None)):
    db.delete_session(authorization[7:].strip())
    return {"ok": True}


@app.get("/auth/me")
def auth_me(user: dict = Depends(get_current_user)):
    return user


@app.post("/auth/change-username")
def auth_change_username(new_username: str = Form(...), user: dict = Depends(get_current_user)):
    new_username = new_username.strip()
    if not new_username:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    if len(new_username) > 32:
        raise HTTPException(status_code=400, detail="用户名过长（≤32字）")
    db.update_username(user["id"], new_username)
    return {"ok": True, "username": new_username}


@app.post("/auth/change-password")
def auth_change_password(
    old_password: str = Form(...),
    new_password: str = Form(...),
    user: dict = Depends(get_current_user),
):
    if not old_password or not new_password:
        raise HTTPException(status_code=400, detail="旧密码和新密码都不能为空")
    if len(new_password) < 4:
        raise HTTPException(status_code=400, detail="新密码至少 4 位")
    try:
        db.update_password(user["id"], old_password, new_password)
    except ValueError as e:
        if str(e) == "bad_old":
            raise HTTPException(status_code=400, detail="旧密码错误")
        raise HTTPException(status_code=400, detail="修改失败")
    return {"ok": True}


# ---------- 管理员后台（仅 admin 角色，接口统一挂在 /api/admin 下） ----------

@app.get("/api/admin/stats")
def admin_stats(user: dict = Depends(get_current_admin)):
    return db.get_admin_stats()


@app.get("/api/admin/users")
def admin_users(user: dict = Depends(get_current_admin)):
    return db.list_users_admin()


@app.delete("/api/admin/users/{uid}")
def admin_delete_user(uid: int, user: dict = Depends(get_current_admin)):
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="不能删除自己的账号")
    if not db.delete_user_admin(uid):
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"ok": True}


@app.post("/api/admin/users/{uid}/role")
def admin_set_role(uid: int, role: str = Form(...), user: dict = Depends(get_current_admin)):
    """授予 / 收回管理员权限。不能改自己的角色，避免误操作把自己降级后没人管理。"""
    if uid == user["id"]:
        raise HTTPException(status_code=400, detail="不能修改自己的角色")
    try:
        ok = db.set_user_role(uid, role)
    except ValueError:
        raise HTTPException(status_code=400, detail="无效角色")
    if not ok:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"ok": True, "role": role}


@app.get("/api/admin/posts")
def admin_posts(user: dict = Depends(get_current_admin)):
    return db.list_posts_admin()


@app.delete("/api/admin/posts/{pid}")
def admin_delete_post(pid: int, user: dict = Depends(get_current_admin)):
    if not db.delete_post_admin(pid):
        raise HTTPException(status_code=404, detail="帖子不存在")
    return {"ok": True}


@app.post("/api/admin/posts/{pid}/takedown")
def admin_takedown_post(pid: int, reason: str = Form(...), user: dict = Depends(get_current_admin)):
    """下架帖子：需填原因，并给作者发一条系统通知。"""
    reason = reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="请填写下架原因")
    r = db.takedown_post_admin(pid, reason)
    if r is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    if r["user_id"]:
        db.add_notification(
            r["user_id"], None, "system", pid,
            f"你的帖子「{r['title']}」因「{reason}」被管理员下架，如有疑问请联系管理员",
        )
    return {"ok": True}


@app.post("/api/admin/posts/{pid}/restore")
def admin_restore_post(pid: int, user: dict = Depends(get_current_admin)):
    if not db.restore_post_admin(pid):
        raise HTTPException(status_code=404, detail="帖子不存在")
    return {"ok": True}


@app.delete("/api/admin/comments/{cid}")
def admin_delete_comment(cid: int, user: dict = Depends(get_current_admin)):
    if not db.delete_comment_admin(cid):
        raise HTTPException(status_code=404, detail="评论不存在")
    return {"ok": True}


# ---------- 我的花园 ----------

@app.get("/garden")
def garden_list(user: dict = Depends(get_current_user)):
    return db.garden_with_status(user["id"])


@app.get("/garden/{plant_id}")
def garden_detail(plant_id: int, user: dict = Depends(get_current_user)):
    plant = db.get_plant(plant_id, user["id"])
    if plant is None:
        raise HTTPException(status_code=404, detail="植物不存在或不属于你")
    records = db.get_track_records(plant["track_id"]) if plant["track_id"] else []
    # 追踪记录倒序展示（最新在前），顺带补一份趋势判定
    records_desc = list(reversed(records))
    # 病名中文化：库里存的是模型英文类名，档案页要跟识别页一样显示中文
    for r in records_desc:
        zh = predict.disease_zh(r.get("disease_name"))
        if zh:
            r["disease_name"] = zh
        elif not r.get("disease_name"):
            r["disease_name"] = {"healthy": "健康", "diseased": "病害"}.get(
                r.get("disease_label"), "未知")
    verdict, explanation = db.trend_verdict(records)
    return {
        "plant": plant,
        "records": records_desc,
        "verdict": verdict,
        "verdict_explanation": explanation,
        "care": care_kb.get_care(plant["crop"]),
    }


@app.post("/garden")
def garden_add(
    user: dict = Depends(get_current_user),
    nickname: str = Form(...),
    crop: str = Form(None),
    photo_emoji: str = Form(None),
    planted_date: str = Form(None),
    notes: str = Form(None),
):
    nickname = nickname.strip()
    if not nickname:
        raise HTTPException(status_code=400, detail="植物昵称不能为空")
    plant_id = db.add_plant(user["id"], nickname, crop, photo_emoji, planted_date, notes)
    return {"plant_id": plant_id}


def _save_diag_photo(data: bytes) -> str:
    """诊断照片：最长边压到 720px，存 uploads/，返回 /files/uploads/ 相对路径。"""
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="图片格式不支持，仅支持 jpg/png")
    img.thumbnail((720, 720))
    name = f"diag_{uuid.uuid4().hex[:12]}.jpg"
    img.save(_UPLOAD_DIR / name, "JPEG", quality=85)
    return f"/files/uploads/{name}"


def _save_plant_photo(data: bytes, plant_id: int, user_id: int) -> str:
    """统一转 JPEG：最长边压到 640px，存 uploads/，返回 /files/uploads/ 相对路径。"""
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="图片格式不支持，仅支持 jpg/png")
    img.thumbnail((640, 640))
    name = f"plant_{user_id}_{plant_id}_{uuid.uuid4().hex[:8]}.jpg"
    img.save(_UPLOAD_DIR / name, "JPEG", quality=85)
    return f"/files/uploads/{name}"


def _save_avatar_photo(data: bytes, user_id: int) -> str:
    """用户头像：压到 256px 方图（前端用 borderRadius 裁圆展示）。"""
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="图片格式不支持，仅支持 jpg/png")
    img.thumbnail((256, 256))
    name = f"avatar_{user_id}_{uuid.uuid4().hex[:8]}.jpg"
    img.save(_UPLOAD_DIR / name, "JPEG", quality=85)
    return f"/files/uploads/{name}"


@app.post("/garden/{plant_id}/photo")
async def garden_upload_photo(plant_id: int, user: dict = Depends(get_current_user),
                              photo: UploadFile = File(...)):
    """上传/更换植物头像照片。覆盖式：旧文件保留（原型阶段不做清理）。"""
    if db.get_plant(plant_id, user["id"]) is None:
        raise HTTPException(status_code=404, detail="植物不存在或不属于你")
    data = await photo.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="图片过大，最大 10MB")
    photo_url = _save_plant_photo(data, plant_id, user["id"])
    db.set_plant_photo(plant_id, user["id"], photo_url)
    return {"photo_url": photo_url}


@app.delete("/garden/{plant_id}")
def garden_delete(plant_id: int, user: dict = Depends(get_current_user)):
    if not db.delete_plant(plant_id, user["id"]):
        raise HTTPException(status_code=404, detail="植物不存在或不属于你")
    return {"ok": True}


@app.post("/garden/{plant_id}/track")
def garden_create_track(plant_id: int, user: dict = Depends(get_current_user)):
    plant = db.get_plant(plant_id, user["id"])
    if plant is None:
        raise HTTPException(status_code=404, detail="植物不存在或不属于你")
    # 已有追踪就直接复用，别每次点都新建一条（会造出一堆重复追踪）
    if plant.get("track_id"):
        return {"track_id": plant["track_id"]}
    track_id = uuid.uuid4().hex[:12]
    db.create_track(track_id, plant["nickname"], plant["crop"])
    db.set_plant_track(plant_id, user["id"], track_id)
    return {"track_id": track_id}


# ---------- 首页聚合：天气 / 健康度 / 待办 ----------

# 天气走 app/weather.py：Open-Meteo 真实天气。
# 前端给了 lat/lon 就用真实定位，没给就按出口 IP 定位；都失败时退回演示数据。
@app.get("/weather")
def weather(lat: float | None = Query(None), lon: float | None = Query(None)):
    return weather_provider.get_weather(lat, lon)


@app.get("/home")
def home_page(
    lat: float | None = Query(None),
    lon: float | None = Query(None),
    user: dict | None = Depends(get_optional_user),
):
    uid = user["id"] if user else None
    return {
        "weather": weather_provider.get_weather(lat, lon),
        "garden": db.home_summary(uid),
        "plants": db.garden_with_status(uid) if uid else [],
    }


@app.get("/todos")
def todos(user: dict = Depends(get_current_user)):
    """今日任务清单（全量）。"""
    return {"todos": db.garden_todos(user["id"])}


# ---------- 照养指南 ----------

@app.get("/care/{crop}")
def care_guide(crop: str):
    return care_kb.get_care(crop)


# ---------- 诊断历史 ----------

@app.get("/diagnoses/recent")
def diagnoses_recent(
    limit: int = Query(10, ge=1, le=30),
    user: dict | None = Depends(get_optional_user),
):
    uid = user["id"] if user else None
    return db.recent_diagnoses(uid, limit)


@app.get("/diagnoses/{diagnosis_id}")
def diagnosis_detail(diagnosis_id: int):
    """单条诊断记录回看（照片 + 完整结果）。旧记录缺建议文案时现场补一条。"""
    d = db.get_diagnosis(diagnosis_id)
    if d is None:
        raise HTTPException(status_code=404, detail="记录不存在")
    if not d.get("suggestion"):
        d["suggestion"] = get_suggestion(
            d.get("disease_label") or "unknown",
            d.get("disease_name"),
            True,
        )
    return d


# ---------- 社交：收藏 / 关注 / 个人资料 ----------

@app.post("/posts/{post_id}/favorite")
def favorite_post(post_id: int, user: dict = Depends(get_current_user)):
    fav = db.toggle_favorite(post_id, user["id"])
    if fav is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    if fav:  # 仅收藏时通知，取消收藏不通知
        owner = db.post_owner(post_id)
        if owner:
            db.add_notification(owner, user["id"], "favorite", post_id,
                                f"收藏了你的帖子「{(db.get_post(post_id) or {}).get('title') or '无标题'}」")
    return {"favorited": fav}


@app.post("/users/{user_id}/follow")
def follow_user(user_id: int, user: dict = Depends(get_current_user)):
    try:
        following = db.toggle_follow(user["id"], user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="不能关注自己")
    if following is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if following:  # 仅新关注时通知
        db.add_notification(user_id, user["id"], "follow", None, "关注了你")
    return {"following": following}


# ---------- 消息通知 ----------

@app.get("/notifications")
def notifications(user: dict = Depends(get_current_user)):
    return {
        "items": db.list_notifications(user["id"]),
        "unread": db.unread_notification_count(user["id"]),
    }


@app.get("/notifications/unread_count")
def notification_unread(user: dict = Depends(get_current_user)):
    return {"unread": db.unread_notification_count(user["id"])}


@app.post("/notifications/read")
def notifications_read(user: dict = Depends(get_current_user)):
    return {"marked": db.mark_notifications_read(user["id"])}


@app.get("/profile")
def profile(user: dict = Depends(get_current_user)):
    return {
        "user": db.profile_summary(user["id"]),
        "posts": db.my_posts(user["id"]),
        "liked_posts": db.liked_posts(user["id"]),
        "favorited_posts": db.favorited_posts(user["id"]),
        "comments": db.my_comments(user["id"]),
    }


# 可选的预置头像（就是前端那张吉祥物的几个造型）。
# 存的是 `preset:<key>` 标记而不是图片文件：服务器不用为每个用户存一份副本，
# 以后换画风前端重打包就行，老用户头像自动跟着变。
AVATAR_PRESETS = {"identify", "graft", "community", "track", "carrot", "cucumber"}


@app.post("/profile/update")
async def profile_update(user: dict = Depends(get_current_user),
                         nickname: str | None = Form(None),
                         avatar: UploadFile | None = File(None),
                         avatar_preset: str | None = Form(None)):
    """更新个人资料：昵称和/或头像（multipart，均可选）。

    头像两种给法：传 avatar 文件（自己上传），或传 avatar_preset 选一个预置造型。
    两个都传时以文件为准。
    """
    avatar_url = None
    if avatar is not None and avatar.filename:
        data = await avatar.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="图片过大，最大 10MB")
        avatar_url = _save_avatar_photo(data, user["id"])
    elif avatar_preset:
        key = avatar_preset.strip()
        if key not in AVATAR_PRESETS:
            raise HTTPException(status_code=400, detail="没有这个预置头像")
        avatar_url = f"preset:{key}"
    if nickname is None and avatar_url is None:
        raise HTTPException(status_code=400, detail="没有要更新的内容")
    try:
        return db.update_user_profile(user["id"], nickname=nickname, avatar_url=avatar_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------- 社区 ----------

def _save_post_image(data: bytes, user_id: int) -> str:
    """帖子图片：最长边压到 1080px，存 uploads/，返回 /files/uploads/ 相对路径。"""
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="图片格式不支持，仅支持 jpg/png")
    img.thumbnail((1080, 1080))
    name = f"post_{user_id}_{uuid.uuid4().hex[:8]}.jpg"
    img.save(_UPLOAD_DIR / name, "JPEG", quality=85)
    return f"/files/uploads/{name}"


@app.post("/posts")
async def create_post(
    title: str = Form(...),
    body: str = Form(...),
    image_emoji: str = Form(None),
    tags: str = Form(None),
    is_public: str = Form("1"),
    images: list[UploadFile] = File([]),
    user: dict = Depends(get_current_user),   # 发帖必须登录，昵称直接取账号昵称
):
    if not title.strip() or not body.strip():
        raise HTTPException(status_code=400, detail="标题和正文都不能为空")
    nickname = (user.get("nickname") or user["username"]).strip()
    # 多图上传：最多 9 张，逐张校验大小并压缩落盘
    image_urls: list[str] = []
    for f in list(images or [])[:9]:
        if not f or not f.filename:
            continue
        data = await f.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="单张图片过大，最大 10MB")
        image_urls.append(_save_post_image(data, user["id"] if user else 0))
    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()][:6]
    post_id = db.create_post(nickname, title.strip(), body.strip(), image_emoji,
                             user["id"] if user else None,
                             images=image_urls, tags=tag_list,
                             is_public=is_public != "0")
    return {"post_id": post_id}


@app.get("/drafts")
def my_drafts(user: dict = Depends(get_current_user)):
    """草稿箱：被管理员下架、作者可以改完重新发的帖子。"""
    return {"items": db.drafts_of_user(user["id"])}


@app.put("/posts/{post_id}")
async def update_post(
    post_id: int,
    title: str = Form(...),
    body: str = Form(...),
    tags: str = Form(None),
    is_public: str = Form("1"),
    keep_images: str = Form(None),      # 保留的旧图相对路径，逗号分隔
    images: list[UploadFile] = File([]),
    user: dict = Depends(get_current_user),
):
    """作者编辑自己（被下架）的帖子，保存即重新发布。"""
    if not title.strip() or not body.strip():
        raise HTTPException(status_code=400, detail="标题和正文都不能为空")
    old = db.get_post(post_id, user["id"], include_takedown=True)
    if old is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    if old.get("user_id") != user["id"]:
        raise HTTPException(status_code=403, detail="只能编辑自己的帖子")

    # 旧图只允许保留原本属于这篇帖子的，避免被塞进任意路径
    old_images = set(old.get("images") or [])
    kept = [u.strip() for u in (keep_images or "").split(",") if u.strip()]
    kept = [u for u in kept if u in old_images][:9]

    new_urls: list[str] = []
    for f in list(images or [])[:9]:
        if not f or not f.filename:
            continue
        data = await f.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail="单张图片过大，最大 10MB")
        new_urls.append(_save_post_image(data, user["id"]))

    final_images = (kept + new_urls)[:9]
    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()][:6]
    ok = db.update_user_post(post_id, user["id"], title.strip(), body.strip(),
                             tag_list, final_images, is_public != "0")
    if not ok:
        raise HTTPException(status_code=403, detail="只能编辑自己的帖子")
    return {"post_id": post_id, "images": final_images}


@app.get("/posts")
def list_posts(limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0),
               user: dict | None = Depends(get_optional_user)):
    return db.list_posts(limit, offset, viewer_id=user["id"] if user else None)


@app.get("/posts/{post_id}")
def get_post(post_id: int, user: dict | None = Depends(get_optional_user)):
    # 管理员可以查看被下架的帖子（便于在 App 里核对后恢复）
    is_admin = bool(user and user.get("role") == "admin")
    post = db.get_post(post_id, user["id"] if user else None, include_takedown=is_admin)
    if post is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    return post


@app.delete("/posts/{post_id}")
def delete_own_post(post_id: int, user: dict = Depends(get_current_user)):
    """作者删除自己的帖子（连带评论/点赞/收藏/相关通知）。"""
    if not db.delete_own_post(post_id, user["id"]):
        raise HTTPException(status_code=404, detail="帖子不存在或无权删除")
    return {"ok": True}


@app.patch("/posts/{post_id}/visibility")
def change_post_visibility(
    post_id: int,
    is_public: int = Query(1, ge=0, le=1),
    user: dict = Depends(get_current_user),
):
    """作者切换自己的帖子是「公开」还是「仅自己可见」。"""
    if not db.set_post_visibility(post_id, user["id"], bool(is_public)):
        raise HTTPException(status_code=404, detail="帖子不存在或无权修改")
    return {"ok": True, "is_public": bool(is_public)}


@app.post("/posts/{post_id}/comments")
def add_comment(
    post_id: int,
    body: str = Form(...),
    user: dict = Depends(get_current_user),   # 评论同样须登录，昵称取账号昵称
):
    if db.get_post(post_id) is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    if not body.strip():
        raise HTTPException(status_code=400, detail="评论内容不能为空")
    nickname = (user.get("nickname") or user["username"]).strip()
    comment_id = db.add_comment(post_id, nickname, body.strip(),
                                user["id"])
    owner = db.post_owner(post_id)
    if owner:
        db.add_notification(owner, user["id"], "comment", post_id,
                            f"评论了你的帖子：{body.strip()[:30]}")
    return {"comment_id": comment_id}


@app.post("/posts/{post_id}/like")
def like_post(post_id: int, user: dict | None = Depends(get_optional_user)):
    # 登录用户：点赞可切换（再点取消）；游客：保留旧的一次性 +1
    if user:
        r = db.toggle_like(post_id, user["id"])
        if r is None:
            raise HTTPException(status_code=404, detail="帖子不存在")
        if r.get("liked"):  # 仅点赞时通知，取消点赞不通知
            owner = db.post_owner(post_id)
            if owner:
                db.add_notification(owner, user["id"], "like", post_id, "赞了你的帖子")
        return r
    likes = db.like_post(post_id)
    if likes is None:
        raise HTTPException(status_code=404, detail="帖子不存在")
    return {"likes": likes}
