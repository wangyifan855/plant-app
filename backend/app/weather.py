"""真实天气：Open-Meteo（免注册、免 key）+ ipwho.is 定位。
失败（断网 / 超时 / 接口变更）时自动回退到按日期轮换的演示数据，
保证离线演示也不会白屏或报错。
"""
import json
import threading
import time
from datetime import date
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# ── WMO 天气码 → 中文 / 图标 / 养护提示（只保留对养花有用的六档）──
_CLEAR = ("晴", "☀️", "光照充足，正午高温时注意遮阴")
_PARTLY = ("多云", "⛅", "光照温和，适合观察叶片并拍照记录")
_CLOUDY = ("阴", "☁️", "湿度偏大，注意通风、防范真菌性病害")
_RAIN = ("雨", "🌧️", "建议暂停喷雾并保持环境通风")
_SNOW = ("雪", "❄️", "低温，注意防冻，最好移入室内")
_STORM = ("雷雨", "⛈️", "雷雨天气先别施肥，注意排水")

_WMO = {
    0: _CLEAR, 1: _CLEAR, 2: _PARTLY, 3: _CLOUDY,
    45: _CLOUDY, 48: _CLOUDY,
    51: _RAIN, 53: _RAIN, 55: _RAIN, 56: _RAIN, 57: _RAIN,
    61: _RAIN, 63: _RAIN, 65: _RAIN, 66: _RAIN, 67: _RAIN,
    71: _SNOW, 73: _SNOW, 75: _SNOW, 77: _SNOW, 85: _SNOW, 86: _SNOW,
    80: _RAIN, 81: _RAIN, 82: _RAIN,
    95: _STORM, 96: _STORM, 99: _STORM,
}

# ── 演示用兜底数据（原来的逻辑，保持行为一致）──
_DEMO_STATES = [
    {"zh": "晴", "emoji": "☀️", "hint": "光照充足，正午高温时注意遮阴"},
    {"zh": "多云", "emoji": "⛅", "hint": "光照温和，适合观察叶片并拍照记录"},
    {"zh": "阴", "emoji": "☁️", "hint": "湿度偏大，注意通风、防范真菌性病害"},
    {"zh": "雨", "emoji": "🌧️", "hint": "建议暂停喷雾并保持环境通风"},
]
_MONTH_TEMP = [2, 5, 11, 17, 23, 27, 31, 30, 25, 18, 11, 5]

WEATHER_TTL = 30 * 60        # 天气缓存 30 分钟
GEO_TTL = 24 * 3600          # 定位缓存 1 天
TIMEOUT = 4                  # 单次请求超时（秒），别把 /home 拖太久

# ipwho.is 只给英文城市名，常见城市翻一下；没收录的照原样显示
_CITY_ZH = {
    "Beijing": "北京", "Shanghai": "上海", "Guangzhou": "广州", "Shenzhen": "深圳",
    "Fuzhou": "福州", "Xiamen": "厦门", "Quanzhou": "泉州", "Putian": "莆田",
    "Zhangzhou": "漳州", "Hangzhou": "杭州", "Ningbo": "宁波", "Wenzhou": "温州",
    "Nanjing": "南京", "Suzhou": "苏州", "Wuxi": "无锡", "Xuzhou": "徐州",
    "Chengdu": "成都", "Chongqing": "重庆", "Wuhan": "武汉", "Changsha": "长沙",
    "Xi'an": "西安", "Xian": "西安", "Tianjin": "天津", "Zhengzhou": "郑州",
    "Jinan": "济南", "Qingdao": "青岛", "Hefei": "合肥", "Nanchang": "南昌",
    "Kunming": "昆明", "Guiyang": "贵阳", "Nanning": "南宁", "Haikou": "海口",
    "Shenyang": "沈阳", "Dalian": "大连", "Harbin": "哈尔滨", "Changchun": "长春",
    "Shijiazhuang": "石家庄", "Taiyuan": "太原", "Hohhot": "呼和浩特",
    "Urumqi": "乌鲁木齐", "Lanzhou": "兰州", "Xining": "西宁",
    "Yinchuan": "银川", "Lhasa": "拉萨", "Dongguan": "东莞", "Foshan": "佛山",
    "Zhuhai": "珠海", "Shantou": "汕头", "Hong Kong": "中国香港", "Macau": "中国澳门",
}

