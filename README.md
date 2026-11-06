# Avo 植物管家 · AVO PLANT MANAGER

**Avo 植物管家** —— 面向家庭种植爱好者的植物健康诊断与嫁接辅助 App（课程原型，独立完成）。围绕「拍张照片 → 知道植物怎么了 → 能不能嫁接 → 慢慢养回来」提供 **识、诊、接、养、晒** 一站式闭环：拍照识别物种/病害、给出处理建议、判断嫁接兼容性、建立健康追踪档案看恢复趋势，还能在社区发帖交流。纯离线跑视觉模型，**不依赖云端识别、不构成农业建议**。

- 中文名 **Avo 植物管家**，英文名 **AVO PLANT MANAGER**（AVO＝牛油果🥑 形象吉祥物，取「守护每一株植物」之意；PLANT MANAGER＝植物管家）
- 品牌口径：Avo 植物管家 · 独立课程项目

## 功能特性

- **诊断（识 + 诊）**：拍照识别植物物种与病害（覆盖番茄、苹果、葡萄、辣椒、草莓等 14 种常见作物），双模型融合给出最高峰置信度结论与处理建议，可一键记入该株植物的健康档案
- **嫁接辅助（接）**：手填或按识别作物推断接穗/砧木品种，调用兼容性规则判断「能不能接、怎么接」，物种兜底模型负责兜底识别
- **健康追踪（养）**：为每株植物建立追踪档案，月历打卡 + 拍照记录 + 置信度趋势曲线（好转 / 恶化 / 持平 / 波动），追踪记录可点开看当时的照片与诊断
- **我的花园**：植物档案管理，历次诊断记录可回看照片与详情；新增植物自动去重，同一株不重复建档
- **发现（晒）**：小红书式种植社区——发帖（多图 ≤9 + 标签 ≤6 + 可见范围）、双列瀑布流、点赞、评论、关注、收藏；私密帖仅作者可见，草稿箱收纳被下架的帖子
- **个人资料**：登录注册、头像昵称、草稿箱、退出登录
- **管理员后台**（`/admin/`）：内容维护 / 用户治理（增删、设管理员）/ 帖子下架（takedown + 系统通知）与恢复 / 删评论 / 数据看板

## 技术栈

| 层 | 选型 |
|--|--|
| 前端 | Expo React Native（SDK 51）+ React；可打包 Android APK，也可 `expo export` 出 Web 静态页（网页端 `node serve.js` 起在 3000） |
| 后端 | FastAPI + Uvicorn + SQLite（单文件 `backend/data/app.db`） |
| 视觉模型 | PlantVillage MobileNetV2（实验室病害 38 类）/ PlantDoc EfficientNetV2（真实病害 28 类）/ PlantNet-300K ResNet18（物种兜底）；权重本地化，运行期离线 CPU 推理 |
| 部署 | Docker（Render / HuggingFace Spaces），仓库根 `render.yaml` 提供 Blueprint；`backend/Dockerfile` 构建期把三个模型下进镜像 |

## 数据库（核心业务表）

| 表 | 说明 |
|--|--|
| users | 用户（pbkdf2 加盐口令、角色 role、昵称 nickname、头像 avatar） |
| sessions | 登录会话（Bearer token，登录态真相源） |
| garden_plants | 我的花园植物档案（品种 variety / crop / 照片 photo_url / 创建时间） |
| diagnoses | 诊断记录（物种 / 病害 / 置信度 confidence / 建议 advice / 照片，关联植物） |
| tracks | 健康追踪档案（每株植物至多一条，含品种与起止时间，去重复用） |
| track_records | 追踪打卡（日期 / 笔记 note / 照片 image_url / 置信度，趋势曲线数据源） |
| posts | 社区动态（多图 / 标签 / 可见范围 is_public / 状态 status：published\|takedown；点赞评论计数） |
| comments | 单层评论（动态 id 与诊断 id 共用 parent_type 口径） |
| post_likes | 动态点赞（一人一条，幂等切换） |
| favorites | 收藏（帖子，一人一对象一条） |
| follows | 关注关系（follower / followee） |
| notifications | 站内通知（下架 / 系统公告等，作者与管理员均收） |

### 模型融合口径

