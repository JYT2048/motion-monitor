// pages/privacy/privacy.js
Page({
  data: {},
  agreePrivacy() {
    // 记录同意状态
    wx.setStorageSync('privacyAgreed', true)
    wx.navigateBack()
  }
})