_lock = threading.Lock()
_cache: dict = {}                       # key -> (ts, 天气)；key 是 "ip" 或 "lat,lon"
_geo = {"ts": 0.0, "data": None}        # 最近一次 IP 定位


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """粗算两点距离，用来判断 IP 定位和真实坐标是不是同一个地方。"""
    from math import asin, cos, radians, sin, sqrt
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * 6371 * asin(sqrt(a))


def _label_for(lat: float, lon: float) -> str:
    """真实坐标没有反向地理编码可用，只能借 IP 定位的城市名：
    两者相距 50km 内就用城市名，否则老实显示「当前位置」。"""
    loc = _locate()
    if not loc:
        return "当前位置"
    try:
        if _distance_km(lat, lon, loc["lat"], loc["lon"]) <= 50:
            return loc["city"]
    except Exception:
        pass
    return "当前位置"


def _demo() -> dict:
    today = date.today()
    doy = today.timetuple().tm_yday
    state = _DEMO_STATES[doy % 4]
    return {
        "date": today.isoformat(),
        "condition": state["zh"],
        "emoji": state["emoji"],
        "temperature": _MONTH_TEMP[today.month - 1] + (doy % 5) - 2,
        "hint": state["hint"],
        "city": None,
        "demo": True,
    }


def _get_json(url: str) -> dict:
    req = Request(url, headers={"User-Agent": "AvoPlantManager/1.0"})
    with urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def _locate() -> dict | None:
    """优先用配置里的固定城市，其次按出口 IP 定位。"""
    with _lock:
        if _geo["data"] and time.time() - _geo["ts"] < GEO_TTL:
            return _geo["data"]

    try:
        info = _get_json("https://ipwho.is/")
        if info.get("success") and info.get("latitude") is not None:
            en = info.get("city") or ""
            loc = {
                "city": _CITY_ZH.get(en, en or info.get("region") or "本地"),
                "lat": float(info["latitude"]),
                "lon": float(info["longitude"]),
            }
            with _lock:
                _geo["ts"] = time.time()
                _geo["data"] = loc
            return loc
    except Exception:
        pass
    return None


def _fetch(lat: float | None = None, lon: float | None = None) -> dict | None:
    """lat/lon 由前端真实定位给出；没给就退回按出口 IP 定位。"""
    if lat is not None and lon is not None:
        city = _label_for(lat, lon)
    else:
        loc = _locate()
        if not loc:
            return None
        lat, lon, city = loc["lat"], loc["lon"], loc["city"]

    query = urlencode({
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,weather_code,relative_humidity_2m",
        "timezone": "auto",
    })
    data = _get_json(f"https://api.open-meteo.com/v1/forecast?{query}")
    cur = data.get("current") or {}
    if cur.get("temperature_2m") is None:
        return None

    code = int(cur.get("weather_code") or 0)
    zh, emoji, hint = _WMO.get(code, _CLOUDY)
    return {
        "date": date.today().isoformat(),
        "condition": zh,
        "emoji": emoji,
        "temperature": round(float(cur["temperature_2m"])),
        "humidity": cur.get("relative_humidity_2m"),
        "hint": hint,
        "city": city,
        "demo": False,
        "source": "open-meteo",
    }


def get_weather(lat: float | None = None, lon: float | None = None) -> dict:
    """对外唯一入口：有缓存用缓存，拉不到就退回（旧缓存 → 演示数据）。"""
    try:
        lat = float(lat) if lat is not None else None
        lon = float(lon) if lon is not None else None
    except (TypeError, ValueError):
        lat = lon = None
    if lat is None or lon is None:
        lat = lon = None
        key = "ip"
    else:
        key = f"{lat:.2f},{lon:.2f}"   # 约 1km 粒度，够用且能命中缓存

    hit = None
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < WEATHER_TTL:
            return hit[1]

    try:
        data = _fetch(lat, lon)
    except Exception:
        data = None

    with _lock:
        if data:
            _cache[key] = (time.time(), data)
            return data
        # 拉取失败：有旧数据先用旧的（哪怕过期），没有就演示数据
        if hit:
            return hit[1]
    return _demo()


def warmup() -> None:
    """服务启动时后台预热一次，避免第一个 /home 请求卡 3~4 秒。"""
    def run():
        try:
            get_weather()
        except Exception:
            pass
    threading.Thread(target=run, daemon=True).start()
