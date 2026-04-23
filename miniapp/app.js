App({
  globalData: {
    // 云托管公网域名（每次重新部署会变，从云托管控制台复制最新地址）
    apiBase: 'https://motion-monitor-249217-4-1424394595.sh.run.tcloudbase.com',
    // 轮询间隔（毫秒），300ms 平衡流畅度与流量
    pollInterval: 300,
  }
})
