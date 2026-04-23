App({
  onLaunch() {
    // 初始化云开发环境（callContainer 前必须调用）
    if (wx.cloud) {
      wx.cloud.init({
        env: 'prod-d9ghp6oco3b5879a4',
        traceUser: true
      })
      console.log('[App] wx.cloud.init done, env=prod-d9ghp6oco3b5879a4')
    } else {
      console.error('[App] wx.cloud not available')
    }
  },
  globalData: {
    // 云托管公网域名（每次重新部署会变，从云托管控制台复制）
    apiBase: 'https://motion-monitor-249217-4-1424394595.sh.run.tcloudbase.com',
    // 模式: 'ws' (WebSocket) 或 'http' (轮询)
    mode: 'http',
    // 轮询间隔（毫秒），越小越流畅但越耗流量
    pollInterval: 200,
    // 云托管环境 ID
    cloudEnvId: 'prod-d9ghp6oco3b5879a4',
  }
})
