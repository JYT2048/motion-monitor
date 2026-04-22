# 手动推送代码到 GitHub

## 前提
- Git 已安装（✅ 已完成）
- 代码已提交（✅ 已完成）
- 代理已配置（✅ 7897 端口）
- GitHub 仓库已创建（✅ https://github.com/jyt2046-max/motion-monitor）

## 需要你做的：生成 Personal Access Token

1. 浏览器打开 https://github.com/settings/tokens/new
2. Note: 填 `motion-monitor`
3. Expiration: 选 90 days
4. 勾选 ✅ `repo`（第一个大选项，全勾上）
5. 点击绿色按钮「Generate token」
6. 复制生成的 Token（以 ghp_ 开头，只显示一次！）

## 执行推送

打开 PowerShell，依次执行以下命令：

```powershell
# 1. 进入项目目录
cd "c:\Users\h1764\WorkBuddy\20260421162748\motion-monitor"

# 2. 设置代理（如果你开了代理/VPN）
$env:https_proxy="http://127.0.0.1:7897"
$env:http_proxy="http://127.0.0.1:7897"

# 3. 设置远程地址（把 YOUR_TOKEN 替换成你的 Token）
git remote set-url origin https://YOUR_TOKEN@github.com/jyt2046-max/motion-monitor.git

# 4. 推送！
git push -u origin main
```

## 推送成功后

访问 https://github.com/jyt2046-max/motion-monitor 就能看到代码了！

## 如果不用代理了，取消代理设置

```powershell
git config --global --unset http.proxy
git config --global --unset https.proxy
```
