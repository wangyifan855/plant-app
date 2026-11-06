"""融合决策树：完全在后端实现，阈值来自 fusion_rules.json。
任改阈值即可调档位，无需重打包 APK。
"""


def decide(disease: dict, compatibility: dict, rules: dict) -> dict:
    """两档门控。

    - 任一图置信度 < retake_confidence：直接请重拍，不给结论。
    - 介于 retake_confidence 与 low_confidence_hint 之间：照常出结论，
      但在 explanation 前加一句低置信度提示，并把 low_confidence 置 True。
    """
    result = _decide(disease, compatibility, rules)

    hint = rules.get("low_confidence_hint", rules["retake_confidence"])
    low = []
    for side, key in (("接穗", "scion"), ("砧木", "rootstock")):
        conf = disease[key].get("confidence")
        if conf is not None and conf < hint:
            low.append(f"{side} {conf:.2f}")

    result["low_confidence"] = bool(low) and not result["retake_required"]
    if result["low_confidence"]:
        result["explanation"] = (
            f"图片不够清晰或作物不够典型，识别置信度偏低（{'、'.join(low)}）。"
            "下面结论仅供参考，方便的话重拍一张更清楚的会更准。\n"
            + result["explanation"]
        )
    return result


def _decide(disease: dict, compatibility: dict, rules: dict) -> dict:
    retake = rules["retake_confidence"]
    disease_high = rules["disease_high_confidence"]
    compat_low = rules["compat_low"]
    compat_high = rules["compat_high"]
    tiers = rules["tiers"]

    scion = disease["scion"]
    root = disease["rootstock"]

    # 0) 任一图为"未支持作物"（病害模型未命中，label=unknown，置信度 None）
    unknown = [side for side, d in (("接穗", scion), ("砧木", root)) if d["label"] == "unknown"]
    if unknown:
        return {
            "code": "cautious",
            "label": tiers["cautious"],
            "explanation": (
                f"{'、'.join(unknown)}的作物不在病害识别覆盖范围内（14 种常见作物），"
                "无法检测病害信号，也无法判断亲和性，请谨慎尝试并人工确认。"
            ),
            "retake_required": False,
        }

    # 1) 重拍：任一张置信度低于阈值
    low = []
    if scion["confidence"] < retake:
        low.append(f"接穗 {scion['confidence']:.2f}")
    if root["confidence"] < retake:
        low.append(f"砧木 {root['confidence']:.2f}")
    if low:
        return {
            "code": "retake",
            "label": tiers["retake"],
            "explanation": (
                f"以下图片的病害检测置信度不足（{'、'.join(low)}），"
                "无法给出可靠建议。请靠近叶片或茎干重新拍摄。"
            ),
            "retake_required": True,
        }

    diseased = [d for d in (scion, root) if d["label"] == "diseased"]
    has_disease = bool(diseased)
    dis_conf = max(d["confidence"] for d in diseased) if diseased else 0.0

    # 2) 存在病害信号
    if has_disease:
        # 未收录品种：无法判断兼容性，仅基于病害给谨慎建议
        if not compatibility["known"]:
            return {
                "code": "cautious",
                "label": tiers["cautious"],
                "explanation": (
                    "未收录品种，无法判断兼容性，仅展示病害检测结果。"
                    f"检测到疑似病害信号（置信度 {dis_conf:.2f}），建议谨慎尝试，"
                    "但请自行确认亲和性。"
                ),
                "retake_required": False,
            }
        if dis_conf > disease_high and compatibility["score"] < compat_low:
            return {
                "code": "not_recommend",
                "label": tiers["not_recommend"],
                "explanation": (
                    f"检测到疑似病害信号（置信度 {dis_conf:.2f}），"
                    f"且兼容性评分偏低（{compatibility['score']}）。"
                    "病害症状可能与嫁接不亲和症状混淆，不建议嫁接。"
                ),
                "retake_required": False,
            }
        if compatibility["score"] < compat_low:
            return {
                "code": "defer",
                "label": tiers["defer"],
                "explanation": (
                    f"检测到疑似病害信号（置信度 {dis_conf:.2f}）。"
                    "病害症状可能与嫁接不亲和症状混淆，"
                    "建议先隔离观察或进一步检测，再尝试嫁接。"
                ),
                "retake_required": False,
            }
        return {
            "code": "cautious",
            "label": tiers["cautious"],
            "explanation": (
                f"检测到疑似病害信号（置信度 {dis_conf:.2f}），"
                f"但兼容性评分尚可（{compatibility['score']}）。"
                "建议谨慎尝试，必要时先处理病害。"
            ),
            "retake_required": False,
        }

    # 3) 两图均健康
    if compatibility["known"]:
        score = compatibility["score"]
        if score >= compat_high:
            return {
                "code": "recommend",
                "label": tiers["recommend"],
                "explanation": f"两图均未检测到病害，兼容性评分高（{score}），建议嫁接。",
                "retake_required": False,
            }
        if score >= compat_low:
            return {
                "code": "cautious",
                "label": tiers["cautious"],
                "explanation": f"两图均未检测到病害，兼容性评分中等（{score}），可谨慎尝试。",
                "retake_required": False,
            }
        return {
            "code": "defer",
            "label": tiers["defer"],
            "explanation": (
                f"两图均未检测到病害，但兼容性评分偏低（{score}），"
                "建议暂缓，优先选择同科同属材料。"
            ),
            "retake_required": False,
        }

    # 4) 未收录品种：仅展示病害检测结果
    return {
        "code": "cautious",
        "label": tiers["cautious"],
        "explanation": (
            "未收录品种，无法判断兼容性，仅展示病害检测结果。"
            "两图均未发现明确病害，可谨慎尝试，但请自行确认亲和性。"
        ),
        "retake_required": False,
    }
