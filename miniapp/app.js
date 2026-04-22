App({
  globalData: {
    // 云托管部署后，微信会自动注入环境变量，也可以直接写服务地址
    // 本地调试: 'http://localhost:8000'
    // 云托管: 使用 wx.cloud.callContainer 或直接写服务URL
    apiBase: 'http://localhost:8000',
    // 模式: 'ws' (WebSocket) 或 'http' (轮询，云托管推荐)
    mode: 'http',
    // 轮询间隔（毫秒），越小越流畅但越耗流量
    pollInterval: 200,
  }
})
