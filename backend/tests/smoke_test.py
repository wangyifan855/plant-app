# -*- coding: utf-8 -*-
"""D1 冒烟测试：双模型下载、加载、级联推理。

用法（在托管 venv 里跑）：
  python smoke_test.py

验证三件事：
  1. PlantVillage 病害模型能从 HF 下载加载，label 格式可解析（如 Tomato___Early_blight）
  2. PlantNet-300K 物种模型能下载加载，能输出物种名
  3. 文档 v2.4 的级联逻辑（先认物种 → 命中 14 作物 → 细分病害）在真模型上走得通
"""
import json
import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")

from transformers import pipeline

DISEASE_MODEL = "linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification"
SPECIES_MODEL = "cpoisson/plantnet300k-resnet18"
IMG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test_images")

# PlantVillage 38 类标签里的 14 种作物前缀（文档 §1.3 口径）
CROPS = ["Tomato", "Potato", "Corn", "Apple", "Cherry", "Grape", "Peach",
         "Pepper", "Strawberry", "Orange", "Squash", "Raspberry", "Soybean", "Blueberry"]


def run():
    imgs = [os.path.join(IMG_DIR, f) for f in
            ("tomato_early_blight.jpg", "tomato_healthy.jpg")]
    for p in imgs:
        assert os.path.exists(p), f"缺测试图 {p}"

    print("== 1/3 PlantVillage 病害模型 ==")
    t0 = time.time()
    disease_pipe = pipeline("image-classification", model=DISEASE_MODEL)
    print(f"  加载耗时 {time.time()-t0:.1f}s")
    for img in imgs:
        t0 = time.time()
        out = disease_pipe(img, top_k=3)
        dt = time.time() - t0
        print(f"  {os.path.basename(img)} ({dt:.2f}s):")
        for r in out:
            print(f"    {r['label']:<45} {r['score']:.4f}")

    print("== 2/3 PlantNet 物种模型 ==")
    t0 = time.time()
    species_pipe = pipeline("image-classification", model=SPECIES_MODEL)
    print(f"  加载耗时 {time.time()-t0:.1f}s")
    for img in imgs:
        t0 = time.time()
        out = species_pipe(img, top_k=3)
        dt = time.time() - t0
        print(f"  {os.path.basename(img)} ({dt:.2f}s):")
        for r in out:
            print(f"    {r['label']:<45} {r['score']:.4f}")

    print("== 3/3 级联：物种 -> 病害 ==")
    for img in imgs:
        sp = species_pipe(img, top_k=1)[0]
        species_raw = sp["label"]
        hit = next((c for c in CROPS if c.lower() in species_raw.lower()), None)
        dis = disease_pipe(img, top_k=1)[0]
        print(f"  {os.path.basename(img)}:")
        print(f"    物识: {species_raw} @ {sp['score']:.3f} -> 作物命中: {hit or '未命中(病害=未知/建议咨询)'}")
        print(f"    病害: {dis['label']} @ {dis['score']:.3f}")
    print("SMOKE_OK")


if __name__ == "__main__":
    run()
