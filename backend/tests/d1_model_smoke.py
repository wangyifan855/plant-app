"""D1 级联测试：PlantNet 认物种 -> 判断是否命中 PlantVillage 14 作物 -> 病害模型细分。"""
import json
import time

import torch
import torch.nn as nn
from PIL import Image
from torchvision import models, transforms
from transformers import pipeline

PTH = "E:/大三上/医学人工智能导论/backend/models/plantnet/plantnet_resnet18.pth"
LABELS = "E:/大三上/医学人工智能导论/backend/models/plantnet/species_id_2_name.json"
IMGS = [
    "E:/大三上/医学人工智能导论/backend/test_images/tomato_early_blight.jpg",
    "E:/大三上/医学人工智能导论/backend/test_images/tomato_healthy.jpg",
]

# PlantVillage 覆盖的 14 种作物，对应 PlantNet 物种名里的属/种关键词
CROP_KEYWORDS = {
    "tomato": "番茄", "solanum lycopersicum": "番茄",
    "apple": "苹果", "malus": "苹果",
    "blueberry": "蓝莓",
    "cherry": "樱桃", "prunus": "樱桃",
    "corn": "玉米", "zea mays": "玉米", "maize": "玉米",
    "grape": "葡萄", "vitis": "葡萄",
    "orange": "橙", "citrus": "橙",
    "peach": "桃",
    "pepper": "椒", "capsicum": "椒",
    "potato": "马铃薯", "solanum tuberosum": "马铃薯",
    "raspberry": "树莓", "rubus": "树莓",
    "soybean": "大豆", "glycine max": "大豆",
    "squash": "南瓜", "cucurbita": "南瓜",
    "strawberry": "草莓", "fragaria": "草莓",
}

# --- PlantNet ---
m = models.resnet18(weights=None)
m.fc = nn.Linear(m.fc.in_features, 1081)
m.load_state_dict(torch.load(PTH, map_location="cpu", weights_only=True))
m.eval()
id2name = json.load(open(LABELS, encoding="utf-8"))
sorted_ids = sorted(id2name.keys())

tf = transforms.Compose([
    transforms.Resize(256), transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])

# --- PlantVillage 病害模型 ---
disease_pipe = pipeline("image-classification",
                        model="linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification")

for path in IMGS:
    img = Image.open(path).convert("RGB")
    print(f"\n=== {path.split('/')[-1]} ===")
    t0 = time.time()
    with torch.no_grad():
        prob = torch.softmax(m(tf(img).unsqueeze(0))[0], dim=0)
    top = torch.topk(prob, 3)
    species_top = None
    for s, i in zip(top.values.tolist(), top.indices.tolist()):
        name = id2name[sorted_ids[i]]
        print(f"  PlantNet: {name:<50} {s:.3f}")
        if species_top is None:
            species_top = name.lower()
    # 命中判断：top3 里任何一个含作物关键词即算命中
    hit = None
    for _, i in zip(*[iter([])]):  # noqa: B007 (占位)
        pass
    top_names = [id2name[sorted_ids[i]].lower() for i in top.indices.tolist()]
    for kw, crop in CROP_KEYWORDS.items():
        if any(kw in n for n in top_names):
            hit = crop
            break
    if hit:
        print(f"  -> 命中 PlantVillage 作物范围：{hit}，继续病害识别")
        d0 = time.time()
        dout = disease_pipe(img)[0]
        print(f"  -> 病害模型：{dout['label']}  {dout['score']:.4f}  ({time.time() - d0:.2f}s)")
    else:
        print("  -> 未命中 14 作物，病害标「未知/建议咨询」（文档降级逻辑）")
    print(f"  物种推理耗时 {time.time() - t0:.2f}s")
