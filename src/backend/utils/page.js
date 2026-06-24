/**
 * @fileoverview 页面交互工具
 * @description 页面认证锁、輸入框等待、表单提交等页面级操作
 */

import {
  sleep,
  safeClick,
  isPageValid,
  createPageCloseWatcher,
  getRealViewport,
  clamp,
  random,
} from "../engine/utils.js";
import { TIMEOUTS } from "../../utils/constants.js";

// ==========================================
// 页面认证锁
// ==========================================

/**
 * 等待页面认证完成
 * @param {import('playwright-core').Page} page - 页面物件
 */
export async function waitForPageAuth(page) {
  while (page.authState?.isHandlingAuth) {
    await sleep(500, 1000);
  }
}

/**
 * 設定頁面認證鎖（加锁）
 * @param {import('playwright-core').Page} page - 页面物件
 */
export function lockPageAuth(page) {
  if (page.authState) page.authState.isHandlingAuth = true;
}

/**
 * 释放页面认证锁（解锁）
 * @param {import('playwright-core').Page} page - 页面物件
 */
export function unlockPageAuth(page) {
  if (page.authState) page.authState.isHandlingAuth = false;
}

/**
 * 检查页面是否正在处理认证
 * @param {import('playwright-core').Page} page - 页面物件
 * @returns {boolean}
 */
export function isPageAuthLocked(page) {
  return page.authState?.isHandlingAuth === true;
}

// ==========================================
// 輸入框与表单
// ==========================================

/**
 * 等待輸入框出现（自动等待认证完成）
 * @param {import('playwright-core').Page} page - 页面物件
 * @param {string|import('playwright-core').Locator} selectorOrLocator - 輸入框选择器或 Locator 物件
 * @param {object} [options={}] - 选项
 * @param {number} [options.timeout=60000] - 逾時时间（毫秒）
 * @param {boolean} [options.click=true] - 找到后是否點擊輸入框
 * @returns {Promise<void>}
 */
export async function waitForInput(page, selectorOrLocator, options = {}) {
  const { timeout = TIMEOUTS.INPUT_WAIT, click = true } = options;

  const isLocator = typeof selectorOrLocator !== "string";
  const displayName = isLocator ? "Locator" : selectorOrLocator;
  const startTime = Date.now();

  // 等待认证完成
  while (isPageAuthLocked(page)) {
    if (Date.now() - startTime >= timeout) break;
    await sleep(500, 1000);
  }

  // 计算剩余逾時时间
  const elapsed = Date.now() - startTime;
  const remainingTimeout = Math.max(timeout - elapsed, 5000);

  // 等待輸入框出现
  if (isLocator) {
    await selectorOrLocator
      .first()
      .waitFor({ state: "visible", timeout: remainingTimeout })
      .catch(() => {
        throw new Error(`未找到輸入框 (${displayName})`);
      });
  } else {
    await page
      .waitForSelector(selectorOrLocator, { timeout: remainingTimeout })
      .catch(() => {
        throw new Error(`未找到輸入框 (${displayName})`);
      });
  }

  if (click) {
    await safeClick(page, selectorOrLocator, { bias: "input" });
    await sleep(500, 1000);
  }
}

// ==========================================
// 导航与滑鼠
// ==========================================

/**
 * 导航到指定 URL 并偵測 HTTP 錯誤
 * @param {import('playwright-core').Page} page - 页面物件
 * @param {string} url - 目标 URL
 * @param {object} [options={}] - 选项
 * @param {number} [options.timeout=30000] - 逾時时间（毫秒）
 * @throws {Error} 导航失败时抛出錯誤
 */
export async function gotoWithCheck(page, url, options = {}) {
  const { timeout = TIMEOUTS.NAVIGATION } = options;
  try {
    const response = await page.goto(url, {
      waitUntil: "load",
      timeout,
    });
    if (!response) {
      throw new Error("页面載入失败: 无回應");
    }
    const status = response.status();
    if (status >= 400) {
      throw new Error(`网站无法访问 (HTTP ${status})`);
    }
  } catch (e) {
    if (e.message.includes("Timeout")) {
      throw new Error("页面載入逾時");
    }
    // 如果是我们自己抛出的錯誤，直接 re-throw
    if (e.message.startsWith("页面") || e.message.startsWith("网站")) {
      throw e;
    }
    throw new Error(`页面載入失败: ${e.message}`);
  }
}

