---
license: apache-2.0
tags:
  - image-classification
  - plant-identification
  - pytorch
  - resnet
base_model: microsoft/resnet-18
pipeline_tag: image-classification
---

# PlantNet-300K — ResNet18 (45 MB)

Fine-tuned **ResNet18** for plant species identification across **1,081 species**.

This model serves as the **reference / upper-bound** in an experiment on small, locally-deployable
plant classifiers. It is compared against a much lighter MobileNetV3-Small (10 MB) to assess the
accuracy cost of radical size reduction.

👉 **Live demo**: [cpoisson/plantnet300k](https://huggingface.co/spaces/cpoisson/plantnet300k)  
👉 **Lightweight model (MobileNetV3-Small, 10 MB)**: [cpoisson/plantnet300k-mobilenetv3-small](https://huggingface.co/cpoisson/plantnet300k-mobilenetv3-small)

---

## Model Details

| Attribute | Value |
|---|---|
| Architecture | ResNet18 |
| Pretrained backbone | ImageNet1K_V1 (torchvision) |
| Parameters | ~11.7M |
| Model file size | **~45 MB** |
| Classes | 1,081 plant species |
| Input size | 224 × 224 RGB |
| Normalization | ImageNet — mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225] |

---

## Dataset: Pl@ntNet-300K

| Attribute | Value |
|---|---|
| Source | [Zenodo — DOI:10.5281/zenodo.5645731](https://zenodo.org/records/5645731) |
| Paper | NeurIPS 2021 Datasets & Benchmarks |
| Total images | 306,146 |
| Species | 1,081 |
| Train | 243,916 images |
| Val | 31,118 images |
| Test | 31,112 images |
| Challenge | Long-tailed: 80% of species account for only 11% of images |

> Garcin et al., *"Pl@ntNet-300K: a plant image dataset with high label ambiguity and a long-tailed distribution"*, NeurIPS 2021.

---

## Training

Training script: `train.py` (included in this repo).

| Hyperparameter | Value |
|---|---|
| Framework | PyTorch 2.7.0 + CUDA 12.6 |
| Optimizer | Adam |
| Learning rate | 1e-3 (constant, no scheduler) |
| Epochs | 60 |
| Batch size | 64 |
| Train augmentation | Resize(256) → RandomResizedCrop(224) → RandomHorizontalFlip → ColorJitter(0.2, 0.2, 0.2) |
| Val/Test transform | Resize(256) → CenterCrop(224) |
| Loss | CrossEntropyLoss |
| Data workers | 8 |

### Hardware

| Component | Spec |
|---|---|
| GPU | NVIDIA GeForce RTX 3070 — 8 GB VRAM |
| CPU | Intel Core i7-8086K @ 4.00 GHz — 12 threads |
| RAM | 32 GB |
| OS | Ubuntu Linux |

---

## Results — Test Set (31,112 images)

| Metric | Score |
|---|---|
| **Top-1 Accuracy** | **75.82%** |
| **Top-5 Accuracy** | **93.98%** |

---

## Model Comparison

| Model | Params | Size | Top-1 | Top-5 | Edge-deployable |
|---|---|---|---|---|---|
| MobileNetV3-Small | 3.9M | **10 MB** | 73.89% | 91.86% | ✅ |
| **ResNet18 (this)** | 11.7M | 45 MB | **75.82%** | **93.98%** | ⚠️ |

ResNet18 gains +1.93 pp top-1 at 4.5× the size. Whether that trade-off is worth it depends heavily
on the deployment target.

---

## How to Replicate

### 1. Download the dataset

```bash
wget https://zenodo.org/records/5645731/files/plantnet_300K_images.tar.gz
tar -xzf plantnet_300K_images.tar.gz
```

### 2. Train

```bash
# Edit DATA_DIR and set model = models.resnet18(...) in train.py
python train.py
```

### 3. Load & infer

```python
import torch
from torchvision import models, transforms
from huggingface_hub import hf_hub_download
from PIL import Image

model = models.resnet18(weights=None, num_classes=1081)
path = hf_hub_download("cpoisson/plantnet300k-resnet18", "plantnet_resnet18.pth")
model.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
model.eval()

transform = transforms.Compose([
    transforms.Resize(256),
    transforms.CenterCrop(224),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])

img = Image.open("your_plant.jpg").convert("RGB")
with torch.no_grad():
    logits = model(transform(img).unsqueeze(0))
    probs  = torch.softmax(logits, dim=1)[0]
    top5   = probs.topk(5)
```

---

## Citation

```bibtex
@inproceedings{plantnet-300k,
  author    = {Garcin, Camille and Joly, Alexis and Bonnet, Pierre and Lombardo, Jean-Christophe
               and Affouard, Antoine and Chouet, Mathias and Servajean, Maximilien
               and Lorieul, Titouan and Salmon, Joseph},
  booktitle = {NeurIPS Datasets and Benchmarks 2021},
  title     = {{Pl@ntNet-300K}: a plant image dataset with high label ambiguity and a long-tailed distribution},
  year      = {2021},
}
```
