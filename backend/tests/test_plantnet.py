# -*- coding: utf-8 -*-
"""PlantNet-300K ResNet18 原始 .pth 权重加载与推理测试。

仓库不是 transformers 格式，走 torchvision：
  models.resnet18(num_classes=1081) + load_state_dict
预处理（README/train.py 确认）：Resize(256) -> CenterCrop(224) -> ImageNet 归一化。

索引映射：训练用 ImageFolder，类别索引 = 文件名字典序排序。
species_id_2_name.json 的 key 是物种 ID。本脚本对"字典序"和"数值序"两种
映射都算 top-5，对照番茄叶图应出现 Solanum（番茄所在的属）来判断哪种正确。
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

import torch
from torchvision import models, transforms
from PIL import Image

TESTS = os.path.dirname(os.path.abspath(__file__))
HERE = os.path.join(TESTS, "..", "models", "plantnet")
PTH = os.path.join(HERE, "plantnet_resnet18.pth")
NAMES = os.path.join(HERE, "species_id_2_name.json")
IMGS = [os.path.join(TESTS, "..", "test_images", f)
        for f in ("tomato_early_blight.jpg", "tomato_healthy.jpg")]

TF = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


def main():
    t0 = __import__("time").time()
    model = models.resnet18(weights=None, num_classes=1081)
    sd = torch.load(PTH, map_location="cpu", weights_only=True)
    model.load_state_dict(sd)
    model.eval()
    print(f"权重加载 OK，耗时 {__import__('time').time()-t0:.1f}s")

    id2name = json.load(open(NAMES, encoding="utf-8"))
    ids = list(id2name.keys())
    map_lex = [id2name[k] for k in sorted(ids)]                # 字典序
    map_num = [id2name[k] for k in sorted(ids, key=int)]       # 数值序

    batch = torch.stack([TF(Image.open(p).convert("RGB")) for p in IMGS])
    with torch.no_grad():
        probs = torch.softmax(model(batch), dim=1)

    for path, row in zip(IMGS, probs):
        print(f"\n{os.path.basename(path)}:")
        for label, mapping in (("字典序", map_lex), ("数值序", map_num)):
            top = row.topk(5)
            pairs = [(mapping[i], float(s)) for s, i in zip(top.values, top.indices)]
            print(f"  [{label}]")
            for name, score in pairs:
                flag = " <-- Solanum(番茄属)" if "solanum" in name.lower() else ""
                print(f"    {name:<40} {score:.4f}{flag}")


if __name__ == "__main__":
    main()
