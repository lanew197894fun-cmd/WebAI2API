/**
 * @fileoverview 全局常量管理
 * @description 集中管理逾時时间、选择器等常量，便于统一配置和维护
 */

// ==========================================
// 逾時时间常量 (毫秒)
// ==========================================

/**
 * 逾時时间配置
 * @readonly
 */
export const TIMEOUTS = {
  /** 元素點擊逾時 (safeClick) */
  ELEMENT_CLICK: 25000,

  /** 輸入框等待逾時 (waitForInput) */
  INPUT_WAIT: 20000,

  /** 导航逾時（页面跳转 gotoWithCheck） */
  NAVIGATION: 20000,

  /** 元素滾動等待逾時 (scrollToElement) */
  ELEMENT_SCROLL: 30000,

  /** 导航逾時（扩展，带重試场景） */
  NAVIGATION_EXTENDED: 60000,

  /** 上傳确认逾時 */
  UPLOAD_CONFIRM: 60000,

  /** OAuth 登录流程逾時 */
  OAUTH_FLOW: 60000,

  /** API 回應逾時（圖片生成 waitApiResponse） */
  API_RESPONSE: 120000,

  /** 心跳間隔 */
  HEARTBEAT_INTERVAL: 3000,

  /** 轮询間隔（waitForInput 等） */
  POLL_INTERVAL: 500,
};

// ==========================================
// 重試配置
// ==========================================

/**
 * 重試配置
 * @readonly
 */
export const RETRY = {
  /** 配接器預設最大重試次数 */
  MAX_ATTEMPTS: 2,

  /** 重試間隔基数（毫秒） */
  BASE_DELAY: 1000,

  /** 可重試的錯誤類型 */
  RETRYABLE_ERRORS: ["NETWORK_ERROR", "TIMEOUT_ERROR", "PAGE_CRASHED"],
};

// ==========================================
// 人機模擬配置
// ==========================================

/**
 * 人機模擬延迟配置（毫秒）
 * @readonly
 */
export const HUMAN_DELAYS = {
  /** 短延迟範圍 */
  SHORT: { min: 500, max: 1000 },

  /** 中延迟範圍 */
  MEDIUM: { min: 1000, max: 2000 },

  /** 长延迟範圍（页面載入后） */
  LONG: { min: 1500, max: 2500 },

  /** 打字間隔 */
  TYPING: { min: 30, max: 100 },
};