- **双病害模型**：PlantVillage（实验室叶片图，38 类）+ PlantDoc（真实场景图，28 类）。每张输入图做 6 视角裁片（原图 + 中心 70% + 2×2 六成网格）分别推理，跨视角取平均分排名、展示取最佳单视角峰值（`backend/app/fusion.py` 决策树）
- **作物不一致以 PlantDoc 为准**（`PD_AUTHORITY=0.25`）：PlantVillage 是实验室模型，会出现高置信误判（如番茄→葡萄黑腐 0.929），以真实图模型纠偏
- **置信度门控**：`DISEASE_GATE=0.65` 直采、`DISEASE_GATE_LOW=0.30` 采但标低置信；嫁接侧 `retake_confidence=0.30` 才要求重拍、`low_confidence_hint=0.60` 出结论 + 黄条（规则见 `config/fusion_rules.json`，改后需重启）
- **物种兜底（PlantNet-300K）不可靠**：真实照片下易乱报且极端自信，根治靠真实照片微调；当前仅作兜底，不单独采信

## API 概览（后端统一跑在 `:8010`，管理接口前缀 `/api/admin`）

- **诊断**：`POST /analyze`（task_type 分诊断/嫁接/物种/纯拍照四场景）、`GET /varieties`、`GET /care/{crop}`
- **认证**：`POST /auth/register`、`POST /auth/login`、`POST /auth/demo`（体验账号）、`POST /auth/logout`、`GET /auth/me`、`POST /auth/change-password`、`POST /auth/change-username`
- **花园**：`GET /garden`、`GET /garden/{plant_id}`、`POST /garden`（新增植物）、`POST /garden/{plant_id}/photo`、`DELETE /garden/{plant_id}`、`POST /garden/{plant_id}/track`（建/复用追踪，去重）
- **健康追踪**：`POST /tracks`、`GET /tracks`、`GET /tracks/{track_id}`（含 `image_url` 打卡照片）
- **首页 / 天气**：`GET /home`（今日概览 + 我的植物）、`GET /weather`（Open-Meteo 免 key + IP 定位，失败回退演示数据）、`GET /todos`、`GET /diagnoses/recent`、`GET /diagnoses/{diagnosis_id}`
- **社区**：`GET /posts?tab=recommend|latest`、`POST /posts`、`GET /posts/{post_id}`、`PUT /posts/{post_id}`（编辑草稿/帖子）、`DELETE /posts/{post_id}`、`PATCH /posts/{post_id}/visibility`、`GET /drafts`、`POST /posts/{post_id}/comments`、`POST /posts/{post_id}/like`、`POST /posts/{post_id}/favorite`
- **用户 / 社交**：`GET /profile`、`POST /profile/update`（昵称 + 头像压 256px）、`POST /users/{user_id}/follow`、`GET /notifications`、`GET /notifications/unread_count`、`POST /notifications/read`
- **管理端**（role=admin）：`GET /api/admin/stats`、`GET /api/admin/users`、`DELETE /api/admin/users/{uid}`、`POST /api/admin/users/{uid}/role`、`GET /api/admin/posts`、`DELETE /api/admin/posts/{pid}`、`POST /api/admin/posts/{pid}/takedown`、`POST /api/admin/posts/{pid}/restore`、`DELETE /api/admin/comments/{cid}`

## 界面展示

| 首页 | 诊断 | 发现 |
|:---:|:---:|:---:|
| ![首页](docs/screenshots/home.png) | ![诊断](docs/screenshots/identify.png) | ![发现](docs/screenshots/discover.png) |
| **我的花园** | **个人资料** | |
| ![我的花园](docs/screenshots/garden.png) | ![个人资料](docs/screenshots/profile.png) | |

## 快速开始

### 后端（Python 3.11+，建议用自带虚拟环境）

```bash
cd backend
IDENTIFIER=model uvicorn app.main:app --host 0.0.0.0 --port 8010
```

打开 `http://localhost:8010/health` 自检，或 `http://localhost:8010/test/live_test.html` 用网页测试台。`backend/models/` 仅内置物种模型（PlantNet，约 45MB）；两个病害模型首次启动从 HuggingFace 下载缓存，国内网络不通时加 `HF_ENDPOINT=https://hf-mirror.com`。

### 前端网页版（Node 22+，最省事，无需 Expo 开发服务器）

