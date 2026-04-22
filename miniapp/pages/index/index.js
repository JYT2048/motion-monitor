// pages/index/index.js
const app = getApp()

// MediaPipe Pose 骨骼连接定义
const SKELETON_CONNECTIONS = [
  // 躯干
  [11, 12], // 左肩 - 右肩
  [11, 23], // 左肩 - 左髋
  [12, 24], // 右肩 - 右髋
  [23, 24], // 左髋 - 右髋
  // 左臂
  [11, 13], // 左肩 - 左肘
  [13, 15], // 左肘 - 左腕
  [15, 17], // 左腕 - 左拇指
  [15, 19], // 左腕 - 左食指
  [15, 21], // 左腕 - 左小指
  // 右臂
  [12, 14], // 右肩 - 右肘
  [14, 16], // 右肘 - 右腕
  [16, 18], // 右腕 - 右拇指
  [16, 20], // 右腕 - 右食指
  [16, 22], // 右腕 - 右小指
  // 左腿
  [23, 25], // 左髋 - 左膝
  [25, 27], // 左膝 - 左踝
  [27, 29], // 左踝 - 左脚跟
  [27, 31], // 左踝 - 左脚尖
  // 右腿
  [24, 26], // 右髋 - 右膝
  [26, 28], // 右膝 - 右踝
  [28, 30], // 右踝 - 右脚跟
  [28, 32], // 右踝 - 右脚尖
]

// 关节名称映射（中文）
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
  // 躯干线
  torso: '#06d6a0',
  // 左侧肢体线
  leftLimb: '#ffd166',
  // 右侧肢体线
  rightLimb: '#118ab2',
  // 关节点 - 主要
  majorJoint: '#06d6a0',
  // 关节点 - 次要
  minorJoint: '#118ab2',
  // 角度标注
  angleText: '#ef476f',
  // 关节名称
  labelText: '#e2e8f0',
  // 光晕
  glow: 'rgba(6,214,160,0.3)',
}

