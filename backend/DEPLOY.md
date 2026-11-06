# 后端部署说明（Render / HuggingFace Spaces）

后端是 FastAPI + SQLite，单进程就能跑。识别用到三个模型：PlantVillage 病害（MobileNetV2，38 类）、PlantDoc 病害（EfficientNetV2，28 类）、PlantNet 物种（ResNet18，本地 .pth）。前两个从 Hugging Face 下载，第三个是仓库里的文件。

## 推荐路线：Docker 一键部署（render.yaml）

镜像里在**构建期**就把三个模型下好，运行期完全离线。这样冷启动快，也不怕部署机器连不上 Hugging Face。

`render.yaml` 已经写好，关键配置是：

- `runtime: docker`，`dockerfilePath: backend/Dockerfile`
- `IDENTIFIER=model`：用真模型（`stub` 是占位模式）
- `DISEASE_MODEL=/app/model`：PlantVillage 权重目录（构建期下好）
- `PLANTDOC_SAFETENSORS` / `PLANTDOC_CONFIG`：PlantDoc 权重与类别配置（Dockerfile 里已设）
- `HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1`：强制离线，模型全在镜像里了

步骤：

1. 整个仓库推到 GitHub。
2. Render 控制台 → New → Blueprint，选这个仓库，它会读到根目录的 `render.yaml`。
3. 点 Apply，等构建完成（第一次要装 torch 和下模型，比较慢，十几分钟正常）。
4. 起来后用 `/health` 自检，返回 `{"status":"ok","identifier":"model"}` 就对了，拿到 `https://xxx.onrender.com`。

如果你在国内构建，Hugging Face 直连可能很慢，可以在构建参数里加 `HF_ENDPOINT=https://hf-mirror.com`：`render.yaml` 里给 docker 服务加一个 `buildArgs` 即可，或者本地先 `docker build --build-arg HF_ENDPOINT=https://hf-mirror.com -f backend/Dockerfile .` 试一下。

## 备选路线：Python runtime（不用 Docker）

如果平台不支持 Docker，就按老办法：Root Directory 填 `backend`，Build Command 填 `pip install -r requirements.txt`，Start Command 填 `uvicorn app.main:app --host 0.0.0.0 --port $PORT`。

这条路要**在运行时**下模型，所以环境变量要换成：

- `IDENTIFIER=model`
- `HF_ENDPOINT=https://hf-mirror.com`
- 千万别设 `HF_HUB_OFFLINE=1`（那会禁止下载，只有模型已在镜像里时才用）
- PlantNet 的 .pth 在仓库里，跟着代码一起上去就行

注意免费的 Python 实例内存通常只有 512MB，三个模型同时加载很容易 OOM，这也是更推荐 Docker（可选更大内存）的原因。

## 拿到地址之后

- 安卓 APK 要把 `frontend/app.json` 的 `extra.apiUrl` 改成这个 HTTPS 地址，再重新跑 `eas build`。
- 免费实例休眠后磁盘不持久，SQLite 数据和上传的植物照片/帖子图片会在重启后丢。要持久化，要么挂付费磁盘，要么把上传目录接到对象存储（S3 / 七牛之类）。

## HuggingFace Spaces 的差异

- 直接用 Dockerfile 建 Space 最省事，端口用 HF 默认的 `7860`（Dockerfile 里读 `$PORT`，HF 会注入）。
- 同样把 `HF_ENDPOINT` 指到镜像，`IDENTIFIER=model`，构建期下载模型。
- 不需要 Gradio，FastAPI 直接跑就行。