```bash
cd frontend
npx expo export --platform web   # 产物在 frontend/dist/
node serve.js                    # 打开 http://localhost:3000
```

前端 API 地址：网页版固定 `http://localhost:8010`（`frontend/lib/config.js`，已注入 `notranslate` 防浏览器翻译冻结文案）；真机调试改 `LAN_API_URL` 为电脑局域网 IP。

### 前端真机 / 模拟器

```bash
cd frontend
npm install
npx expo start        # 真机用 Expo Go 扫码；浏览器预览用网页模式
```

### 演示账号

| 角色 | 账号 | 密码 | 说明 |
|--|--|--|--|
| 管理员 | `admin` | `admin123` | 用户治理 / 帖子下架恢复 / 删评论 / 看板 |
| 体验账号 | 自助注册 | 任意 | 首页「体验」按钮一键建演示号，含演示花园与帖子 |

## 目录结构

```
60-项目代码
├── backend
│   ├── app/                # FastAPI 源码（main 路由 / fusion 融合决策 / predict 推理 / db 数据层 / weather 天气 / care 养护建议）
│   ├── models/plantnet/    # 物种模型权重（PlantNet-300K ResNet18，约 45MB）
│   ├── data/               # SQLite（app.db）+ 上传图片 uploads/
│   ├── tests/              # 模型冒烟 / API / 逻辑单测
│   ├── Dockerfile + DEPLOY.md   # 镜像构建与部署说明
│   └── requirements.txt
├── frontend
│   ├── screens/            # 五个 tab 页面：Home / Identify / Community / Garden / Profile
│   ├── components/         # SmartImage（图片兜底）/ VarietyPicker（品种选择）
│   ├── lib/                # config（API 地址）/ api / webScale（桌面等比缩放）/ time / version
│   ├── assets/             # 吉祥物 Avo 四主题图 + 图标
│   ├── serve.js            # 网页静态服务（注入 notranslate，3000 端口）
│   └── app.json + eas.json # Expo 配置 / EAS 打包（preview = APK）
├── config/
│   ├── fusion_rules.json   # 病害识别融合门控规则（改后重启后端）
│   └── varieties.json      # 嫁接品种库（14 种，精确匹配）
├── prototype/              # 原型设计 + 吉祥物源文件 + live_test 网页测试台
├── test_samples/           # 自测用示例植物照片
├── docs/screenshots/       # README 界面截图（5 张）
├── deploy/                 # HF Spaces 部署说明
├── render.yaml             # Render Blueprint（连 GitHub 自动建服务）
└── 需求分析文档_v2.1_安卓版.md
```

## 部署后端（拿 HTTPS 地址）

后端用 Docker 一键部署到 Render（免费实例），详见 `backend/DEPLOY.md`；仓库根 `render.yaml` 已写好 Blueprint，连接 GitHub 仓库即自动建服务，构建期把三个模型下进镜像、运行期离线。

重点：打包 APK / 发正式版前，必须先把 `frontend/app.json` 里的 `extra.apiUrl` 改成后端 HTTPS 地址，再重新 `eas build`，否则真机连不上本地后端。

## 打包安卓 APK

```bash
cd frontend
eas build --platform android --profile preview
```

`frontend/eas.json` 的 preview 已设 `buildType: "apk"`，产物是可直接安装的 APK（非 AAB）。前提：已 `eas init` 并登录 Expo 账号。

## 注意事项

- **模型许可证**：物种模型 PlantNet-300K 为 Apache-2.0；两个病害模型许可证为 `other`，课程自用无碍，公开发布前请另行确认授权
- **数据持久化**：免费托管磁盘不持久，SQLite 与上传图片会在实例重启后丢失；空库会自动种演示帖与演示花园
- **管理员账号**：默认 `admin / admin123`，任何公开部署请通过环境变量 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 改掉
- **上传图片**：发帖 / 头像 / 追踪图片存在后端本地 `backend/data/uploads/`，上云后建议接对象存储做持久化
- **定位反向地理编码**：Open-Meteo + ipwho.is 按出口 IP 定位，无可用反向编码服务（nominatim/bigdatacloud 均不可达），坐标离 IP 定位 50km 内借城市名、否则显示「当前位置」
