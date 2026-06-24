/**
 * @fileoverview 后端工具模組聚合导出
 * @description 统一导出页面交互、錯誤归一化、資源下載等工具函式
 *
 * 主要功能：
 * - 页面交互 (page.js):
 *   - waitForPageAuth/lockPageAuth/unlockPageAuth: 页面认证锁机制
 *   - waitForInput: 等待輸入框出现（自动等待认证完成）
 *   - gotoWithCheck: 导航到 URL 并偵測 HTTP 錯誤
 *   - waitApiResponse: 等待 API 回應（带页面關閉监听）
 *
 * - 錯誤处理 (error.js):
 *   - isRetryableError: 判断錯誤是否可重試
 *   - normalizePageError: 归一化页面级錯誤
 *   - normalizeHttpError: 归一化 HTTP 回應錯誤
 *   - normalizeError: 通用錯誤归一化
 *
 * - 資源下載 (download.js):
 *   - useContextDownload: 使用页面上下文下載圖片并转换为 Base64
 */

// 页面交互
export {
  waitForPageAuth,
  lockPageAuth,
  unlockPageAuth,
  isPageAuthLocked,
  waitForInput,
  gotoWithCheck,
  tryGotoWithCheck,
  waitApiResponse,
  scrollToElement,
} from "./page.js";

// 錯誤归一化
export {
  isRetryableError,
  normalizePageError,
  normalizeHttpError,
  normalizeError,
} from "./error.js";

// 資源下載
export { useContextDownload } from "./download.js";
