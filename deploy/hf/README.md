---
title: GraftCheck Backend
emoji: 🌱
colorFrom: green
colorTo: green
sdk: docker
app_port: 8000
---

# GraftCheck 后端（HF Spaces 自动部署）

本 Space 由 `deploy/hf/Dockerfile` 构建，对外暴露 `POST /analyze` 与 `GET /health`。
模型权重在构建期内置进镜像，运行时离线加载，无需联网下载。

部署完成后，把前端 `frontend/lib/config.js` 的 `DEV_API_URL`（或打 APK 时的 `extra.apiUrl`）
指向本 Space 的 HTTPS 地址即可。
