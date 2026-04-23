// pages/index/index.js
const app = getApp()

// MediaPipe Pose 骨骼连接定义
const SKELETON_CONNECTIONS = [
  // 躯干
  [11, 12], [11, 23], [12, 24], [23, 24],
  // 左臂
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21],
  // 右臂
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22],
  // 左腿
  [23, 25], [25, 27], [27, 29], [27, 31],
  // 右腿
  [24, 26], [26, 28], [28, 30], [28, 32],
]

// 关节名称映射
const LANDMARK_NAMES = [
  '鼻', '左眼内', '左眼', '左眼外', '右眼内', '右眼', '右眼外',
  '左耳', '右耳', '嘴左', '嘴右',
  '左肩', '右肩', '左肘', '右肘', '左腕', '右腕',
  '左拇指', '右拇指', '左食指', '右食指', '左小指', '右小指',
  '左髋', '右髋', '左膝', '右膝', '左踝', '右踝',
  '左脚跟', '右脚跟', '左脚尖', '右脚尖'
]

// 需要标注名称的关键关节
const KEY_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]

// 颜色方案
const COLORS = {
  torso: '#06d6a0',
  leftLimb: '#ffd166',
  rightLimb: '#118ab2',
  majorJoint: '#06d6a0',
  minorJoint: '#118ab2',
  angleText: '#ef476f',
  labelText: '#e2e8f0',
}

function getConnectionSide(i, j) {
  const left = [11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]
  const right = [12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]
  const iLeft = left.includes(i), jLeft = left.includes(j)
  const iRight = right.includes(i), jRight = right.includes(j)
  if (iLeft && jLeft) return 'left'
  if (iRight && jRight) return 'right'
  return 'torso'
}

