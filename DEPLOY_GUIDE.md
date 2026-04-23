# 🚀 运动监测小程序 - 微信云托管部署指南

> 基于实际部署踩坑经验整理，每一步都经过验证。

---

## 📋 前置准备

| 准备项 | 值 |
|--------|-----|
| 小程序 AppID | `wx8605cad71af24bc4` |
| GitHub 仓库 | `https://github.com/JYT2048/motion-monitor` |
| 本地代理 | `127.0.0.1:7897`（推送 GitHub 用） |

---

## 📁 项目结构

```
motion-monitor/
├── Dockerfile                    ← 云托管构建文件（必须在根目录）
├── container.config.json         ← 云托管扩缩容配置
├── .dockerignore
├── .gitignore
├── DEPLOY_GUIDE.md               ← 本文件
├── miniapp/                      ← 微信小程序端
│   ├── app.js                    ← 入口（配置 apiBase）
│   ├── app.json
│   ├── app.wxss
│   ├── project.config.json
│   └── pages/
│       ├── index/                ← 主页面
│       └── privacy/              ← 隐私协议页
└── server/                       ← FastAPI 后端
    ├── main.py                   ← 推理服务（MediaPipe Pose）
    └── requirements.txt
```

---

## 第 1 步：部署后端到云托管

### 1.1 创建服务

1. 登录 [mp.weixin.qq.com](https://mp.weixin.qq.com) → **云开发** → **云托管**
2. 点击 **新建服务**
3. 填写：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 服务名称 | 任意英文小写 | 每次新建都会变，无需记 |
| 监听端口 | `8000` | FastAPI 端口 |

### 1.2 关联 GitHub

1. 进入服务 → **部署发布** → **新建版本**
2. 部署方式：**代码仓库**
3. 授权 GitHub `JYT2048` 账号
4. 选择 `JYT2048/motion-monitor`，分支 `main`
5. Dockerfile 路径：`/Dockerfile`（默认）
6. 点击 **发布**

### 1.3 等待构建

- 约 3-5 分钟（首次下载 Python 镜像 + 安装 MediaPipe）
- 看到 `Deployed version xxx` → 部署完成

### 1.4 配置扩缩容

进入服务 → **设置** → **扩缩容配置**：

| 配置项 | 推荐值 | 说明 |
|--------|--------|------|
| 最小实例 | **0** | 不用时自动关停，省钱 |
| 最大实例 | 3 | |
| 规格 | **1核2G** | model_complexity=0，1核足够 |
| 扩缩容策略 | CPU 阈值 60% | |

> 💡 最小实例为 0 时不产生费用，冷启动约 3-5 秒。

### 1.5 复制公网域名

部署成功后，服务详情页会显示**公网访问域名**，格式如：
```
https://motion-monitor-xxxxx-x-xxxxxxxxxx.sh.run.tcloudbase.com
```

**每次重新部署域名会变**，需要更新到 `miniapp/app.js` 的 `apiBase`。

---

## 第 2 步：配置小程序端

### 2.1 更新 apiBase

修改 `miniapp/app.js`，将 `apiBase` 改为上一步复制的公网域名：

```js
App({
  globalData: {
    apiBase: 'https://你的公网域名.sh.run.tcloudbase.com',
    pollInterval: 300,
  }
})
```

### 2.2 域名白名单（正式发布时需要）

1. 登录 [mp.weixin.qq.com](https://mp.weixin.qq.com)
2. **开发管理** → **开发设置** → **服务器域名**
3. 将公网域名添加到 **request 合法域名**

> 开发调试阶段，在开发者工具 **详情 → 本地设置** 中勾选 **「不校验合法域名」** 即可跳过。

### 2.3 用开发者工具打开

1. 打开微信开发者工具 → **导入项目**
2. 目录选择 `motion-monitor/miniapp/`
3. AppID 填 `wx8605cad71af24bc4`
4. 后端服务选 **微信云开发**
5. 确定打开

---

## 第 3 步：调试

1. 模拟器或真机 → 点击 **开启摄像头** → 授权
2. 站在镜头前 → 应出现骨骼追踪
3. 观察控制台 `[Health]` 和 `[Poll]` 日志
4. 预期 FPS：云托管 HTTP 模式约 **5-8 FPS**（优化后）

---

## 第 4 步：发布上线

1. 开发者工具 → **上传** → 版本号 `1.0.0`
2. [mp.weixin.qq.com](https://mp.weixin.qq.com) → **版本管理** → **提交审核**
3. 审核通过后 → **发布**

---

## 🔧 已踩的坑

| 坑 | 表现 | 解决 |
|----|------|------|
| Dockerfile 不在根目录 | `InvalidParameter: 代码仓库中没有找到Dockerfile` | 根目录建 Dockerfile，`COPY server/` |
| `libgl1-mesa-glx` 不存在 | build 失败 | python:3.11-slim 基于 Debian Trixie，改用 `libgl1` |
| callContainer 服务名对不上 | `-606001` / `-501000 Invalid host` | 弃用 callContainer，改用 wx.request 公网域名 |
| 每次重新部署服务名会变 | 之前能用的服务名下次就失效 | wx.request + 公网域名，不依赖服务名 |
| 原始 RGBA 帧体积大导致卡顿 | 300KB/帧，FPS 仅 1-2 | 客户端 Canvas 缩放 + JPEG 压缩，降至 ~15KB/帧 |

---

## ⚡ 性能优化说明

| 优化项 | 旧方案 | 新方案 | 效果 |
|--------|--------|--------|------|
| 帧数据格式 | RGBA 原始 base64 (~300KB) | JPEG 压缩 base64 (~15KB) | 传输量降 20 倍 |
| 帧尺寸 | 原始 640×480 | 缩放到 320×240 | 推理加速 4 倍 |
| MediaPipe 复杂度 | model_complexity=1 | model_complexity=0 | 推理加速 2-3 倍 |
| 服务端 resize | 无 | 推理前 resize 到 320×240 | 防止大图拖慢推理 |

---

## 💰 费用预估

| 资源 | 单价 | 预估月费（每天 30 分钟） |
|------|------|------------------------|
| CPU | 0.055 元/核/分钟 | ~10 元 |
| 内存 | 0.015 元/GB/分钟 | ~5 元 |
| 流量 | 0.8 元/GB | ~3 元 |
| **合计** | | **约 18 元/月** |

> model_complexity=0 + 1核2G 规格，费用低于之前的 2核4G 方案。

---

## 📝 更新代码后的流程

1. 修改代码 → 推送到 GitHub
2. 云托管控制台 → 重新发布（获取新公网域名）
3. 更新 `miniapp/app.js` 的 `apiBase`
4. 小程序重新编译测试

```powershell
cd "c:\Users\h1764\WorkBuddy\20260421162748\motion-monitor"
git add .
git commit -m "描述你的修改"
git push origin main
```
