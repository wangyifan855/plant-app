"""配置加载：品种数据源 + 融合阈值，启动时各加载一次。"""
import os
import json
from pathlib import Path


def _default_config_dir() -> Path:
    # 本文件位于 backend/app/config.py，向上三级为项目根，config 在其下
    return Path(__file__).resolve().parent.parent.parent / "config"


CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", _default_config_dir()))


def _load(name: str):
    with open(CONFIG_DIR / name, "r", encoding="utf-8") as f:
        return json.load(f)


def load_varieties():
    data = _load("varieties.json")
    by_name = {v["name"]: v for v in data["varieties"]}
    return data, by_name


def load_fusion_rules():
    return _load("fusion_rules.json")
