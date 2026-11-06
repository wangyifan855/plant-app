"""视觉识别封装（D2，病害模型先行，见文档 §1.3 D1 实测结论）。

三个实现，通过环境变量 IDENTIFIER 切换（stub / model，默认 stub）：

- StubIdentifier：桩，按图片内容哈希产生确定性结果，无权重也能跑通全链路。
- ModelIdentifier：真模型。双病害模型融合（D3 实测后调整）：
  * PlantVillage MobileNetV2（38 类，实验室单叶纯背景图训练）——对实验室
    风格图极准，对真实手机照片容易自信误判（实测把番茄照片判成草莓 61%）。
  * PlantDoc EfficientNetV2（28 类，真实场景照片训练）——对真实照片准
    （实测番茄照片 top-1 番茄早疫 44%），对实验室风格图反而混乱。
  两路各自按作物聚合得分：作物一致取置信度高者的病害；不一致取"领先
  幅度"（top 作物与次名作物得分差）更大、更笃定的模型。融合结果仍走
  两档门控（GATE / LOW_GATE），未过则回落 PlantNet-300K 认物种。
  （PlantNet 的 1081 类不含 14 作物，D1 实测确认，级联只能反转。）

identify(image_bytes) 统一返回：
  {
    "supported": bool,                  # 是否落在病害模型 14 作物内
    "species":  {"label": str, "confidence": float},
    "disease":  {"label": "healthy"|"diseased"|"unknown",
                 "name": str|None, "confidence": float|None},
  }
"""
import os
import json
import hashlib
from pathlib import Path
import numpy as np

# PlantVillage 38 类 label 里的作物写法 -> 规范名 + 中文
_CROPS = {
    "apple": ("Apple", "苹果"),
    "blueberry": ("Blueberry", "蓝莓"),
    "cherry": ("Cherry", "樱桃"),
    "corn": ("Corn", "玉米"), "maize": ("Corn", "玉米"),
    "grape": ("Grape", "葡萄"),
    "orange": ("Orange", "橙子"),
    "peach": ("Peach", "桃"),
    "pepper": ("Pepper", "辣椒"),
    "potato": ("Potato", "马铃薯"),
    "raspberry": ("Raspberry", "树莓"),
    "soybean": ("Soybean", "大豆"),
    "squash": ("Squash", "南瓜"),
    "strawberry": ("Strawberry", "草莓"),
    "tomato": ("Tomato", "番茄"),
}

# 桩用：每作物给两个候选病害名，保证 stub 模式下文案库能命中
_STUB_DISEASES = {
    "Tomato": "Early Blight", "Apple": "Apple Scab", "Potato": "Late Blight",
    "Corn": "Common Rust", "Grape": "Black Rot", "Pepper": "Bacterial Spot",
}


def parse_disease_label(label: str) -> dict:
    """解析病害模型英文短句 label。

    'Healthy Tomato Plant'      -> healthy=True,  crop='Tomato'
    'Tomato with Early Blight'  -> healthy=False, crop='Tomato', disease='Early Blight'
    'Apple Scab'                -> healthy=False, crop='Apple',  disease='Apple Scab'
    """
    text = label.strip()
    low = text.lower()

    if low.startswith("healthy"):
        rest = text[len("healthy"):].strip()
        if rest.lower().endswith("plant"):
            rest = rest[:-len("plant")].strip()
        crop = _canon_crop(rest)
        return {"healthy": True, "crop": crop, "disease": None}

    crop = _canon_crop(text)
    if crop and " with " in low:
        disease = text.split(" with ", 1)[1].strip()
        return {"healthy": False, "crop": crop, "disease": disease}
    # 无 "with" 的病害名（如 'Apple Scab'、'Cedar Apple Rust'）
    if crop:
        return {"healthy": False, "crop": crop, "disease": text}
    return {"healthy": False, "crop": None, "disease": text}


def _canon_crop(text: str):
    low = text.lower()
    for key, (en, _zh) in _CROPS.items():
        if key in low:
            return en
    return None


def crop_zh(crop: str) -> str:
    for key, (en, zh) in _CROPS.items():
        if en.lower() == (crop or "").lower():
            return zh
    return crop


