// pages/index/index.js
const app = getApp()

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
    frameQueue: [],
    useCloudContainer: false,
  },

  onLoad() {
    // 检测是否使用云托管
    if (wx.cloud) {
      try {
        wx.cloud.init()
        this._state.useCloudContainer = true
        console.log('Cloud container mode')
      } catch (e) {
        console.log('Cloud not available, using direct HTTP')
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

    // 先检查是否已有权限
    wx.getSetting({
      success(res) {
        if (res.authSetting['scope.camera'] === false) {
          // 用户曾拒绝过，引导去设置
          wx.showModal({
            title: '需要摄像头权限',
            content: '请在设置中允许摄像头访问',
            confirmText: '去设置',
            success(modalRes) {
              if (modalRes.confirm) wx.openSetting()
            }
          })
          return
        }

        // 未授权过或已授权，直接启动摄像头
        that._openCamera()
      },
      fail() {
        // getSetting 失败，尝试直接授权
        wx.authorize({
          scope: 'scope.camera',
          success() { that._openCamera() },
          fail() {
            wx.showModal({
              title: '需要摄像头权限',
              content: '请在设置中允许摄像头访问',
              confirmText: '去设置',
              success(modalRes) {
                if (modalRes.confirm) wx.openSetting()
              }
            })
          }
        })
      }
    })
  },

  _openCamera() {
    const that = this
    that.setData({ cameraReady: true })
    setTimeout(() => {
      that.setupFrameListener()
      that.setupCanvas()
      that.startSession()

      // HTTP 模式启动轮询
      if (app.globalData.mode === 'http') {
        if (that.data.activeMode === 'motion') {
          that.startPolling()
        } else {
          that.startPosturePolling()
        }
      }
    }, 800)
  },

  onCameraError(e) {
    console.error('Camera error:', e.detail)
    wx.showToast({ title: '摄像头启动失败', icon: 'none' })
    this.setData({ cameraReady: false })
  },

  onCameraStop() {
    console.log('Camera stopped')
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
        if (!res[0]) return
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        const dpr = wx.getWindowInfo().pixelRatio
        canvas.width = res[0].width * dpr
        canvas.height = res[0].height * dpr
        ctx.scale(dpr, dpr)
        this._state.canvas = canvas
        this._state.ctx = ctx
      })
  },

  // =================== Frame Listener ===================
  setupFrameListener() {
    const camera = wx.createCameraContext()
    let frameCounter = 0
    const targetInterval = Math.round(app.globalData.pollInterval / 33)

    const listener = camera.onCameraFrame((frame) => {
      frameCounter++
      if (frameCounter % targetInterval === 0) {
        this._state.frameQueue.push(frame)
        if (this._state.frameQueue.length > 1) {
          this._state.frameQueue.shift()
        }
      }

      // WS 模式直接发送
      if (app.globalData.mode === 'ws' && !this._state.processing) {
        this._state.processing = true
        this.sendFrameWS(frame)
      }
    })
    listener.start()
    this._state.listener = listener
  },

  // =================== HTTP Polling (motion mode) ===================
  startPolling() {
    const interval = app.globalData.pollInterval
    this._state.pollTimer = setInterval(() => {
      if (this._state.frameQueue.length === 0) return

      const frame = this._state.frameQueue.shift()
      this.sendFrameHTTP(frame)
    }, interval)
  },

  async sendFrameHTTP(frame) {
    try {
      const arrayBuffer = frame.data
      const base64 = wx.arrayBufferToBase64(arrayBuffer)

      const payload = {
        data: base64,
        width: frame.width,
        height: frame.height,
        format: 'rgba'
      }

      let result

      if (this._state.useCloudContainer) {
        result = await new Promise((resolve, reject) => {
          wx.cloud.callContainer({
            config: { env: wx.cloud.DYNAMIC_CURRENT_ENV },
            path: '/api/pose',
            method: 'POST',
            data: payload,
            header: { 'X-WX-SERVICE': 'motion-monitor1' },
            success(res) { resolve(res.data) },
            fail(err) { reject(err) }
          })
        })
      } else {
        const res = await new Promise((resolve, reject) => {
          wx.request({
            url: app.globalData.apiBase + '/api/pose',
            method: 'POST',
            data: payload,
            header: { 'content-type': 'application/json' },
            success(res) { resolve(res.data) },
            fail(err) { reject(err) }
          })
        })
        result = res
      }

      if (result && result.landmarks) {
        this.onPoseResult(result)
      }
    } catch (e) {
      console.warn('HTTP pose request error:', e.message || e)
    }
  },

  // =================== Posture Polling (posture mode) ===================
  startPosturePolling() {
    // 体态评估不需要高频，1.5秒一次即可
    this._state.postureTimer = setInterval(() => {
      if (this._state.frameQueue.length === 0) return
      const frame = this._state.frameQueue.shift()
      this.sendFramePosture(frame)
    }, 1500)
  },

  async sendFramePosture(frame) {
    try {
      const arrayBuffer = frame.data
      const base64 = wx.arrayBufferToBase64(arrayBuffer)

      const payload = {
        data: base64,
        width: frame.width,
        height: frame.height,
        format: 'rgba'
      }

      let result

      if (this._state.useCloudContainer) {
        result = await new Promise((resolve, reject) => {
          wx.cloud.callContainer({
            config: { env: wx.cloud.DYNAMIC_CURRENT_ENV },
            path: '/api/posture',
            method: 'POST',
            data: payload,
            header: { 'X-WX-SERVICE': 'motion-monitor1' },
            success(res) { resolve(res.data) },
            fail(err) { reject(err) }
          })
        })
      } else {
        const res = await new Promise((resolve, reject) => {
          wx.request({
            url: app.globalData.apiBase + '/api/posture',
            method: 'POST',
            data: payload,
            header: { 'content-type': 'application/json' },
            success(res) { resolve(res.data) },
            fail(err) { reject(err) }
          })
        })
        result = res
      }

      if (result && result.landmarks) {
        this.onPoseResult(result)
      }
      if (result && result.posture && !result.posture.error) {
        this.onPostureResult(result.posture)
      }
    } catch (e) {
      console.warn('Posture request error:', e.message || e)
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

  sendFrameWS(frame) {
    const socketTask = this._state.socketTask
    if (!socketTask || socketTask.readyState !== 1) {
      this._state.processing = false
      return
    }

    const arrayBuffer = frame.data
    const base64 = wx.arrayBufferToBase64(arrayBuffer)

    const payload = {
      type: 'frame',
      data: base64,
      width: frame.width,
      height: frame.height,
      format: 'rgba'
    }

    try {
      socketTask.send({
        data: JSON.stringify(payload),
        fail() { console.warn('WS send failed') }
      })
    } catch (e) {
      console.warn('Send error:', e)
    }

    this._state.processing = false
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

    // Draw skeleton
    this.drawSkeleton(lm)

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

  // =================== Drawing ===================
  drawSkeleton(lm) {
    const ctx = this._state.ctx
    if (!ctx) return

    const canvas = this._state.canvas
    const w = canvas.width / wx.getWindowInfo().pixelRatio
    const h = canvas.height / wx.getWindowInfo().pixelRatio

    ctx.clearRect(0, 0, w, h)

    const mirrorLm = lm.map(p => ({
      x: 1 - p.x,
      y: p.y,
      visibility: p.visibility
    }))

    const connections = [
      [11,12], [11,13], [13,15], [12,14], [14,16],
      [11,23], [12,24], [23,24],
      [23,25], [25,27], [24,26], [26,28],
      [15,17], [15,19], [16,18], [16,20],
      [27,29], [27,31], [28,30], [28,32],
    ]

    ctx.lineWidth = 2
    connections.forEach(([i, j]) => {
      const a = mirrorLm[i], b = mirrorLm[j]
      if (a.visibility < 0.5 || b.visibility < 0.5) return
      ctx.strokeStyle = 'rgba(6,214,160,0.8)'
      ctx.beginPath()
      ctx.moveTo(a.x * w, a.y * h)
      ctx.lineTo(b.x * w, b.y * h)
      ctx.stroke()
    })

    mirrorLm.forEach((p, i) => {
      if (p.visibility < 0.5) return
      const x = p.x * w, y = p.y * h
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fillStyle = [11,12,13,14,15,16,23,24,25,26,27,28].includes(i) ? '#06d6a0' : '#118ab2'
      ctx.fill()
    })

    const anglePairs = [[11,13,15],[12,14,16],[23,25,27],[24,26,28]]
    ctx.font = '11px sans-serif'
    ctx.fillStyle = 'rgba(6,214,160,0.9)'
    ctx.textAlign = 'center'
    anglePairs.forEach(([a, b, c]) => {
      const pa = mirrorLm[a], pb = mirrorLm[b], pc = mirrorLm[c]
      if (pa.visibility < 0.5 || pb.visibility < 0.5 || pc.visibility < 0.5) return
      const angle = this.calcAngle(pa, pb, pc)
      ctx.fillText(Math.round(angle) + '°', pb.x * w, pb.y * h - 12)
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
