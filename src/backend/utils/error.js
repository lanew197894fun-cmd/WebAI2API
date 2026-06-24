/**
 * @fileoverview 錯誤归一化模組
 * @description 统一处理页面级和 HTTP 级錯誤，提供可重試判定
 */

import { logger } from "../../utils/logger.js";
import { ADAPTER_ERRORS } from "../../server/errors.js";

// ==========================================
// 可重試判定
// ==========================================

/**
 * 判断錯誤是否可重試
 * @param {string} errorMessage - 錯誤消息
 * @returns {boolean}
 */
export function isRetryableError(errorMessage) {
  if (!errorMessage) return false;

  const retryablePatterns = [
    // 網路錯誤
    /network|net::|econnreset|econnrefused|etimedout/i,
    // 逾時（含中文）
    /timeout|timed out|載入逾時|请求逾時/i,
    // 页面崩溃
    /crashed|crash/i,
    // 5xx 服务端錯誤
    /5\d{2}|internal server error|bad gateway|service unavailable/i,
    // 限流（可能是临时的）
    /rate limit|too many requests|429/i,
  ];

  return retryablePatterns.some((pattern) => pattern.test(errorMessage));
}

// ==========================================
// 页面錯誤归一化
// ==========================================

/**
 * 统一处理页面级錯誤
 * @param {Error} err - 原始錯誤
 * @param {object} [meta={}] - 日誌元数据
 * @returns {{ error: string, code: string, retryable: boolean } | null}
 */
export function normalizePageError(err, meta = {}) {
  if (err.message === "PAGE_CLOSED") {
    logger.error("配接器", "页面已關閉", meta);
    return {
      error: "页面已關閉，请勿在生图过程中刷新页面",
      code: ADAPTER_ERRORS.PAGE_CLOSED,
      retryable: true,
    };
  }
  if (err.message === "PAGE_CRASHED") {
    logger.error("配接器", "页面崩溃", meta);
    return {
      error: "页面崩溃，請重試",
      code: ADAPTER_ERRORS.PAGE_CRASHED,
      retryable: true,
    };
  }
  if (err.message === "PAGE_INVALID") {
    logger.error("配接器", "页面状态无效", meta);
    return {
      error: "页面状态无效，请重新初始化",
      code: ADAPTER_ERRORS.PAGE_INVALID,
      retryable: true,
    };
  }
  // API_TIMEOUT: waitApiResponse 内部转换后的逾時錯誤
  if (err.message?.startsWith("API_TIMEOUT:")) {
    const timeoutMsg = err.message.replace("API_TIMEOUT: ", "");
    logger.error("配接器", timeoutMsg, meta);
    return {
      error: timeoutMsg,
      code: ADAPTER_ERRORS.TIMEOUT_ERROR,
      retryable: true,
    };
  }
  // 页面載入逾時 (gotoWithCheck 抛出的中文逾時錯誤)
  if (
    err.message?.includes("页面載入逾時") ||
    err.message?.includes("页面載入失败")
  ) {
    logger.error("配接器", err.message, meta);
    return {
      error: err.message,
      code: ADAPTER_ERRORS.TIMEOUT_ERROR,
      retryable: true,
    };
  }
  // CLICK_TIMEOUT: safeClick 内部逾時
  if (err.message?.includes("CLICK_TIMEOUT")) {
    logger.error("配接器", `點擊操作逾時: ${err.message}`, meta);
    return {
      error: err.message,
      code: ADAPTER_ERRORS.TIMEOUT_ERROR,
      retryable: true,
    };
  }
  // 兼容原生 TimeoutError (Playwright 元素操作逾時等)
  if (err.name === "TimeoutError" || err.message?.includes("Timeout")) {
    logger.error("配接器", `页面操作逾時: ${err.message}`, meta);
    return {
      error: "页面操作逾時, 页面可能未正常載入或元素未找到",
      code: ADAPTER_ERRORS.TIMEOUT_ERROR,
      retryable: true,
    };
  }
  // PAGE_ERROR_DETECTED: waitApiResponse 页面 UI 中偵測到的錯誤关键词
  if (err.message?.startsWith("PAGE_ERROR_DETECTED:")) {
    const keyword = err.message.replace("PAGE_ERROR_DETECTED: ", "");
    logger.error("配接器", `页面偵測到錯誤: ${keyword}`, meta);
    return {
      error: `内容被阻止: ${keyword}`,
      code: ADAPTER_ERRORS.CONTENT_BLOCKED,
      retryable: false,
    };
  }
  // API_ERROR_DETECTED: waitApiResponse API 回應体中偵測到的錯誤关键词
  if (err.message?.startsWith("API_ERROR_DETECTED:")) {
    const keyword = err.message.replace("API_ERROR_DETECTED: ", "");
    logger.error("配接器", `API 回應偵測到錯誤: ${keyword}`, meta);
    return {
      error: `内容被阻止: ${keyword}`,
      code: ADAPTER_ERRORS.CONTENT_BLOCKED,
      retryable: false,
    };
  }
  return null;
}

