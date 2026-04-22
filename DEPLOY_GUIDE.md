# 🚀 运动监测小程序 - 微信云托管部署指南

> 基于实际部署踩坑经验整理，每一步都经过验证。
> 你的信息：AppID `wx8605cad71af24bc4`，环境 `prod-d9ghp6oco3b5879a4`，GitHub `JYT2048/motion-monitor`

---

## 📋 前置准备（已完成 ✅）

| 准备项 | 状态 | 值 |
|--------|------|----|
| 小程序 AppID | ✅ | `wx8605cad71af24bc4` |
| 云开发环境 | ✅ | `prod-d9ghp6oco3b5879a4` |
| GitHub 仓库 | ✅ | `https://github.com/JYT2048/motion-monitor` |
| 本地代理 | ✅ | `127.0.0.1:7897`（推送 GitHub 用） |

---

## 第 1 步：确认仓库文件结构

云托管要求 **Dockerfile 和 container.config.json 必须在仓库根目录**。

当前仓库结构：

```
motion-monitor/
├── Dockerfile                    ← ✅ 根目录（云托管必需）
├── container.config.json         ← ✅ 根目录（云托管必需）
├── .gitignore
├── DEPLOY_GUIDE.md
├── index.html                    ← Web 版
├── miniapp/                      ← 小程序端
│   ├── app.js
│   ├── app.json
│   ├── app.wxss
│   ├── project.config.json
│   └── pages/
│       ├── index/
│       └── privacy/
└── server/                       ← FastAPI 后端
    ├── main.py
    ├── Dockerfile                ← 原始位置（保留，本地构建用）
    ├── container.config.json     ← 原始位置（保留）
    └── requirements.txt
```

### ⚠️ 已踩的坑

| 坑 | 表现 | 解决 |
|----|------|------|
| Dockerfile 不在根目录 | `InvalidParameter: 代码仓库中没有找到Dockerfile` | 在根目录创建 Dockerfile，`COPY server/` 取代码 |
| `libgl1-mesa-glx` 不存在 | `E: Package 'libgl1-mesa-glx' has no installation candidate` | python:3.11-slim 基于 Debian Trixie，包名改为 `libgl1` |

### 根目录 Dockerfile 内容（当前已生效）

