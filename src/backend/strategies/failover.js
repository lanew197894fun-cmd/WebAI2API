/**
 * @fileoverview 故障转移模組
 * @description 提供故障转移重試逻辑。
 *
 * 核心功能：
 * - 故障转移執行器
 *
 * 注意：
 * - 錯誤分类在 utils/error.js 中
 * - 負載均衡策略在 strategy.js 中
 */

import { logger } from "../../utils/logger.js";
import { RETRY } from "../../utils/constants.js";
import { isRetryableError, normalizeError } from "../utils/error.js";

// 重新导出錯誤分类函式以保持兼容性
export { isRetryableError, normalizeError };

// ==========================================
// 故障转移執行器
// ==========================================

/**
 * 建立故障转移執行器
 * @param {object} options - 配置选项
 * @param {number} [options.maxRetries=2] - 最大重試次数
 * @param {Function} [options.onRetry] - 重試回调
 * @returns {object} 故障转移執行器
 */
export function createFailoverExecutor(options = {}) {
  const maxRetries = options.maxRetries ?? RETRY.MAX_ATTEMPTS;
  const onRetry = options.onRetry || (() => {});

  return {
    /**
     * 執行带故障转移的操作
     * @param {object[]} candidates - 候选列表
     * @param {Function} execute - 執行函式，接收候选项，回傳 {error?, ...result}
     * @param {object} [meta={}] - 日誌元数据
     * @returns {Promise<object>} 執行结果
     */
    async execute(candidates, execute, meta = {}) {
      if (candidates.length === 0) {
        return { error: "没有可用的候选" };
      }

      // 计算最大尝试次数
      const maxAttempts =
        maxRetries === 0
          ? candidates.length
          : Math.min(maxRetries + 1, candidates.length);

      let lastError = null;

      for (let i = 0; i < maxAttempts; i++) {
        const candidate = candidates[i];

        try {
          const result = await execute(candidate);

          // 成功回傳
          if (!result.error) {
            return result;
          }

          // 记录錯誤
          lastError = result.error;

          // 优先使用 result 中的 retryable，否则通过 normalizeError 推断
          const retryable =
            result.retryable !== undefined
              ? result.retryable
              : normalizeError(lastError).retryable;

          // 不可重試的錯誤（如内容安全问题），直接回傳，不尝试其他候选
          if (!retryable) {
            logger.debug(
              "故障转移",
              `不可重試錯誤，停止故障转移: ${lastError}`,
              meta,
            );
            return {
              error: lastError,
              code: "NOT_RETRYABLE",
              retryable: false,
            };
          }

          // 触发重試回调
          if (i < maxAttempts - 1) {
            onRetry(candidate, lastError, i + 1);
          }
        } catch (err) {
          lastError = err.message || String(err);
          if (i < maxAttempts - 1) {
            onRetry(candidate, lastError, i + 1);
          }
        }
      }

      // 所有候选都失败
      return {
        error: `所有候选都失败: ${lastError}`,
        code: "FAILOVER_EXHAUSTED",
        retryable: false,
      };
    },
  };
}

// ==========================================
// 便捷函式
// ==========================================

/**
 * 執行带故障转移的操作（简化版）
 * @param {object[]} candidates - 候选列表
 * @param {Function} execute - 執行函式
 * @param {object} [options={}] - 选项
 * @returns {Promise<object>}
 */
export async function executeWithFailover(candidates, execute, options = {}) {
  const executor = createFailoverExecutor(options);
  return executor.execute(candidates, execute, options.meta);
}