# 病害英文名 -> 中文展示名（覆盖 PV 38 类与 PlantDoc 28 类的病害部分）。
# 仅用于展示；建议文案匹配仍用英文原名，先匹配后翻译。
_DISEASE_ZH = {
    "early blight": "早疫病",
    "late blight": "晚疫病",
    "septoria leaf spot": "斑枯病",
    "leaf mold": "叶霉病",
    "bacterial spot": "细菌性叶斑病",
    "target spot": "靶斑病",
    "mosaic virus": "花叶病毒病",
    "tomato yellow leaf curl virus": "黄化曲叶病毒病",
    "yellow leaf curl virus": "黄化曲叶病毒病",
    "two-spotted spider mites": "二斑叶螨（红蜘蛛）",
    "spider mites": "二斑叶螨（红蜘蛛）",
    "leaf scorch": "叶焦病",
    "apple scab": "黑星病",
    "black rot": "黑腐病",
    "cedar apple rust": "苹果锈病",
    "esca (black measles)": "黑麻疹病（Esca）",
    "leaf blight": "叶枯病",
    "isariopsis leaf spot": "褐斑病",
    "common rust": "普通锈病",
    "gray leaf spot": "灰斑病",
    "northern corn leaf blight": "大斑病",
    "northern leaf blight": "大斑病",
    "powdery mildew": "白粉病",
    "haunglongbing (citrus greening)": "黄龙病",
    "citrus greening": "黄龙病",
    "scab": "疮痂病",
    "rust": "锈病",
    "blight": "疫病",
    "leaf spot": "叶斑病",
    "mildew": "霜霉病",
}


def disease_zh(name: str | None) -> str | None:
    """病害英文名转中文展示名。全等匹配优先，退化到包含匹配，均无则原样返回。"""
    if not name:
        return name
    low = name.strip().lower()
    if low in _DISEASE_ZH:
        return _DISEASE_ZH[low]
    for key, zh in _DISEASE_ZH.items():
        if key in low:
            return zh
    return name


def _leaf_crop(img):
    """启发式裁叶：用超绿通道(2G-R-B)找叶片区域裁剪；绿色过少(黄化病叶/截图)则退回中心裁切去 UI 边框。

    返回裁剪后的 PIL.Image(RGB)。目的是去除背景与截图 UI 噪声，让分类模型聚焦叶片。
    这是课程原型的轻量预处理，不能保证 100% 命中，对分布外输入只是缓解而非根治。
    """
    w, h = img.size
    arr = np.asarray(img).astype("int32")
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    eg = 2 * g - r - b                      # 超绿指数：健康叶明显为正
    mask = eg > 30
    total = w * h
    if mask.sum() > 0.10 * total:
        ys, xs = np.where(mask)
        pad = int(0.06 * min(w, h))
        x0 = max(0, int(xs.min()) - pad); x1 = min(w, int(xs.max()) + pad)
        y0 = max(0, int(ys.min()) - pad); y1 = min(h, int(ys.max()) + pad)
        return img.crop((x0, y0, x1, y1))
    # 绿色太少：退化为中心裁切，去掉四周约 12% 的 UI/边框
    m = int(0.12 * min(w, h))
    return img.crop((m, m, w - m, h - m))


def _tiles(img):
    """多裁片 TTA 视角：整图 + 中心特写 + 2×2 六成网格（20% 重叠），共 6 片。

    真实照片往往一株多叶、病叶只占一角，整张压给模型容易稀释病灶信号；
    多视角分别识别再投票，结论更稳。环境变量 TTA=0 可关掉（退回单视角）。
    """
    if os.environ.get("TTA", "1").lower() in ("0", "false", "off"):
        return [img]
    w, h = img.size
    out = [img, img.crop((int(0.15 * w), int(0.15 * h), int(0.85 * w), int(0.85 * h)))]
    tw, th = int(0.6 * w), int(0.6 * h)
    for fx in (0.0, 0.4):
        for fy in (0.0, 0.4):
            out.append(img.crop((int(fx * w), int(fy * h), int(fx * w) + tw, int(fy * h) + th)))
    return out