// 判断连接属于哪一侧
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
    // Mode switch: 'motion' | 'posture'
    activeMode: 'motion',
    // Motion
    motionEmoji: '🧍',
    motionLabel: '等待检测',
    motionSub: '开启摄像头后开始识别',
    // Angles
    angles: {
      leftElbow: '--',
      rightElbow: '--',
      leftKnee: '--',
      rightKnee: '--',
      leftShoulder: '--',
      rightShoulder: '--'
    },
    // Counters
    counters: { squat: 0, raise: 0, jump: 0 },
    // Stability
    stability: 0,
    symmetry: 0,
    // Session
    sessionTime: '00:00',
    activeTime: '00:00',
    totalActions: 0,
    // Posture assessment
    posture: null,
    postureScore: '--',
    postureStatus: '',
    postureEmoji: '',
    postureDetails: [],
    // Debug
    debugInfo: '',
    // Skeleton visibility
    showSkeleton: true,
  },

  // Internal state
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
    socketTask: null,
    timerInterval: null,
    processing: false,
    pollTimer: null,
    postureTimer: null,
    latestFrame: null,
    useCloudContainer: false,
    frameCount: 0,
    requestCount: 0,
    errorCount: 0,
    // 上一帧的 landmarks，用于平滑
    prevLandmarks: null,
    // camera 组件实际尺寸
    cameraWidth: 0,
    cameraHeight: 0,
  },

  onLoad() {
    // 检测是否使用云托管
    if (wx.cloud) {
      try {
        wx.cloud.init({
          traceUser: true,
        })
        this._state.useCloudContainer = true
        console.log('[Init] Cloud container mode enabled')
      } catch (e) {
        console.log('[Init] Cloud not available:', e.message)
      }
    }

    const mode = app.globalData.mode
    if (mode === 'ws') {
      this.connectWS()
    }
  },

  onUnload() {
    this.stopCamera()
    if (this._state.socketTask) {
      this._state.socketTask.close()
    }
    if (this._state.timerInterval) {
      clearInterval(this._state.timerInterval)
    }
    if (this._state.pollTimer) {
      clearInterval(this._state.pollTimer)
    }
    if (this._state.postureTimer) {
      clearInterval(this._state.postureTimer)
    }
  },

  // =================== Mode Switch ===================
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({ activeMode: mode })

    // 切换模式时重置对应的轮询
    if (this._state.pollTimer) {
      clearInterval(this._state.pollTimer)
      this._state.pollTimer = null
    }
    if (this._state.postureTimer) {
      clearInterval(this._state.postureTimer)
      this._state.postureTimer = null
    }

    if (this.data.cameraReady && app.globalData.mode === 'http') {
      if (mode === 'motion') {
        this.startPolling()
      } else {
        this.startPosturePolling()
      }
    }
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
        console.log('[Camera] authorize failed, opening settings...')
        wx.openSetting({
          success(settingRes) {
            if (settingRes.authSetting['scope.camera']) {
              that._openCamera()
            } else {
              wx.showToast({ title: '需要摄像头权限才能使用', icon: 'none' })
            }
          }
        })
      }
    })
  },

  _openCamera() {
    const that = this
    console.log('[Camera] Opening camera...')
    that.setData({ 
      cameraReady: true,
      debugInfo: '正在初始化摄像头...'
    })

    // 等 camera 组件渲染完成后初始化帧监听
    setTimeout(() => {
      that.setupFrameListener()
      that.setupCanvas()
      that.startSession()

      if (app.globalData.mode === 'http') {
        if (that.data.activeMode === 'motion') {
          that.startPolling()
        } else {
          that.startPosturePolling()
        }
      }

      that.setData({ debugInfo: '摄像头已就绪，等待帧数据...' })
    }, 1500)
  },

  onCameraError(e) {
    console.error('[Camera] Error:', e.detail)
    this.setData({ 
      debugInfo: '摄像头错误: ' + (e.detail.errMsg || JSON.stringify(e.detail)),
      cameraReady: false 
    })
    wx.showToast({ title: '摄像头启动失败', icon: 'none', duration: 3000 })
  },

  onCameraStop() {
    console.log('[Camera] Stopped')
    this.setData({ debugInfo: '摄像头已停止' })
  },

  onCameraInitDone(e) {
    console.log('[Camera] Init done:', e.detail)
    this.setData({ debugInfo: '摄像头初始化完成，开始采集...' })
    wx.showToast({ title: '摄像头已就绪', icon: 'success', duration: 1000 })
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
        this._state.canvasWidth = res[0].width
        this._state.canvasHeight = res[0].height
        console.log('[Canvas] Setup done:', canvas.width, 'x', canvas.height, 'dpr=' + dpr)
      })
  },

  // =================== Frame Listener ===================
  setupFrameListener() {
    try {
      const camera = wx.createCameraContext()
      console.log('[Frame] Setting up frame listener...')

      const listener = camera.onCameraFrame((frame) => {
        this._state.frameCount++
        // 只保留最新一帧，覆盖旧帧
        this._state.latestFrame = frame

        // 记录 camera 帧的实际尺寸
        this._state.cameraWidth = frame.width
        this._state.cameraHeight = frame.height

        // 每 30 帧打印一次日志
        if (this._state.frameCount % 30 === 0) {
          console.log('[Frame] #' + this._state.frameCount, frame.width + 'x' + frame.height, 'size=' + Math.round(frame.data.byteLength / 1024) + 'KB')
        }
      })

      listener.start()
      this._state.listener = listener
      console.log('[Frame] Listener started')
    } catch (e) {
      console.error('[Frame] Failed to setup listener:', e)
      this.setData({ debugInfo: '帧监听失败: ' + e.message })
    }
  },

  // =================== HTTP Polling (motion mode) ===================
  startPolling() {
    console.log('[Poll] Motion polling started, interval=500ms')
    this._state.pollTimer = setInterval(() => {
      if (!this._state.latestFrame || this._state.processing) return

      const frame = this._state.latestFrame
      this._state.processing = true
      this.sendFrameHTTP(frame, '/api/pose')
    }, 500)
  },

  // =================== Posture Polling (posture mode) ===================
  startPosturePolling() {
    console.log('[Poll] Posture polling started, interval=2000ms')
    this._state.postureTimer = setInterval(() => {
      if (!this._state.latestFrame || this._state.processing) return

      const frame = this._state.latestFrame
      this._state.processing = true
      this.sendFrameHTTP(frame, '/api/posture')
    }, 2000)
  },

  async sendFrameHTTP(frame, apiPath) {
    try {
      const arrayBuffer = frame.data
      const base64 = wx.arrayBufferToBase64(arrayBuffer)

      // frame-size="small" 产生约 160x120 RGBA，base64 ≈ 100KB
      const payload = {
        data: base64,
        width: frame.width,
        height: frame.height,
        format: 'rgba'
      }

      this._state.requestCount++
      const reqId = this._state.requestCount
      const sizeKB = Math.round(base64.length / 1024)
      console.log('[Request] #' + reqId, apiPath, 'frame=' + frame.width + 'x' + frame.height, 'base64=' + sizeKB + 'KB')

      // 更新 debug：发送中
      this.setData({ debugInfo: '发送第' + reqId + '次 (' + sizeKB + 'KB) ' + (this._state.useCloudContainer ? '云托管' : '直连') + '...' })

      let result

      if (this._state.useCloudContainer) {
        result = await new Promise((resolve, reject) => {
          wx.cloud.callContainer({
            config: { env: wx.cloud.DYNAMIC_CURRENT_ENV },
            path: apiPath,
            method: 'POST',
            data: payload,
            header: {
              'X-WX-SERVICE': 'motion-monitor1',
              'content-type': 'application/json'
            },
            success(res) {
              console.log('[Request] #' + reqId, 'success, status=' + res.statusCode, 'data=', JSON.stringify(res.data).substring(0, 300))
              resolve(res.data)
            },
            fail(err) {
              console.error('[Request] #' + reqId, 'callContainer failed:', err.errMsg || JSON.stringify(err))
              reject(err)
            }
          })
        })
      } else {
        const apiBase = app.globalData.apiBase
        if (!apiBase) {
          this.setData({ debugInfo: '⚠️ apiBase 为空且云托管不可用。请在云托管控制台关联服务。' })
          return
        }
        const res = await new Promise((resolve, reject) => {
          wx.request({
            url: apiBase + apiPath,
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
      if (result) {
        if (result.landmarks) {
          this.onPoseResult(result)
        } else {
          this.clearSkeleton()
          this.setData({ debugInfo: '第' + reqId + '次: 未检测到人体' })
        }
        if (result.posture && !result.posture.error) {
          this.onPostureResult(result.posture)
        }
        if (result.error) {
          this._state.errorCount++
          this.setData({ debugInfo: '第' + reqId + '次: ' + result.error })
        }
      } else {
        this.setData({ debugInfo: '第' + reqId + '次: 返回为空' })
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

  // =================== Posture Result ===================
  onPostureResult(posture) {
    const details = Object.keys(posture.details).map(key => {
      const d = posture.details[key]
      return {
        key,
        label: d.label,
        desc: d.desc,
        status: d.status,
        value: d.angle !== undefined ? d.angle + '°' : d.diff !== undefined ? d.diff + '%' : d.offset !== undefined ? d.offset + '%' : '',
      }
    })

    this.setData({
      postureScore: posture.overall_score,
      postureStatus: posture.overall_status,
      postureEmoji: posture.overall_emoji,
      postureDetails: details,
      posture: posture,
      debugInfo: '体态评分: ' + posture.overall_score + ' ' + posture.overall_label,
    })
  },

  // =================== WebSocket (直连模式) ===================
  connectWS() {
    const wsUrl = app.globalData.wsUrl
    if (!wsUrl) return

    const that = this
    const socketTask = wx.connectSocket({ url: wsUrl })

    socketTask.onOpen(() => {
      console.log('WS connected')
      wx.showToast({ title: '服务已连接', icon: 'success', duration: 1500 })
    })

    socketTask.onMessage((res) => {
      that.onPoseResult(res.data)
    })

    socketTask.onError((err) => {
      console.error('WS error:', err)
    })

    socketTask.onClose(() => {
      console.log('WS closed')
    })

    this._state.socketTask = socketTask
  },

  // =================== Pose Result ===================
  onPoseResult(data) {
    let result
    try {
      if (typeof data === 'string') {
        result = JSON.parse(data)
      } else {
        result = data
      }
    } catch (e) {
      return
    }

    if (!result.landmarks) return

    const lm = result.landmarks
    const angles = this.computeAngles(lm)
    const motion = this.detectMotion(lm, angles)
    const stability = this.computeStability(lm, angles)

    // 平滑处理 landmarks
    const smoothedLm = this.smoothLandmarks(lm)
    this._state.prevLandmarks = smoothedLm

    // Draw skeleton on canvas
    if (this.data.showSkeleton) {
      this.drawSkeleton(smoothedLm)
    }

    // 可见关键点数量
    const visibleCount = smoothedLm.filter(p => p.visibility >= 0.4).length
    this.setData({ debugInfo: '检测到 ' + visibleCount + '/33 个关键点' })

    // FPS
    this._state.fpsCount++
    const now = Date.now()
    if (now - this._state.fpsLast >= 1000) {
      this.setData({ fps: this._state.fpsCount })
      this._state.fpsCount = 0
      this._state.fpsLast = now
    }

    // Update UI
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
      stability: stability.stability,
      symmetry: stability.symmetry,
      counters: { ...this._state.counters },
      totalActions: this._state.counters.squat + this._state.counters.raise + this._state.counters.jump,
    })
  },

  // =================== Landmark Smoothing ===================
  smoothLandmarks(lm, alpha) {
    alpha = alpha || 0.6  // 平滑系数，0=完全用旧值，1=完全用新值
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

  // =================== Drawing - Enhanced Skeleton ===================
  clearSkeleton() {
    const ctx = this._state.ctx
    if (!ctx) return
    const canvas = this._state.canvas
    const dpr = wx.getWindowInfo().pixelRatio
    const w = canvas.width / dpr
    const h = canvas.height / dpr
    ctx.clearRect(0, 0, w, h)
  },

  drawSkeleton(lm) {
    const ctx = this._state.ctx
    if (!ctx) {
      console.warn('[Draw] No canvas context')
      return
    }

    const canvas = this._state.canvas
    const dpr = wx.getWindowInfo().pixelRatio
    const w = canvas.width / dpr
    const h = canvas.height / dpr

    // 清空画布
    ctx.clearRect(0, 0, w, h)

    // 前置摄像头需要镜像翻转 X 坐标
    const mirrorLm = lm.map(p => ({
      x: 1 - p.x,
      y: p.y,
      visibility: p.visibility || 0
    }))

    // --- 第 1 层：绘制连线光晕（外发光效果） ---
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

    // --- 第 2 层：绘制连线实线 ---
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

    // --- 第 3 层：绘制关节点 ---
    mirrorLm.forEach((p, i) => {
      if (p.visibility < 0.4) return
      const x = p.x * w, y = p.y * h
      const isKey = KEY_JOINTS.includes(i)
      const radius = isKey ? 7 : 4

      // 外圈光晕
      ctx.beginPath()
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2)
      ctx.fillStyle = isKey ? 'rgba(6,214,160,0.2)' : 'rgba(17,138,178,0.15)'
      ctx.fill()

      // 实心圆
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fillStyle = isKey ? COLORS.majorJoint : COLORS.minorJoint
      ctx.fill()

      // 白色边框
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = 1.5
      ctx.stroke()
    })

    // --- 第 4 层：关节名称标注 ---
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    KEY_JOINTS.forEach(i => {
      const p = mirrorLm[i]
      if (p.visibility < 0.5) return
      const x = p.x * w, y = p.y * h

      // 背景半透明矩形
      const name = LANDMARK_NAMES[i]
      const textWidth = ctx.measureText(name).width
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(x - textWidth / 2 - 3, y - 24, textWidth + 6, 14)

      // 文字
      ctx.fillStyle = COLORS.labelText
      ctx.fillText(name, x, y - 12)
    })

    // --- 第 5 层：角度标注 ---
    const anglePairs = [
      { a: 11, b: 13, c: 15, label: '左肘' },
      { a: 12, b: 14, c: 16, label: '右肘' },
      { a: 23, b: 25, c: 27, label: '左膝' },
      { a: 24, b: 26, c: 28, label: '右膝' },
      { a: 13, b: 11, c: 23, label: '左肩' },
      { a: 14, b: 12, c: 24, label: '右肩' },
    ]

    ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    anglePairs.forEach(({ a, b, c, label }) => {
      const pa = mirrorLm[a], pb = mirrorLm[b], pc = mirrorLm[c]
      if (pa.visibility < 0.5 || pb.visibility < 0.5 || pc.visibility < 0.5) return

      const angle = this.calcAngle(pa, pb, pc)
      const x = pb.x * w, y = pb.y * h

      // 角度标注偏移方向：朝向关节外侧
      const offsetX = (pa.x > 0.5 ? 1 : -1) * 20
      const offsetY = -20
      const labelX = x + offsetX
      const labelY = y + offsetY

      // 背景圆角矩形（兼容性写法）
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

      // 角度数值
      ctx.fillStyle = COLORS.angleText
      ctx.fillText(text, labelX, labelY)

      // 连线：从标注到关节点
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
      leftHip: this.calcAngle(lm[11], lm[23], lm[25]),
      rightHip: this.calcAngle(lm[12], lm[24], lm[26]),
    }
  },

  // =================== Motion Detection ===================
  detectMotion(lm, angles) {
    const motion = { label: '站立', emoji: '🧍', sub: '保持放松' }
    const s = this._state
    const avgKnee = (angles.leftKnee + angles.rightKnee) / 2
    const leftWristY = lm[15].y
    const rightWristY = lm[16].y
    const leftShoulderY = lm[11].y
    const rightShoulderY = lm[12].y

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
      motion.sub = '已完成 ' + s.counters.squat + ' 次'
    }

    const leftArmUp = leftWristY < leftShoulderY - 0.05
    const rightArmUp = rightWristY < rightShoulderY - 0.05

    if (leftArmUp && rightArmUp) {
      s.raiseState = 'up'
      motion.label = '双手举起'
      motion.emoji = '🙌'
    } else if (leftArmUp) {
      s.raiseState = 'up'
      motion.label = '左手举起'
      motion.emoji = '🙋'
    } else if (rightArmUp) {
      s.raiseState = 'up'
      motion.label = '右手举起'
      motion.emoji = '🙋'
    } else if (s.raiseState === 'up' && !leftArmUp && !rightArmUp) {
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
        s.jumpState = 'air'
        s.counters.jump++
        s.jumpCooldown = 20
      }
    }
    if (s.jumpState === 'air') {
      motion.label = '跳跃中'
      motion.emoji = '🦘'
      motion.sub = '第 ' + s.counters.jump + ' 次'
    }

    if (motion.label !== '站立') {
      s.activeSeconds += 0.2
    }

    return motion
  },

  // =================== Stability ===================
  computeStability(lm, angles) {
    const centerX = (lm[11].x + lm[12].x + lm[23].x + lm[24].x) / 4
    const offset = Math.abs(centerX - 0.5) * 100
    const elbowDiff = Math.abs(angles.leftElbow - angles.rightElbow)
    const kneeDiff = Math.abs(angles.leftKnee - angles.rightKnee)
    const stability = Math.round(Math.max(0, Math.min(100, 100 - offset * 5)))
    const symmetry = Math.round(Math.max(0, 100 - (elbowDiff + kneeDiff) / 2))
    return { stability, symmetry }
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
    const m = Math.floor(s / 60)
    const sec = s % 60
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0')
  },

  resetCounters() {
    this._state.counters = { squat: 0, raise: 0, jump: 0 }
    this._state.activeSeconds = 0
    this._state.sessionStart = Date.now()
    this.setData({
      counters: { squat: 0, raise: 0, jump: 0 },
      totalActions: 0,
    })
  }
})
