"""D1 冒烟测试：PlantNet-300K ResNet18（torchvision 版 .pth）加载 + 推理。"""
import json
import time

import torch
import torch.nn as nn
from PIL import Image
from torchvision import models, transforms

PTH = "E:/大三上/医学人工智能导论/backend/models/plantnet/plantnet_resnet18.pth"
LABELS = "E:/大三上/医学人工智能导论/backend/models/plantnet/species_id_2_name.json"

t0 = time.time()
m = models.resnet18(weights=None)
m.fc = nn.Linear(m.fc.in_features, 1081)
sd = torch.load(PTH, map_location="cpu", weights_only=True)
m.load_state_dict(sd)
m.eval()
print(f"load: {time.time() - t0:.1f}s")

# index -> species_id：ImageFolder 按 species_id 字符串排序
id2name = json.load(open(LABELS, encoding="utf-8"))
sorted_ids = sorted(id2name.keys())
assert len(sorted_ids) == 1081

tf = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

# 合成绿叶图（链路验证用）
img = Image.new("RGB", (400, 300), (60, 120, 40))
for x in range(400):
    for y in range(300):
        if (x * 5 + y * 11) % 89 < 5:
            img.putpixel((x, y), (100, 70, 30))

t0 = time.time()
with torch.no_grad():
    prob = torch.softmax(m(tf(img).unsqueeze(0))[0], dim=0)
dt = time.time() - t0
top = torch.topk(prob, 5)
print(f"infer: {dt:.2f}s (cpu)")
for s, i in zip(top.values.tolist(), top.indices.tolist()):
    print(f"  {sorted_ids[i]:<10} {id2name[sorted_ids[i]]:<45} {s:.4f}")
