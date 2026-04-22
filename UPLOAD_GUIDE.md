# 📤 GitHub 网页手动上传指南

> 仓库地址：https://github.com/jyt2046-max/motion-monitor

## 操作流程

每次上传一组文件：
1. 打开仓库页面
2. 点击 **「Add file」**→**「Upload files」**
3. 在网页上拖入文件（或点击选择）
4. 底部 Commit message 填写说明
5. 点击 **「Commit changes」**

---

## ⚠️ 关键：如何上传子目录中的文件

GitHub 网页**不能直接拖文件夹**，但有个技巧：

**在文件名输入框中输入带路径的文件名**，比如：
- 输入 `miniapp/app.js` → GitHub 会自动创建 `miniapp/` 目录
- 输入 `miniapp/pages/index/index.js` → 自动创建多层目录

操作方式：
1. 点击 **「Add file」**→**「Create new file」**
2. 在文件名框输入完整路径，如 `miniapp/app.js`
3. 粘贴文件内容
4. 点击 **「Commit new file」**

---

## 第 1 批：根目录文件（直接拖拽上传）

打开 → https://github.com/jyt2046-max/motion-monitor

点击「Add file」→「Upload files」，拖入以下文件：

| 文件 | 说明 |
|------|------|
| `.gitignore` | Git 忽略规则 |
| `DEPLOY_GUIDE.md` | 部署指南 |
| `index.html` | Web 版主页面 |
| `PUSH_GUIDE.md` | 推送指南 |

Commit message：`add: root files`

---

## 第 2 批：miniapp/ 目录（逐个创建）

### 2.1 miniapp 根文件

逐个点击「Add file」→「Create new file」，输入路径并粘贴内容：

| 路径 | 操作 |
|------|------|
| `miniapp/app.js` | Create new file → 粘贴内容 |
| `miniapp/app.json` | 同上 |
| `miniapp/app.wxss` | 同上 |
| `miniapp/project.config.json` | 同上 |

### 2.2 miniapp/pages/index/ 文件

| 路径 | 操作 |
|------|------|
| `miniapp/pages/index/index.js` | Create new file → 粘贴内容 |
| `miniapp/pages/index/index.json` | 同上 |
| `miniapp/pages/index/index.wxml` | 同上 |
| `miniapp/pages/index/index.wxss` | 同上 |

### 2.3 miniapp/pages/privacy/ 文件

| 路径 | 操作 |
|------|------|
| `miniapp/pages/privacy/privacy.js` | Create new file → 粘贴内容 |
| `miniapp/pages/privacy/privacy.json` | 同上 |
| `miniapp/pages/privacy/privacy.wxml` | 同上 |
| `miniapp/pages/privacy/privacy.wxss` | 同上 |

---

## 第 3 批：server/ 目录（逐个创建）

| 路径 | 操作 |
|------|------|
| `server/main.py` | Create new file → 粘贴内容 |
| `server/Dockerfile` | 同上 |
| `server/container.config.json` | 同上 |
| `server/requirements.txt` | 同上 |

---

## 💡 省时技巧

> 每次创建新文件时，可以点完「Commit new file」后，URL 保持不变，直接继续点「Add file」→「Create new file」，不用每次都回到仓库首页。

---

## ✅ 验证

全部上传完成后，打开 https://github.com/jyt2046-max/motion-monitor

确认能看到以下目录结构：

```
motion-monitor/
├── .gitignore
├── DEPLOY_GUIDE.md
├── PUSH_GUIDE.md
├── index.html
├── miniapp/
│   ├── app.js
│   ├── app.json
│   ├── app.wxss
│   ├── project.config.json
│   └── pages/
│       ├── index/
│       │   ├── index.js
│       │   ├── index.json
│       │   ├── index.wxml
│       │   └── index.wxss
│       └── privacy/
│           ├── privacy.js
│           ├── privacy.json
│           ├── privacy.wxml
│           └── privacy.wxss
└── server/
    ├── Dockerfile
    ├── container.config.json
    ├── main.py
    └── requirements.txt
```
