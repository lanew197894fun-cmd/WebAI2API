/**
 * @fileoverview 資源下載模組
 * @description 圖片下載与 Base64 转换
 */

import { logger } from "../../utils/logger.js";

/**
 * 判断錯誤是否可重試
 * @param {string} message - 錯誤消息
 * @returns {boolean}
 */
function isRetryableError(message) {
  return /timeout|network|econnreset|econnrefused|etimedout|disconnected|tls|socket/i.test(
    message,
  );
}

/**
 * 使用页面上下文下載圖片并转换为 Base64
 * 自动继承页面的 Cookie 和 Session，解决鉴权问题
 * @param {string} url - 圖片 URL
 * @param {import('playwright-core').Page} page - Playwright 页面物件
 * @param {object} [options] - 可选配置
 * @param {number} [options.timeout=60000] - 逾時时间（毫秒）
 * @param {number} [options.retries=3] - 最大重試次数
 * @param {number} [options.retryDelay=1000] - 重試延迟基数（毫秒）
 * @returns {Promise<{ image?: string, imageUrl?: string, error?: string }>} 下載结果（包含原始 URL）
 */
export async function useContextDownload(url, page, options = {}) {
  const { timeout = 120000, retries = 3, retryDelay = 1000 } = options;
  // 至少執行一次尝试（retries=0 表示不重試，但仍需下載一次）
  const maxAttempts = Math.max(1, retries);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await page.request.get(url, { timeout });

      if (!response.ok()) {
        const status = response.status();
        // 5xx 錯誤可重試
        if (status >= 500 && attempt < maxAttempts) {
          logger.warn(
            "下載",
            `HTTP ${status}，重試 ${attempt}/${maxAttempts}...`,
          );
          await new Promise((r) => setTimeout(r, retryDelay * attempt));
          continue;
        }
        return { error: `下載失败: HTTP ${status}`, imageUrl: url };
      }

      const buffer = await response.body();
      const base64 = buffer.toString("base64");
      const contentType = response.headers()["content-type"] || "image/png";
      const mimeType = contentType.split(";")[0].trim();

      return { image: `data:${mimeType};base64,${base64}`, imageUrl: url };
    } catch (e) {
      if (isRetryableError(e.message) && attempt < maxAttempts) {
        logger.warn("下載", `${e.message}，重試 ${attempt}/${maxAttempts}...`);
        await new Promise((r) => setTimeout(r, retryDelay * attempt));
        continue;
      }
      return {
        error: `已取得结果，但圖片下載时遇到錯誤: ${e.message}`,
        imageUrl: url,
      };
    }
  }

  return { error: "下載失败: 已达最大重試次数", imageUrl: url };
}
