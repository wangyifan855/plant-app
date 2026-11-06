# 构建上下文：项目根目录（在根目录执行 docker build -f backend/Dockerfile .）
FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 构建期把三个模型的权重都下进镜像，运行时完全离线加载
# （HF_ENDPOINT 可指向国内镜像，例如 https://hf-mirror.com）
ARG HF_ENDPOINT=https://huggingface.co
ENV HF_ENDPOINT=${HF_ENDPOINT}

# 1) PlantVillage 病害模型（MobileNetV2，38 类）
RUN python -c "from huggingface_hub import snapshot_download; \
    snapshot_download(repo_id='linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification', local_dir='/app/model')"

# 2) PlantDoc 真实场景病害模型（EfficientNetV2，28 类）+ 它的 config
RUN python -c "from huggingface_hub import snapshot_download; \
    snapshot_download(repo_id='eymenslimani/plant-disease-detector', local_dir='/app/plantdoc')"

COPY backend/app ./app
COPY backend/admin ./admin
COPY backend/models ./models
COPY config ./config

ENV IDENTIFIER=model
ENV PREDICTOR=model
ENV DISEASE_MODEL=/app/model
ENV PLANTDOC_SAFETENSORS=/app/plantdoc/model.safetensors
ENV PLANTDOC_CONFIG=/app/plantdoc/config.json
ENV HF_HUB_OFFLINE=1
ENV TRANSFORMERS_OFFLINE=1
ENV CONFIG_DIR=/app/config

EXPOSE 8000
# Render 注入 $PORT；HF Spaces 默认 8000（README 里 app_port 对齐）。两者都不设时用 8000。
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