/**
 * 尝试导航到 URL（不抛异常版本，用于需要收集錯誤的场景）
 * @param {import('playwright-core').Page} page - 页面物件
 * @param {string} url - 目标 URL
 * @param {object} [options={}] - 选项
 * @returns {Promise<{success?: boolean, error?: string}>}
 */
export async function tryGotoWithCheck(page, url, options = {}) {
  try {
    await gotoWithCheck(page, url, options);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 等待元素出现并滾動到可视範圍
 * @param {import('playwright-core').Page} page - Playwright 页面物件
 * @param {string|import('playwright-core').Locator} selectorOrLocator - CSS 选择器或 Locator 物件
 * @param {object} [options={}] - 选项
 * @param {number} [options.timeout=30000] - 逾時时间（毫秒）
 * @returns {Promise<import('playwright-core').ElementHandle|null>} 元素句柄，失败回傳 null
 */
export async function scrollToElement(page, selectorOrLocator, options = {}) {
  const { timeout = TIMEOUTS.ELEMENT_SCROLL } = options;
  try {
    const isLocator = typeof selectorOrLocator !== "string";
    let element;

    if (isLocator) {
      // Locator 物件 (getByRole, getByText 等)
      await selectorOrLocator.first().waitFor({ timeout, state: "attached" });
      element = await selectorOrLocator.first().elementHandle();
    } else {
      // CSS 选择器字串
      element = await page.waitForSelector(selectorOrLocator, {
        timeout,
        state: "attached",
      });
    }

    if (element) {
      await element.scrollIntoViewIfNeeded();
      return element;
    }
  } catch {
    // 元素未找到或逾時
  }
  return null;
}

/**
 * 等待 API 回應 (带页面關閉监听和錯誤关键词偵測)
 * 匹配到回應后会等待请求完成（requestfinished），使用 60 秒空闲逾時保护
 * @param {import('playwright-core').Page} page - Playwright 页面物件
 * @param {object} options - 等待选项
 * @param {string} options.urlMatch - URL 匹配字串
 * @param {string|string[]} [options.urlContains] - URL 必須额外包含的字串（可选，可以是陣列）
 * @param {string} [options.method='POST'] - HTTP 方法
 * @param {number} [options.timeout=120000] - 等待回應出现的逾時时间（毫秒）
 * @param {string|string[]} [options.errorText] - 錯誤关键词，页面 UI 或 API 回應体中出现时立即停止并回傳錯誤
 * @param {object} [options.meta={}] - 日誌元数据
 * @returns {Promise<import('playwright-core').Response>} 回應物件
 */
export function waitApiResponse(page, options = {}) {
  const promise = (async () => {
    const {
      urlMatch,
      urlContains,
      method = "POST",
      timeout = TIMEOUTS.API_RESPONSE,
      errorText,
      meta = {},
    } = options;

    if (!isPageValid(page)) {
      throw new Error("PAGE_INVALID");
    }

    const pageWatcher = createPageCloseWatcher(page);
    const patterns = errorText
      ? Array.isArray(errorText)
        ? errorText
        : [errorText]
      : [];

    // 页面 UI 錯誤关键词偵測
    let uiErrorPromise = null;
    if (patterns.length > 0) {
      let combinedLocator = null;
      for (const pattern of patterns) {
        const loc = page.getByText(pattern);
        combinedLocator = combinedLocator ? combinedLocator.or(loc) : loc;
      }
      if (combinedLocator) {
        uiErrorPromise = combinedLocator
          .first()
          .waitFor({ timeout, state: "attached" })
          .then(async () => {
            const matchedText = await combinedLocator
              .first()
              .textContent()
              .catch(() => "未知錯誤");
            throw new Error(`PAGE_ERROR_DETECTED: ${matchedText}`);
          });
      }
    }

    // 逾時控制
    let timerId = null;
    let responseHandler = null;

    const cleanup = () => {
      if (timerId) clearTimeout(timerId);
      if (responseHandler) page.off("response", responseHandler);
      pageWatcher.cleanup();
    };

    try {
      const responsePromise = new Promise((resolve, reject) => {
        // 逾時计时器（流式回應收到数据时会重置）
        const resetTimer = () => {
          if (timerId) clearTimeout(timerId);
          timerId = setTimeout(() => {
            reject(
              new Error(
                `API_TIMEOUT: 等待回應逾時 (${Math.round(timeout / 1000)}秒)`,
              ),
            );
          }, timeout);
        };

        // 啟動初始逾時
        resetTimer();

        // 监听回應
        responseHandler = async (res) => {
          const url = res.url();

          // 基础匹配
          if (!url.includes(urlMatch)) return;

          // 额外的 URL 包含检查
          if (urlContains) {
            const containsArray = Array.isArray(urlContains)
              ? urlContains
              : [urlContains];
            if (!containsArray.every((str) => url.includes(str))) return;
          }

          // 方法和状态检查
          const reqMethod = res.request().method();
          const status = res.status();
          if (reqMethod !== method || (status !== 200 && status < 400)) return;

          // 匹配成功，移除监听器（只处理第一个匹配的回應）
          page.off("response", responseHandler);
          responseHandler = null;

          // 统一等待请求完成（无论流式还是非流式）
          // 使用 timeout 作为空闲逾時，防止連接卡住无限等待
          let idleTimerId = null;

          // 取消初始逾時，啟動空闲逾時
          if (timerId) {
            clearTimeout(timerId);
            timerId = null;
          }

          idleTimerId = setTimeout(() => {
            page.off("requestfinished", finishedHandler);
            page.off("requestfailed", failedHandler);
            reject(
              new Error(
                `API_TIMEOUT: 回應传输逾時 (${Math.round(timeout / 1000)}秒未完成)`,
              ),
            );
          }, timeout);

          const request = res.request();

          const finishedHandler = (req) => {
            if (req === request) {
              if (idleTimerId) clearTimeout(idleTimerId);
              page.off("requestfinished", finishedHandler);
              page.off("requestfailed", failedHandler);
              resolve(res);
            }
          };

          const failedHandler = (req) => {
            if (req === request) {
              if (idleTimerId) clearTimeout(idleTimerId);
              page.off("requestfinished", finishedHandler);
              page.off("requestfailed", failedHandler);
              reject(new Error("NETWORK_FAILED: 请求失败"));
            }
          };

          page.on("requestfinished", finishedHandler);
          page.on("requestfailed", failedHandler);
        };

        page.on("response", responseHandler);
      });

      const promises = [responsePromise, pageWatcher.promise];
      if (uiErrorPromise) promises.push(uiErrorPromise);

      const response = await Promise.race(promises);

      // API 回應体錯誤关键词偵測 (在回傳前同步检查)
      if (patterns.length > 0) {
        try {
          const bodyBuffer = await response.body();
          const body = bodyBuffer.toString("utf-8");
          for (const pattern of patterns) {
            const keyword =
              typeof pattern === "string" ? pattern : pattern.source;
            if (body.includes(keyword)) {
              throw new Error(`API_ERROR_DETECTED: ${keyword}`);
            }
          }
          // 回傳代理物件，快取 body 以支援调用方重复讀取
          const cachedResponse = Object.create(response);
          cachedResponse.text = async () => body;
          cachedResponse.json = async () => JSON.parse(body);
          cachedResponse.body = async () => bodyBuffer;
          return cachedResponse;
        } catch (e) {
          if (e.message.startsWith("API_ERROR_DETECTED")) throw e;
        }
      }

      return response;
    } catch (e) {
      // 偵測逾時錯誤，转换为标准錯誤類型
      if (e.name === "TimeoutError" || e.message?.includes("TIMEOUT")) {
        throw new Error(`API_TIMEOUT: ${e.message}`);
      }
      throw e;
    } finally {
      cleanup();
    }
  })();

  // 关键修复：挂载一个空的 catch 处理器
  // 因为配接器通常是先调用 waitApiResponse 拿到 Promise，然后執行 safeClick，最后再 await
  // 如果在 safeClick 期间页面關閉/崩溃，此 Promise 会被 reject，触发 Node.js 未捕获异常崩溃
  promise.catch(() => {});

  return promise;
}