Page({
  data: {
    cameraReady: false,
    fps: 0,
    motionEmoji: '🧍',
    motionLabel: '等待检测',
    motionSub: '',
    angles: {
      leftElbow: '--', rightElbow: '--',
      leftKnee: '--', rightKnee: '--',
      leftShoulder: '--', rightShoulder: '--'
    },
    counters: { squat: 0, raise: 0, jump: 0 },
    sessionTime: '00:00',
    activeTime: '00:00',
    totalActions: 0,
    debugInfo: '',
    showSkeleton: true,
  },

  _state: {
    squatState: 'up',
    raiseState: 'down',
    jumpState: 'ground',
    jumpCooldown: 0,
    centerHistory: [],
    activeSeconds: 0,
    sessionStart: null,
    fpsCount: 0,
    fpsLast: 0,
    listener: null,
    canvas: null,
    ctx: null,
    timerInterval: null,
    processing: false,
    pollTimer: null,
    statusTimer: null,
    latestFrame: null,
    useCloudContainer: false,
    frameCount: 0,
    requestCount: 0,
    errorCount: 0,
    prevLandmarks: null,
    cloudReady: false, // 云托管连通标记
  },

  onLoad() {
    // 云初始化已在 app.js onLaunch 中完成
    if (wx.cloud) {
      this._state.useCloudContainer = true
      console.log('[Init] Cloud container mode enabled')
    }
  },

  onUnload() {
    this.stopCamera()
    if (this._state.timerInterval) clearInterval(this._state.timerInterval)
    if (this._state.pollTimer) clearInterval(this._state.pollTimer)
    if (this._state.statusTimer) clearInterval(this._state.statusTimer)
  },

  // =================== Camera ===================
  startCamera() {
    const that = this
    wx.authorize({
      scope: 'scope.camera',
      success() {
        console.log('[Camera] authorize success')
        that._openCamera()
      },
      fail() {
        wx.openSetting({
          success(settingRes) {
            if (settingRes.authSetting['scope.camera']) {
              that._openCamera()
            } else {
              wx.showToast({ title: '需要摄像头权限', icon: 'none' })
            }
          }
        })
      }
    })
  },

  _openCamera() {
    const that = this
    console.log('[Camera] Opening camera...')
    that.setData({ cameraReady: true, debugInfo: '正在初始化摄像头...' })

    setTimeout(() => {
      that.setupFrameListener()
      that.setupCanvas()
      that.startSession()

      // 定时状态汇报
      that._state.statusTimer = setInterval(() => {
        if (!that._state.processing) {
          const fc = that._state.frameCount
          const rc = that._state.requestCount
          const ec = that._state.errorCount
          that.setData({
            debugInfo: '帧=' + fc + ' 请求=' + rc + ' 错误=' + ec + ' 云托管=' + that._state.useCloudContainer + ' 连通=' + that._state.cloudReady
          })
        }
      }, 3000)

      // 先测云托管连通性，连通后再开轮询
      that.testCloudConnection()
    }, 1500)
  },

  onCameraError(e) {
    console.error('[Camera] Error:', e.detail)
    this.setData({ debugInfo: '❌ 摄像头错误: ' + (e.detail.errMsg || ''), cameraReady: false })
  },

  onCameraStop() {
    this.setData({ debugInfo: '摄像头已停止' })
  },

  onCameraInitDone(e) {
    console.log('[Camera] Init done')
    this.setData({ debugInfo: '摄像头已就绪' })
  },

  stopCamera() {
    if (this._state.listener) {
      this._state.listener.stop()
      this._state.listener = null
    }
  },

  // =================== Canvas ===================
  setupCanvas() {
    const query = wx.createSelectorQuery()
    query.select('#poseCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0]) {
          console.warn('[Canvas] poseCanvas node not found')
          return
        }
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo().pixelRatio
        canvas.width = res[0].width * dpr
        canvas.height = res[0].height * dpr
        ctx.scale(dpr, dpr)
        this._state.canvas = canvas
        this._state.ctx = ctx
        console.log('[Canvas] Setup done:', canvas.width, 'x', canvas.height, 'dpr=' + dpr)
      })
  },

  // =================== Frame Listener ===================
  setupFrameListener() {
    try {
      const camera = wx.createCameraContext()
      const listener = camera.onCameraFrame((frame) => {
        this._state.frameCount++
        this._state.latestFrame = frame

        if (this._state.frameCount === 1) {
          console.log('[Frame] First frame:', frame.width + 'x' + frame.height, Math.round(frame.data.byteLength / 1024) + 'KB')
          this.setData({ debugInfo: '✅ 帧数据已采集 ' + frame.width + 'x' + frame.height })
        }
        if (this._state.frameCount % 60 === 0) {
          console.log('[Frame] #' + this._state.frameCount)
        }
      })

      listener.start({
        success: () => {
          console.log('[Frame] Listener started')
          this.setData({ debugInfo: '帧监听已启动...' })
        },
        fail: (err) => {
          console.error('[Frame] Listener start failed:', err)
          this.setData({ debugInfo: '❌ 帧监听启动失败: ' + (err.errMsg || '') })
        }
      })
      this._state.listener = listener
    } catch (e) {
      console.error('[Frame] Exception:', e)
      this.setData({ debugInfo: '❌ 帧监听异常: ' + e.message })
    }
  },

  // =================== Cloud Connection Test ===================
  testCloudConnection() {
    if (!this._state.useCloudContainer) {
      this.setData({ debugInfo: '⚠️ 云托管不可用，请配置 apiBase' })
      return
    }

    const envId = app.globalData.cloudEnvId
    const serviceName = 'motion-monitor-002'
    this.setData({ debugInfo: '🔍 测试云托管... (env=' + envId + ', svc=' + serviceName + ')' })

    wx.cloud.callContainer({
      config: { env: envId },
      path: '/health',
      method: 'GET',
      header: { 'X-WX-SERVICE': serviceName },
      success: (res) => {
        console.log('[Cloud] Health OK:', res.statusCode, res.data)
        this._state.cloudReady = true
        this.setData({ debugInfo: '✅ 云托管连通! 开始动作捕捉...' })
        // 连通后才开轮询
        this.startPolling()
      },
      fail: (err) => {
        console.error('[Cloud] Health fail:', err.errMsg || '')
        this._state.cloudReady = false
        this.setData({ debugInfo: '❌ 云托管不通: ' + (err.errMsg || '').substring(0, 100) })
        // 5 秒后重试
        setTimeout(() => this.testCloudConnection(), 5000)
      }
    })
  },

  // =================== HTTP Polling ===================
  startPolling() {
    if (this._state.pollTimer) return // 防止重复
    console.log('[Poll] Started, interval=500ms')
    this._state.pollTimer = setInterval(() => {
      if (!this._state.latestFrame || this._state.processing) return
      const frame = this._state.latestFrame
      this._state.processing = true
      this.sendFrameHTTP(frame)
    }, 500)
  },

  async sendFrameHTTP(frame) {
    try {
      if (!frame || !frame.data) {
        this._state.processing = false
        return
      }

      const base64 = wx.arrayBufferToBase64(frame.data)
      const payload = {
        data: base64,
        width: frame.width,
        height: frame.height,
        format: 'rgba'
      }

      this._state.requestCount++
      const reqId = this._state.requestCount

      let result

      if (this._state.useCloudContainer) {
        result = await new Promise((resolve, reject) => {
          wx.cloud.callContainer({
            config: { env: app.globalData.cloudEnvId },
            path: '/api/pose',
            method: 'POST',
            data: payload,
            header: {
              'X-WX-SERVICE': 'motion-monitor-002',
              'content-type': 'application/json'
            },
            success(res) { resolve(res.data) },
            fail(err) { reject(err) }
          })
        })
      } else {
        const apiBase = app.globalData.apiBase
        if (!apiBase) {
          this.setData({ debugInfo: '⚠️ 无服务地址，请配置 apiBase 或云托管' })
          this._state.processing = false
          return
        }
        const res = await new Promise((resolve, reject) => {
          wx.request({
            url: apiBase + '/api/pose',
            method: 'POST',
            data: payload,
            header: { 'content-type': 'application/json' },
            success(res) { resolve(res.data) },
            fail(err) { reject(err) }
          })
        })
        result = res
      }

      // 处理结果
      if (result && result.landmarks) {
        this.onPoseResult(result)
      } else if (result && result.error) {
        this._state.errorCount++
        this.clearSkeleton()
        this.setData({ debugInfo: '❌ #' + reqId + ': ' + result.error })
      } else {
        this.clearSkeleton()
      }

    } catch (e) {
      this._state.errorCount++
      const errMsg = e.errMsg || e.message || String(e)
      console.error('[Request] Error:', errMsg)
      this.setData({ debugInfo: '❌ 请求失败: ' + errMsg.substring(0, 80) })
    } finally {
      this._state.processing = false
    }
  },

  // =================== Pose Result ===================
  onPoseResult(data) {
    let result
    try {
      result = typeof data === 'string' ? JSON.parse(data) : data
    } catch (e) { return }

    if (!result.landmarks) return

    const lm = result.landmarks
    const angles = this.computeAngles(lm)
    const motion = this.detectMotion(lm, angles)

    // 平滑
    const smoothedLm = this.smoothLandmarks(lm)
    this._state.prevLandmarks = smoothedLm

    // 绘制骨骼
    if (this.data.showSkeleton) {
      this.drawSkeleton(smoothedLm)
    }

    // FPS
    this._state.fpsCount++
    const now = Date.now()
    if (now - this._state.fpsLast >= 1000) {
      this.setData({ fps: this._state.fpsCount })
      this._state.fpsCount = 0
      this._state.fpsLast = now
    }

    // 更新 UI
    this.setData({
      angles: {
        leftElbow: Math.round(angles.leftElbow),
        rightElbow: Math.round(angles.rightElbow),
        leftKnee: Math.round(angles.leftKnee),
        rightKnee: Math.round(angles.rightKnee),
        leftShoulder: Math.round(angles.leftShoulder),
        rightShoulder: Math.round(angles.rightShoulder),
      },
      motionEmoji: motion.emoji,
      motionLabel: motion.label,
      motionSub: motion.sub,
      counters: { ...this._state.counters },
      totalActions: this._state.counters.squat + this._state.counters.raise + this._state.counters.jump,
    })
  },

  // =================== Landmark Smoothing ===================
  smoothLandmarks(lm, alpha) {
    alpha = alpha || 0.6
    if (!this._state.prevLandmarks) return lm
    return lm.map((p, i) => {
      const prev = this._state.prevLandmarks[i]
      if (!prev) return p
      return {
        x: prev.x + alpha * (p.x - prev.x),
        y: prev.y + alpha * (p.y - prev.y),
        visibility: p.visibility
      }
    })
  },

  // =================== Drawing ===================
  clearSkeleton() {
    const ctx = this._state.ctx
    if (!ctx || !this._state.canvas) return
    const dpr = wx.getWindowInfo().pixelRatio
    ctx.clearRect(0, 0, this._state.canvas.width / dpr, this._state.canvas.height / dpr)
  },

  drawSkeleton(lm) {
    const ctx = this._state.ctx
    const canvas = this._state.canvas
    if (!ctx || !canvas) return

    const dpr = wx.getWindowInfo().pixelRatio
    const w = canvas.width / dpr
    const h = canvas.height / dpr

    ctx.clearRect(0, 0, w, h)

    // 前置摄像头镜像
    const mirrorLm = lm.map(p => ({
      x: 1 - p.x,
      y: p.y,
      visibility: p.visibility || 0
    }))

    // 第 1 层：连线光晕
    SKELETON_CONNECTIONS.forEach(([i, j]) => {
      const a = mirrorLm[i], b = mirrorLm[j]
      if (a.visibility < 0.4 || b.visibility < 0.4) return
      const side = getConnectionSide(i, j)
      ctx.strokeStyle = side === 'left' ? 'rgba(255,209,102,0.15)' : side === 'right' ? 'rgba(17,138,178,0.15)' : 'rgba(6,214,160,0.15)'
      ctx.lineWidth = 8
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(a.x * w, a.y * h)
      ctx.lineTo(b.x * w, b.y * h)
      ctx.stroke()
    })

    // 第 2 层：连线实线
    SKELETON_CONNECTIONS.forEach(([i, j]) => {
      const a = mirrorLm[i], b = mirrorLm[j]
      if (a.visibility < 0.4 || b.visibility < 0.4) return
      const side = getConnectionSide(i, j)
      ctx.strokeStyle = side === 'left' ? COLORS.leftLimb : side === 'right' ? COLORS.rightLimb : COLORS.torso
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(a.x * w, a.y * h)
      ctx.lineTo(b.x * w, b.y * h)
      ctx.stroke()
    })

    // 第 3 层：关节点
    mirrorLm.forEach((p, i) => {
      if (p.visibility < 0.4) return
      const x = p.x * w, y = p.y * h
      const isKey = KEY_JOINTS.includes(i)
      const radius = isKey ? 7 : 4

      // 光晕
      ctx.beginPath()
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2)
      ctx.fillStyle = isKey ? 'rgba(6,214,160,0.2)' : 'rgba(17,138,178,0.15)'
      ctx.fill()

      // 实心
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = isKey ? COLORS.majorJoint : COLORS.minorJoint
      ctx.fill()

      // 白边
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 1.5
      ctx.stroke()
    })

    // 第 4 层：关节名称
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    KEY_JOINTS.forEach(i => {
      const p = mirrorLm[i]
      if (p.visibility < 0.5) return
      const x = p.x * w, y = p.y * h
      const name = LANDMARK_NAMES[i]
      const tw = ctx.measureText(name).width
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(x - tw / 2 - 3, y - 24, tw + 6, 14)
      ctx.fillStyle = COLORS.labelText
      ctx.fillText(name, x, y - 12)
    })

    // 第 5 层：角度标注
    const anglePairs = [
      { a: 11, b: 13, c: 15 },
      { a: 12, b: 14, c: 16 },
      { a: 23, b: 25, c: 27 },
      { a: 24, b: 26, c: 28 },
      { a: 13, b: 11, c: 23 },
      { a: 14, b: 12, c: 24 },
    ]

    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    anglePairs.forEach(({ a, b, c }) => {
      const pa = mirrorLm[a], pb = mirrorLm[b], pc = mirrorLm[c]
      if (pa.visibility < 0.5 || pb.visibility < 0.5 || pc.visibility < 0.5) return

      const angle = this.calcAngle(pa, pb, pc)
      const x = pb.x * w, y = pb.y * h
      const offsetX = (pa.x > 0.5 ? 1 : -1) * 20
      const offsetY = -20
      const labelX = x + offsetX
      const labelY = y + offsetY

      const text = Math.round(angle) + '°'
      const tw = ctx.measureText(text).width
      const rx = labelX - tw / 2 - 4, ry = labelY - 8, rw = tw + 8, rh = 16, rr = 4

      ctx.fillStyle = 'rgba(0,0,0,0.7)'
      ctx.beginPath()
      ctx.moveTo(rx + rr, ry)
      ctx.lineTo(rx + rw - rr, ry)
      ctx.arcTo(rx + rw, ry, rx + rw, ry + rr, rr)
      ctx.lineTo(rx + rw, ry + rh - rr)
      ctx.arcTo(rx + rw, ry + rh, rx + rw - rr, ry + rh, rr)
      ctx.lineTo(rx + rr, ry + rh)
      ctx.arcTo(rx, ry + rh, rx, ry + rh - rr, rr)
      ctx.lineTo(rx, ry + rr)
      ctx.arcTo(rx, ry, rx + rr, ry, rr)
      ctx.closePath()
      ctx.fill()

      ctx.fillStyle = COLORS.angleText
      ctx.fillText(text, labelX, labelY)

      ctx.strokeStyle = 'rgba(239,71,111,0.4)'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(labelX, labelY)
      ctx.stroke()
      ctx.setLineDash([])
    })
  },

  // =================== Angle Calculation ===================
  calcAngle(a, b, c) {
    const rad = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x)
    let angle = Math.abs(rad * 180 / Math.PI)
    if (angle > 180) angle = 360 - angle
    return angle
  },

  computeAngles(lm) {
    return {
      leftElbow: this.calcAngle(lm[11], lm[13], lm[15]),
      rightElbow: this.calcAngle(lm[12], lm[14], lm[16]),
      leftKnee: this.calcAngle(lm[23], lm[25], lm[27]),
      rightKnee: this.calcAngle(lm[24], lm[26], lm[28]),
      leftShoulder: this.calcAngle(lm[13], lm[11], lm[23]),
      rightShoulder: this.calcAngle(lm[14], lm[12], lm[24]),
    }
  },

  // =================== Motion Detection ===================
  detectMotion(lm, angles) {
    const motion = { label: '站立', emoji: '🧍', sub: '' }
    const s = this._state
    const avgKnee = (angles.leftKnee + angles.rightKnee) / 2

    if (avgKnee < 110) {
      s.squatState = 'down'
      motion.label = '深蹲中'
      motion.emoji = '🏋️'
      motion.sub = '膝角 ' + Math.round(avgKnee) + '°'
    } else if (s.squatState === 'down' && avgKnee >= 140) {
      s.squatState = 'up'
      s.counters.squat++
      motion.label = '深蹲完成'
      motion.emoji = '✅'
      motion.sub = '第 ' + s.counters.squat + ' 次'
    }

    const leftArmUp = lm[15].y < lm[11].y - 0.05
    const rightArmUp = lm[16].y < lm[12].y - 0.05

    if (leftArmUp && rightArmUp) {
      s.raiseState = 'up'
      motion.label = '双手举起'
      motion.emoji = '🙌'
    } else if (leftArmUp || rightArmUp) {
      s.raiseState = 'up'
      motion.label = leftArmUp ? '左手举起' : '右手举起'
      motion.emoji = '🙋'
    } else if (s.raiseState === 'up') {
      s.raiseState = 'down'
      s.counters.raise++
    }

    if (s.jumpCooldown > 0) s.jumpCooldown--
    const hipY = (lm[23].y + lm[24].y) / 2
    s.centerHistory.push(hipY)
    if (s.centerHistory.length > 30) s.centerHistory.shift()
    if (s.centerHistory.length >= 10 && s.jumpCooldown === 0) {
      const avg = s.centerHistory.reduce((a, b) => a + b, 0) / s.centerHistory.length
      if (hipY < avg - 0.06) {
        s.counters.jump++
        s.jumpCooldown = 20
        motion.label = '跳跃中'
        motion.emoji = '🦘'
        motion.sub = '第 ' + s.counters.jump + ' 次'
      }
    }

    if (motion.label !== '站立') s.activeSeconds += 0.2

    return motion
  },

  // =================== Session ===================
  startSession() {
    this._state.sessionStart = Date.now()
    this._state.activeSeconds = 0
    this._state.counters = { squat: 0, raise: 0, jump: 0 }

    this._state.timerInterval = setInterval(() => {
      if (!this._state.sessionStart) return
      const elapsed = Math.floor((Date.now() - this._state.sessionStart) / 1000)
      this.setData({
        sessionTime: this.formatTime(elapsed),
        activeTime: this.formatTime(Math.floor(this._state.activeSeconds)),
      })
    }, 1000)
  },

  formatTime(s) {
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
  },

  resetCounters() {
    this._state.counters = { squat: 0, raise: 0, jump: 0 }
    this._state.activeSeconds = 0
    this._state.sessionStart = Date.now()
    this.setData({ counters: { squat: 0, raise: 0, jump: 0 }, totalActions: 0 })
  }
})