```dockerfile
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server/ .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 第 2 步：在云托管创建服务

### 2.1 进入云托管

1. 登录 [mp.weixin.qq.com](https://mp.weixin.qq.com)
2. 左侧菜单 → **「云开发」**→ 进入云开发控制台
3. 顶部 Tab → **「云托管」**

### 2.2 新建服务

1. 点击 **「新建服务」**
2. 填写：

| 配置项 | 填写 | 说明 |
|--------|------|------|
| 服务名称 | `motion-monitor` | **必须英文小写**，和 `X-WX-SERVICE` 一致 |
| 服务描述 | 运动姿态监测推理服务 | 随意 |
| 监听端口 | `8000` | FastAPI 端口 |

### 2.3 关联 GitHub 仓库

1. 进入服务 → **「部署发布」**→ 点击 **「新建版本」**
2. 部署方式选 **「代码仓库」**
3. 点击 **「授权 GitHub」**→ 授权 `JYT2048` 账号
4. 选择仓库 `JYT2048/motion-monitor`，分支 `main`
5. 确认配置：
   - Dockerfile 路径：`/Dockerfile`（默认，不用改）
   - 监听端口：`8000`
6. 点击 **「发布」**

### 2.4 等待构建

- 构建时间约 **3-5 分钟**（首次下载 Python 镜像 + 安装 MediaPipe）
- 点击 **「查看日志」** 实时监控
- 日志中看到 `Successfully built xxx` → 构建成功
- 看到 `Deployed version xxx` → 部署完成

### 2.5 配置扩缩容

进入服务 → **「设置」**→ **「扩缩容配置」**：

| 配置项 | 推荐值 | 说明 |
|--------|--------|------|
| 最小实例 | **0** | 不用时自动关停，**省钱** |
| 最大实例 | 3 | 个人使用足够 |
| 规格 | **2核4G** | MediaPipe 需要算力和内存 |
| 扩缩容策略 | CPU 阈值 60% | 超 60% 自动扩容 |

> 💡 最小实例设为 0 时，无人使用不产生费用，但有 3-5 秒冷启动。

### 2.6 验证服务

部署完成后，服务详情页会显示服务地址。点击访问，应返回：

```json
{"service": "Motion Monitor API", "status": "running"}
```

---

## 第 3 步：配置小程序端

### 3.1 填入 AppID

修改 `miniapp/project.config.json`：

```json
{
  "appid": "wx8605cad71af24bc4"
}
```

### 3.2 确认 app.js 配置

当前 `app.js` 无需修改（云托管通过 `wx.cloud.callContainer` 调用，不需要写死 API 地址）：

```js
App({
  globalData: {
    mode: 'http',          // 云托管用 HTTP 轮询模式
    pollInterval: 200,     // 200ms 轮询间隔
  }
})
```

### 3.3 确认 callContainer 调用

`pages/index/index.js` 中已包含云托管调用逻辑，关键参数：

```js
wx.cloud.callContainer({
  config: { env: app.globalData.cloudEnvId },  // 使用显式环境 ID
  path: '/api/pose',                                // API 路径
  method: 'POST',
  header: { 'X-WX-SERVICE': 'motion-monitor' },    // ← 必须和云托管服务名一致
  ...
})
```

> ⚠️ **`X-WX-SERVICE`** 的值必须和第 2 步创建的服务名完全一致，都是 `motion-monitor`！

### 3.4 用开发者工具打开项目

1. 打开微信开发者工具
2. 点击 **「导入项目」**
3. 目录选择 `motion-monitor/miniapp/`
4. AppID 填 `wx8605cad71af24bc4`
5. 后端服务选 **「微信云开发」**
6. 确定打开

### 3.5 开发者工具中调试

1. 工具栏 → **「云开发」**→ 确认云托管服务状态为「运行中」
2. 模拟器点击「开始监测」→ 授权摄像头
3. 观察控制台 Network → `/api/pose` 是否正常返回

---

## 第 4 步：真机调试

1. 开发者工具 → **「预览」** 或 **「真机调试」**
2. 手机微信扫码
3. 测试项：
   - [ ] 摄像头权限授权正常
   - [ ] 站在镜头前 → 骨架渲染
   - [ ] 做深蹲 → 计数增加
   - [ ] 举手 → 识别正确
   - [ ] FPS 稳定（云托管 HTTP 模式约 3-5 FPS）

> ⚠️ 调试阶段需取消勾选：详情 → 本地设置 → **「不校验合法域名」**

---

## 第 5 步：提交审核 → 发布上线

### 5.1 上传代码

1. 开发者工具 → **「上传」**
2. 版本号：`1.0.0`
3. 备注：`运动姿态监测小程序，首版发布`

### 5.2 提交审核

1. 登录 [mp.weixin.qq.com](https://mp.weixin.qq.com)
2. **版本管理** → 找到开发版 → **「提交审核」**
3. 填写：

| 字段 | 内容 |
|------|------|
| 功能页面 | `pages/index/index` |
| 功能描述 | 通过摄像头实时检测运动姿态，提供关节角度分析和动作计数 |
| 类目 | 工具 → 运动健康 |
| 隐私协议 | ✅ 已包含 `pages/privacy/privacy` |

### 5.3 审核通过后发布

1-3 天审核通过后 → 版本管理 → **「发布」**→ 全量发布 → 上线 🎉

---

## 💰 费用预估

| 资源 | 单价 | 预估月费（每天 30 分钟） |
|------|------|------------------------|
| CPU | 0.055 元/核/分钟 | ~20 元 |
| 内存 | 0.015 元/GB/分钟 | ~10 元 |
| 流量 | 0.8 元/GB | ~5 元 |
| **合计** | | **约 35 元/月** |

> 最小实例设 0 → 不用时免费。冷启动 3-5 秒。

---

## 🔧 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `Dockerfile not found` | Dockerfile 不在仓库根目录 | 在根目录建 Dockerfile，`COPY server/` |
| `libgl1-mesa-glx no installation candidate` | Debian Trixie 更名 | 改用 `libgl1` |
| `callContainer 404` | 服务名不匹配 | `X-WX-SERVICE` 值 = 云托管服务名 |
| 冷启动太慢 | 最小实例为 0 | 改最小实例为 1（但会增加费用） |
| 推理返回空 landmarks | 画面无人/置信度低 | 确保完整人体在镜头中 |

---

## 📝 更新代码后的推送流程

```powershell
cd "c:\Users\h1764\WorkBuddy\20260421162748\motion-monitor"

# 1. 暂存修改
git add .

# 2. 提交
git commit -m "描述你的修改"

# 3. 推送（需要代理）
$env:https_proxy="http://127.0.0.1:7897"
$env:http_proxy="http://127.0.0.1:7897"
git push origin main
```

推送后，云托管会自动检测到新版本，在「部署发布」页面确认即可。
