# 用于 Hugging Face Spaces（Docker 类型）。构建上下文 = Space 根目录。
# 上传时把以下内容平铺到 Space 根：本 Dockerfile、app/（来自 backend/app）、
# config/（来自项目根 config/）、requirements.txt（来自 backend/requirements.txt）、README.md（本目录模板）
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 构建期把模型权重下进镜像，运行时离线加载（解决冷启动 + 断网）
ENV MODEL_ID=linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='$MODEL_ID', local_dir='/app/model')"

COPY app ./app
COPY config ./config

ENV PREDICTOR=model
ENV MODEL_PATH=/app/model
ENV HF_HUB_OFFLINE=1
ENV TRANSFORMERS_OFFLINE=1
ENV CONFIG_DIR=/app/config

EXPOSE 8000
# HF Spaces 默认把容器端口设为 app_port（见 README 的 8000），并注入 $PORT；不设时回退 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