// ==========================================
// HTTP 錯誤归一化
// ==========================================

/**
 * 统一处理 HTTP 回應錯誤
 * @param {import('playwright-core').Response} response - HTTP 回應物件
 * @param {string} [content=null] - 回應体内容（可选）
 * @returns {{ error: string, code: string, retryable: boolean } | null}
 */
export function normalizeHttpError(response, content = null) {
  const status = response.status();

  // 尝试从回應体中提取具体錯誤資訊
  let detailError = null;
  if (content) {
    try {
      const json = JSON.parse(content);
      // 格式: {"error": "Request rejected: ..."}
      if (json.error && typeof json.error === "string") {
        detailError = json.error;
      }
      // 格式: {"error": {"message": "..."}}
      else if (json.error?.message) {
        detailError = json.error.message;
      }
    } catch {
      // 非 JSON 格式，尝试直接使用内容
      if (content.length < 200) {
        detailError = content;
      }
    }
  }

  // 检查是否是内容审核拒绝 (通常回傳 422 或 429 但含有拒绝資訊)
  const isContentRejection =
    detailError &&
    (/reject|violat|terms|blocked|forbidden|unsafe|moderat/i.test(
      detailError,
    ) ||
      detailError === "prompt failed");
  if (isContentRejection) {
    return {
      error: `内容被拒绝: ${detailError}`,
      code: ADAPTER_ERRORS.CONTENT_BLOCKED,
      retryable: false,
    };
  }

  // 429 限流检查
  if (status === 429 || content?.includes("Too Many Requests")) {
    return {
      error: "触发限流/上游繁忙",
      code: ADAPTER_ERRORS.RATE_LIMITED,
      retryable: true,
    };
  }

  // reCAPTCHA 验证失败
  if (content?.includes("recaptcha validation failed")) {
    return {
      error: "触发人机验证",
      code: ADAPTER_ERRORS.CAPTCHA_REQUIRED,
      retryable: false,
    };
  }

  // 5xx 服务端錯誤（可重試）
  if (status >= 500) {
    const msg = detailError
      ? `上游服务器錯誤 (${status}): ${detailError}`
      : `上游服务器錯誤，HTTP錯誤码: ${status}`;
    return { error: msg, code: ADAPTER_ERRORS.HTTP_ERROR, retryable: true };
  }

  // 4xx 客户端錯誤（不可重試）
  if (status >= 400) {
    const msg = detailError
      ? `请求被拒绝 (${status}): ${detailError}`
      : `请求錯誤，HTTP錯誤码: ${status}`;
    return { error: msg, code: ADAPTER_ERRORS.HTTP_ERROR, retryable: false };
  }

  return null;
}

// ==========================================
// 通用錯誤归一化
// ==========================================

/**
 * 标准化錯誤物件（通用）
 * @param {string} error - 錯誤消息
 * @returns {{error: string, code: string, retryable: boolean}}
 */
export function normalizeError(error) {
  const retryable = isRetryableError(error);

  let code = ADAPTER_ERRORS.NETWORK_ERROR;
  if (/timeout/i.test(error)) {
    code = ADAPTER_ERRORS.TIMEOUT_ERROR;
  } else if (/crashed/i.test(error)) {
    code = ADAPTER_ERRORS.PAGE_CRASHED;
  } else if (/closed/i.test(error)) {
    code = ADAPTER_ERRORS.PAGE_CLOSED;
  } else if (/5\d{2}|internal server/i.test(error)) {
    code = ADAPTER_ERRORS.HTTP_ERROR;
  } else if (/rate limit|429/i.test(error)) {
    code = ADAPTER_ERRORS.RATE_LIMITED;
  } else if (/captcha|recaptcha/i.test(error)) {
    code = ADAPTER_ERRORS.CAPTCHA_REQUIRED;
  }

  return { error, code, retryable };
}
