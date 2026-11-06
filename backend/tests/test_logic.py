"""D2 验证测试：直接驱动兼容性评分 + 融合决策树，覆盖文档要求的 4 组案例。
不依赖 torch / 模型，纯逻辑验证，桩模式即可跑。

运行：
  cd backend
  python tests/test_logic.py
"""
import json
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

from app.compatibility import score_compatibility  # noqa: E402
from app.fusion import decide  # noqa: E402

with open(os.path.join(PROJECT, "config", "fusion_rules.json"), encoding="utf-8") as f:
    RULES = json.load(f)
with open(os.path.join(PROJECT, "config", "varieties.json"), encoding="utf-8") as f:
    VAR = {v["name"]: v for v in json.load(f)["varieties"]}


def dis(scion_label, scion_conf, root_label, root_conf):
    return {
        "scion": {"label": scion_label, "confidence": scion_conf},
        "rootstock": {"label": root_label, "confidence": root_conf},
    }


def compat(scion_name, root_name, temp=None, soil=None):
    return score_compatibility(VAR.get(scion_name), VAR.get(root_name), temp, soil)


# 文档 §6 D2 的四组案例 + 未收录品种降级
CASES = [
    {
        "name": "健康 + 同科同属 + 环境匹配",
        "exp": "recommend",
        "disease": dis("healthy", 0.95, "healthy", 0.92),
        "compat": compat("番茄", "番茄", temp=24, soil="疏松肥沃"),
    },
    {
        "name": "病害 + 同科异属（马铃薯/番茄，茄科）",
        "exp": "defer",
        "disease": dis("healthy", 0.95, "diseased", 0.75),
        "compat": compat("番茄", "马铃薯"),
    },
    {
        "name": "跨科（番茄/苹果）+ 砧木病害高置信",
        "exp": "not_recommend",
        "disease": dis("healthy", 0.95, "diseased", 0.88),
        "compat": compat("番茄", "苹果"),
    },
    {
        "name": "双图低置信度",
        "exp": "retake",
        "disease": dis("healthy", 0.52, "diseased", 0.48),
        "compat": compat("番茄", "番茄"),
    },
    {
        "name": "未收录品种（仅展示病害检测）",
        "exp": "cautious",
        "disease": dis("diseased", 0.85, "healthy", 0.9),
        "compat": score_compatibility(None, VAR["番茄"], None, None),
    },
]

passed = 0
for c in CASES:
    got = decide(c["disease"], c["compat"], RULES)["code"]
    mark = "OK " if got == c["exp"] else "FAIL"
    if got == c["exp"]:
        passed += 1
    print(f"[{mark}] {c['name']:<32} -> code={got} (期望 {c['exp']})")

print(f"\n通过 {passed}/{len(CASES)}")
sys.exit(0 if passed == len(CASES) else 1)