# PlantDoc 28 类 label -> (规范作物, 是否健康, 病害英文名)。作物名与 PV 对齐以便融合。
_PLANTDOC_MAP = {
    "Apple_Scab_Leaf": ("Apple", False, "Apple Scab"),
    "Apple_leaf": ("Apple", True, None),
    "Apple_rust_leaf": ("Apple", False, "Cedar Apple Rust"),
    "Bell_pepper_leaf": ("Pepper", True, None),
    "Bell_pepper_leaf_spot": ("Pepper", False, "Bacterial Spot"),
    "Blueberry_leaf": ("Blueberry", True, None),
    "Cherry_leaf": ("Cherry", True, None),
    "Corn_Gray_leaf_spot": ("Corn", False, "Gray Leaf Spot"),
    "Corn_leaf_blight": ("Corn", False, "Northern Corn Leaf Blight"),
    "Corn_rust_leaf": ("Corn", False, "Common Rust"),
    "Peach_leaf": ("Peach", True, None),
    "Potato_leaf_early_blight": ("Potato", False, "Early Blight"),
    "Potato_leaf_late_blight": ("Potato", False, "Late Blight"),
    "Raspberry_leaf": ("Raspberry", True, None),
    "Soyabean_leaf": ("Soybean", True, None),
    "Squash_Powdery_mildew_leaf": ("Squash", False, "Powdery Mildew"),
    "Strawberry_leaf": ("Strawberry", True, None),
    "Tomato_Early_blight_leaf": ("Tomato", False, "Early Blight"),
    "Tomato_Septoria_leaf_spot": ("Tomato", False, "Septoria Leaf Spot"),
    "Tomato_leaf": ("Tomato", True, None),
    "Tomato_leaf_bacterial_spot": ("Tomato", False, "Bacterial Spot"),
    "Tomato_leaf_late_blight": ("Tomato", False, "Late Blight"),
    "Tomato_leaf_mosaic_virus": ("Tomato", False, "Mosaic Virus"),
    "Tomato_leaf_yellow_virus": ("Tomato", False, "Tomato Yellow Leaf Curl Virus"),
    "Tomato_mold_leaf": ("Tomato", False, "Leaf Mold"),
    "Tomato_two_spotted_spider_mites_leaf": ("Tomato", False, "Two-spotted Spider Mites"),
    "grape_leaf": ("Grape", True, None),
    "grape_leaf_black_rot": ("Grape", False, "Black Rot"),
}


