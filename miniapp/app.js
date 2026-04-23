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
    // 云托管部署后使用 wx.cloud.callContainer，无需 apiBase
    // 本地调试时取消注释下行：'http://localhost:8000'
    apiBase: '',
    // 模式: 'ws' (WebSocket) 或 'http' (轮询，云托管推荐)
    mode: 'http',
    // 轮询间隔（毫秒），越小越流畅但越耗流量
    pollInterval: 200,
    // 云托管环境 ID（从微信云托管控制台获取）
    cloudEnvId: 'prod-d9ghp6oco3b5879a4',
  }
})
