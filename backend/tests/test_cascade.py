# -*- coding: utf-8 -*-
"""级联链路验证（D1，方案 A：病害模型先行）。

文档 v2.4 原设计"PlantNet 认物种 -> 命中14作物 -> 病害"已被 D1 实测否决：
PlantNet-300K 物种表（法国区系 1081 种）不含番茄/苹果/葡萄等 14 作物，
番茄图永远无法命中，病害分支成死路。

反转级联：
  1. PlantVillage 病害模型先行（38 类封闭集，label 自带作物名）
  2. top-1 置信度 >= THRESHOLD -> 直接输出 (crop, disease)，物种=作物
  3. 否则回落 PlantNet 认物种，病害=未知/建议咨询

本脚本用 THRESHOLD=0.99 演示两条分支都被走到（健康叶 1.0 走直通，
病叶 0.84 走回落），真实阈值建议 0.6~0.7，落 D2 定稿。
"""
import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")

from transformers import pipeline

DISEASE_MODEL = "linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification"
SPECIES_PTH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "..", "models", "plantnet", "plantnet_resnet18.pth")
SPECIES_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "models", "plantnet", "species_id_2_name.json")
TESTS = os.path.dirname(os.path.abspath(__file__))
IMGS = [os.path.join(TESTS, "..", "test_images", f)
        for f in ("tomato_early_blight.jpg", "tomato_healthy.jpg")]

THRESHOLD = 0.99  # 演示用；D2 定稿建议 0.6~0.7


def load_species_model():
    import json
    import torch
    from torchvision import models, transforms
    model = models.resnet18(weights=None, num_classes=1081)
    sd = torch.load(SPECIES_PTH, map_location="cpu", weights_only=True)
    model.load_state_dict(sd)
    model.eval()
    tf = transforms.Compose([
        transforms.Resize(256), transforms.CenterCrop(224),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])
    id2name = json.load(open(SPECIES_JSON, encoding="utf-8"))
    names = [id2name[k] for k in sorted(id2name.keys())]

    def predict(path):
        from PIL import Image
        with torch.no_grad():
            probs = torch.softmax(model(tf(Image.open(path).convert("RGB")).unsqueeze(0)), dim=1)[0]
        s, i = probs.max(0)
        return names[i], float(s)
    return predict


def main():
    disease_pipe = pipeline("image-classification", model=DISEASE_MODEL)
    species_fn = load_species_model()

    def parse_label(label):
        # "Tomato with Early Blight" / "Healthy Tomato Plant" -> (crop, disease)
        if " with " in label:
            crop, _, disease = label.partition(" with ")
            return crop, disease
        parts = label.split()          # Healthy {Crop} Plant
        return parts[1], "healthy"

    print(f"级联阈值（演示）: {THRESHOLD}\n")
    for img in IMGS:
        t0 = time.time()
        top = disease_pipe(img, top_k=1)[0]
        if top["score"] >= THRESHOLD:
            crop, disease = parse_label(top["label"])
            print(f"{os.path.basename(img)}  [{time.time()-t0:.2f}s]")
            print(f"  [直通] 作物={crop}  病害={disease}  conf={top['score']:.3f}")
        else:
            species, sconf = species_fn(img)
            print(f"{os.path.basename(img)}  [{time.time()-t0:.2f}s]")
            print(f"  [回落] 病害模型 top1={top['label']} @ {top['score']:.3f} < {THRESHOLD}，置信不足")
            print(f"         物种={species} @ {sconf:.3f}  病害=未知/建议咨询")
        print()
    print("CASCADE_OK")


if __name__ == "__main__":
    main()