class _PlantDocModel:
    """PlantDoc 真实场景病害模型（timm EfficientNetV2，28 类，CPU）。

    与 PlantVillage 模型互补：PV 对实验室风格图准、真实照片弱；PlantDoc
    用真实照片训练，对手机实拍准、对实验室图弱。类别顺序取自官方
    config.json 的 id2label。
    """

    REPO = "eymenslimani/plant-disease-detector"

    def __init__(self):
        import torch
        import timm
        from safetensors.torch import load_file
        from torchvision import transforms

        model = timm.create_model(
            "tf_efficientnetv2_m.in21k_ft_in1k", pretrained=False, num_classes=28
        )
        sd = load_file(self._weights())
        sd = {k.removeprefix("model."): v for k, v in sd.items()}
        model.load_state_dict(sd, strict=True)
        model.eval()
        self._torch = torch
        self._net = model
        # 温度缩放（temperature scaling）：PlantDoc 在真实照片上峰值置信度常虚高
        # （如把病叶判对但给 0.9+），对低频/易混类尤其明显。T>1 把 logits 整体
        # 压平，softmax 后峰值下降、分布更平滑，让门控更稳、减少高置信错误被放行。
        # 经验值（非严格标定，无独立验证集）：1.3 温和。可通过 PLANTDOC_T 调。
        self._t = float(os.environ.get("PLANTDOC_T", "1.3"))
        self._tf = transforms.Compose([
            transforms.Resize((256, 256)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        cfg_path = self._config_path()
        id2label = json.load(open(cfg_path, encoding="utf-8"))["id2label"]
        self._labels = [id2label[str(i)] for i in range(len(id2label))]

    @classmethod
    def _weights(cls) -> str:
        p = os.environ.get("PLANTDOC_SAFETENSORS")
        if p and Path(p).exists():
            return p
        from huggingface_hub import hf_hub_download
        return hf_hub_download(cls.REPO, "model.safetensors")

    @classmethod
    def _config_path(cls) -> str:
        p = os.environ.get("PLANTDOC_CONFIG")
        if p and Path(p).exists():
            return p
        from huggingface_hub import hf_hub_download
        return hf_hub_download(cls.REPO, "config.json")

    def predict(self, img):
        """返回 [(crop, score, healthy, disease), ...] 按得分降序（score 已温度缩放）。"""
        torch = self._torch
        with torch.no_grad():
            logits = self._net(self._tf(img).unsqueeze(0))[0]
            if self._t != 1.0:
                logits = logits / self._t
            prob = torch.softmax(logits, dim=-1)
        out = []
        for idx in torch.argsort(prob, descending=True):
            label = self._labels[int(idx)]
            crop, healthy, disease = _PLANTDOC_MAP[label]
            out.append((crop, float(prob[idx]), healthy, disease))
        return out


class StubIdentifier:
    """桩：md5 决定作物/健康状态，确定性可测。约 1/4 概率产出"不支持作物"分支。"""

    def identify(self, image_bytes: bytes) -> dict:
        h = int(hashlib.md5(image_bytes).hexdigest(), 16)
        conf = round(0.60 + (h % 40) / 100.0, 2)  # 0.60 ~ 0.99

        if h % 4 == 3:  # 不支持的野生植物分支
            return {
                "supported": False,
                "species": {"label": "Trifolium repens L.", "confidence": conf},
                "disease": {"label": "unknown", "name": None, "confidence": None},
            }

        crop = ["Tomato", "Apple", "Potato"][h % 3]
        healthy = (h % 2 == 0)
        disease = None if healthy else _STUB_DISEASES[crop]
        return {
            "supported": True,
            "crop": crop.lower(),  # 供嫁接初筛自动推断品种（统一小写 en 键）
            "species": {"label": f"{crop_zh(crop)} ({crop})", "confidence": conf},
            "disease": {
                "label": "healthy" if healthy else "diseased",
                "name": disease,
                "confidence": conf,
            },
        }


class ModelIdentifier:
    """真模型：病害先行，未过阈值回落 PlantNet。权重本地加载，离线运行。

    两档门控（D3 实测后调整）：真实照片 top-1 常在 0.3~0.65 之间但作物/病害
    方向正确（如番茄斑枯 0.31），一刀切回落 PlantNet 反而丢掉有用信息。
    >= GATE 高置信直接采纳；>= LOW_GATE 采纳但让上层标注"低置信度仅供参考"。
    """

    GATE = float(os.environ.get("DISEASE_GATE", "0.65"))
    LOW_GATE = float(os.environ.get("DISEASE_GATE_LOW", "0.18"))
    # 作物不一致时，PlantDoc 相对 PV 的平局加成：PlantDoc 用真实场景照片训练，
    # 一般比实验室图的 PV 更可信，所以即使峰值略低于 PV 也优先选它。1.15 表示
    # PlantDoc 峰值 ≥ PV 峰值 / 1.15 时胜出。可通过 PLANTDOC_TIE 调。
    PLANTDOC_TIE = float(os.environ.get("PLANTDOC_TIE", "1.15"))

    def __init__(self):
        from transformers import pipeline
        # PV（PlantVillage 实验室图训练）在真实手机照片上常"高置信误判"
        # （实测番茄→葡萄黑腐 0.93）。给它整体降权，削弱其在融合中的话语权，
        # 让真实场景训练的 PlantDoc 主导结论。0.7 温和；可通过 PV_WEIGHT 调。
        self.PV_WEIGHT = float(os.environ.get("PV_WEIGHT", "0.7"))
        self._disease = pipeline(
            "image-classification",
            model=os.environ.get(
                "DISEASE_MODEL",
                "linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification",
            ),
        )
        self._plantdoc = None
        try:
            self._plantdoc = _PlantDocModel()
            print("[predict] PlantDoc 融合模型已加载")
        except Exception as e:  # 权重缺失/网络不通时退回 PV 单模型，不影响服务启动
            print(f"[predict] PlantDoc 不可用，退回 PV 单模型模式: {e}")
        self._species = _SpeciesModel(
            os.environ.get(
                "SPECIES_PTH",
                str(Path(__file__).resolve().parent.parent / "models" / "plantnet" / "plantnet_resnet18.pth"),
            ),
            os.environ.get(
                "SPECIES_LABELS",
                str(Path(__file__).resolve().parent.parent / "models" / "plantnet" / "species_id_2_name.json"),
            ),
        )

    @staticmethod
    def _summarize(per):
        """把 [(crop, score, healthy, disease), ...] 聚合成单模型结论。

        返回 {crop, mass, margin, conf, healthy, disease}：mass 为 top 作物
        总得分，margin 为与次名作物的领先幅度，conf/disease 取该作物内
        得分最高的类别。
        """
        from collections import defaultdict
        if not per:
            return None
        mass = defaultdict(float)
        for crop, score, *_ in per:
            mass[crop] += score
        ranked = sorted(mass.items(), key=lambda kv: -kv[1])
        top_crop, top_mass = ranked[0]
        margin = top_mass - (ranked[1][1] if len(ranked) > 1 else 0.0)
        best = max((x for x in per if x[0] == top_crop), key=lambda x: x[1])
        return {
            "crop": top_crop, "mass": top_mass, "margin": margin,
            "conf": best[1], "healthy": best[2], "disease": best[3],
        }

    def _fuse(self, img):
        """跑双病害模型并融合。返回 (结论, 全部类别列表)。

        多裁片 TTA：对 _tiles(img) 的每个视角分别跑两模型，类别得分按
        视角数取平均后融合——多视角一致指向的结论置信度更高，单视角的
        偶发误判被稀释。结论为 summarize dict 或 None；全部类别列表是两
        路合并按平均得分降序的 [(crop, score, healthy, disease), ...]，
        供低置信度时生成"相似疑似"候选。
        """
        from collections import defaultdict
        tiles = _tiles(img)
        pv_sum, pv_max = defaultdict(float), {}   # 各视角得分和 / 最佳单视角
        pd_sum, pd_max = defaultdict(float), {}
        for t in tiles:
            for o in self._disease(t, top_k=None):
                p = parse_disease_label(o["label"])
                if p["crop"]:
                    k = (p["crop"], p["healthy"], p["disease"])
                    s = float(o["score"]) * self.PV_WEIGHT
                    pv_sum[k] += s
                    pv_max[k] = max(pv_max.get(k, 0.0), s)
            if self._plantdoc is not None:
                for crop, s, healthy, disease in self._plantdoc.predict(t):
                    k = (crop, healthy, disease)
                    pd_sum[k] += s
                    pd_max[k] = max(pd_max.get(k, 0.0), s)
        n = len(tiles)
        pv_per = [(c, s / n, h, d) for (c, h, d), s in pv_sum.items()]
        pd_per = [(c, s / n, h, d) for (c, h, d), s in pd_sum.items()]
        pv = self._summarize(pv_per)
        pd = self._summarize(pd_per)

        per_all = sorted(pv_per + pd_per, key=lambda x: -x[1])

        # 作物不一致时的判定用"峰值（最佳单视角）"而非跨视角平均分：TTA 多视角
        # 平均会把 PlantDoc 的强信号稀释到阈值以下，反而退回不可靠的 PV（实测真实
        # 番茄健康照 PV 误判成 Apple，平均分被稀释后 PlantDoc 峰值 0.70 却被判输）。
        def _peak_for(summary, maxmap):
            if summary is None:
                return 0.0
            c = summary["crop"]
            return max((v for k, v in maxmap.items() if k[0] == c), default=0.0)
        pv_peak = _peak_for(pv, pv_max)
        pd_peak = _peak_for(pd, pd_max)

        chosen = None
        if pv is None and pd is None:
            return None, per_all
        if pv is None or pd is None:
            chosen = pv or pd
        elif pv["crop"] == pd["crop"]:
            # 作物一致：取置信度高的一路的病害结论
            chosen = pv if pv["conf"] >= pd["conf"] else pd
        else:
            # 作物不一致：两路都是预训练噪声模型，没有谁永远更准。取"峰值更
            # 笃定"的一路作为主结论；真实场景训练的 PlantDoc 给 PLANTDOC_TIE
            # 平局加成（通常更可信）。这样既能纠正 PV 把真实番茄健康误判成
            # Apple 的情况（PV 峰值 0.70 ≫ PlantDoc 0.15），又保留 PlantDoc
            # 在自身高置信时（如峰值 0.6 vs PV 0.4）压过噪声 PV 的能力。
            pd_eff = pd_peak * self.PLANTDOC_TIE
            chosen = pd if (pd is not None and pd_eff >= pv_peak) else pv
            chosen = dict(chosen)
            chosen["disputed"] = True
        # 置信度取主类"最佳单视角"：跨视角平均会把高置信案例稀释
        # （实验室早疫图 PV 单视角 0.84，平均后只剩 0.32），排名用平均、
        # 展示用单视角峰值，两头兼顾。
        key = (chosen["crop"], chosen["healthy"], chosen["disease"])
        chosen["conf"] = max(pv_max.get(key, 0.0), pd_max.get(key, 0.0))
        return chosen, per_all

    @staticmethod
    def _candidates(chosen, per_all, limit=3):
        """低置信度时的"相似疑似"候选：只取主结论同作物的其他病害类。

        不跨作物列候选——物种结论已是该作物，列别的作物只会自相矛盾
        （如主结论"番茄早疫病44%"旁边挂个"草莓61%"）。两模型该作物的
        类别合并按得分排序，排除主结论后取前 limit 个。
        """
        seen = {(chosen["crop"], chosen["disease"])}
        out = []
        for crop, score, healthy, disease in per_all:
            if crop != chosen["crop"] or healthy or not disease:
                continue
            if (crop, disease) in seen:
                continue
            seen.add((crop, disease))
            out.append({
                "label": f"{crop_zh(crop)} · {disease_zh(disease)}",
                "confidence": round(score, 4),
            })
            if len(out) >= limit:
                break
        return out

    def identify(self, image_bytes: bytes) -> dict:
        from io import BytesIO
        from PIL import Image
        img = Image.open(BytesIO(image_bytes)).convert("RGB")
        img = _leaf_crop(img)              # 送模型前先裁叶，缓解背景/截图噪声

        fused, per_all = self._fuse(img)
        if fused is not None and fused["crop"] in {en for en, _ in _CROPS.values()}:
            conf = fused["conf"]
            tier = None
            if conf >= self.GATE:
                tier = {}
            elif conf >= self.LOW_GATE:
                tier = {"low_confidence": True}
            if tier is not None:
                crop = fused["crop"]
                result = {
                    "supported": True,
                    "crop": crop,  # 供嫁接初筛自动推断品种（小写 en 键）
                    **tier,
                    "species": {"label": f"{crop_zh(crop)} ({crop})", "confidence": conf},
                    "disease": {
                        "label": "healthy" if fused["healthy"] else "diseased",
                        "name": fused["disease"],
                        "confidence": conf,
                    },
                }
                if tier.get("low_confidence"):
                    result["candidates"] = self._candidates(fused, per_all)
                return result

        # 回落：PlantNet 认物种，病害未知
        name, sconf = self._species.predict(img)
        return {
            "supported": False,
            "species": {"label": name, "confidence": sconf},
            "disease": {"label": "unknown", "name": None, "confidence": None},
        }


class _SpeciesModel:
    """PlantNet-300K ResNet18 原始 .pth（torchvision 格式，非 transformers）。"""

    def __init__(self, pth_path: str, labels_path: str):
        import torch
        from torchvision import models, transforms
        import torch.nn as nn

        self._torch = torch
        net = models.resnet18(weights=None)
        net.fc = nn.Linear(net.fc.in_features, 1081)
        sd = torch.load(pth_path, map_location="cpu", weights_only=True)
        net.load_state_dict(sd)
        net.eval()
        self._net = net
        self._tf = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        id2name = json.load(open(labels_path, encoding="utf-8"))
        # 训练用 ImageFolder，类别索引 = species_id 字典序
        self._sorted_ids = sorted(id2name.keys())
        self._id2name = id2name

    def predict(self, img) -> tuple:
        torch = self._torch
        with torch.no_grad():
            prob = torch.softmax(self._net(self._tf(img).unsqueeze(0))[0], dim=0)
        idx = int(prob.argmax())
        return self._id2name[self._sorted_ids[idx]], round(float(prob[idx]), 4)


def build_identifier():
    mode = os.environ.get("IDENTIFIER", os.environ.get("PREDICTOR", "stub")).lower()
    if mode == "model":
        return ModelIdentifier()
    return StubIdentifier()
