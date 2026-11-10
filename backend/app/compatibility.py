"""兼容性评分：family_genus 满分 70 + temperature 满分 18 + soil 满分 12 = 100。
品种数据来自 varieties.json（前端下拉与后端评分共用同一数据源）。
"""


def _parse_range(s: str):
    try:
        lo, hi = s.split("-")
        return float(lo), float(hi)
    except Exception:
        return None, None


def _temp_score(scion_range: str, root_range: str, user_temp) -> int:
    if not user_temp:
        return 0
    try:
        t = float(user_temp)
    except Exception:
        return 0
    s = _parse_range(scion_range)
    r = _parse_range(root_range)
    in_s = s[0] is not None and s[0] <= t <= s[1]
    in_r = r[0] is not None and r[0] <= t <= r[1]
    if in_s and in_r:
        return 18
    if in_s or in_r:
        return 9
    return 0


def _soil_score(scion_soil: str, root_soil: str, user_soil) -> int:
    if not user_soil:
        return 0
    u = str(user_soil)
    in_s = u in scion_soil
    in_r = u in root_soil
    if in_s and in_r:
        return 12
    if in_s or in_r:
        return 6
    return 0


def score_compatibility(scion: dict, rootstock: dict, temperature, soil_type) -> dict:
    # 任一种未收录 -> 无法判断兼容性
    if scion is None or rootstock is None:
        return {
            "score": 0,
            "known": False,
            "breakdown": {"family_genus": 0, "temperature": 0, "soil": 0},
        }

    if scion["family"] == rootstock["family"] and scion["genus"] == rootstock["genus"]:
        fg = 70
    elif scion["family"] == rootstock["family"]:
        fg = 40
    else:
        fg = 0

    temp = _temp_score(scion["temp_range"], rootstock["temp_range"], temperature)
    soil = _soil_score(scion["soil_pref"], rootstock["soil_pref"], soil_type)

    # 生产上验证过的抗病砧木组合（接穗条目 rootstocks 列表）给亲和加成：
    # 同科异属（如番茄×托鲁巴姆）按属差只给 40，但这类组合是标准农艺措施，
    # 亲和性远好于同科随机配对，加 25 使评分与农艺事实一致。
    bonus = 0
    rootstock_name = rootstock.get("name")
    if rootstock_name and rootstock_name in (scion.get("rootstocks") or []):
        bonus = 25

    total = min(fg + temp + soil + bonus, 100)

    return {
        "score": total,
        "known": True,
        "breakdown": {
            "family_genus": fg,
            "temperature": temp,
            "soil": soil,
            "rootstock_affinity": bonus,
        },
    }
