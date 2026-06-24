/**
 * @fileoverview ChatGPT 圖片生成配接器
 */

import {
  sleep,
  humanType,
  safeClick,
  uploadFilesViaChooser,
} from "../engine/utils.js";
import {
  normalizePageError,
  waitForInput,
  gotoWithCheck,
  waitApiResponse,
  useContextDownload,
} from "../utils/index.js";
import { logger } from "../../utils/logger.js";

// --- 配置常量 ---
const TARGET_URL = "https://chatgpt.com/images/";
const INPUT_SELECTOR = ".ProseMirror";

/**
 * 執行生图任务
 * @param {object} context - 瀏覽器上下文 { page, config }
 * @param {string} prompt - 提示詞
 * @param {string[]} imgPaths - 圖片路徑陣列
 * @param {string} [modelId] - 模型 ID (此配接器未使用)
 * @param {object} [meta={}] - 日誌元数据
 * @returns {Promise<{image?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
  const { page, config } = context;
  const waitTimeout = config?.backend?.pool?.waitTimeout ?? 120000;
  const sendBtnLocator = page.getByRole("button", { name: "Send prompt" });

  try {
    logger.info("配接器", "开启新会话...", meta);
    await gotoWithCheck(page, TARGET_URL);

    // 1. 等待輸入框載入
    await waitForInput(page, INPUT_SELECTOR, { click: false });

    // 2. 上傳圖片
    if (imgPaths && imgPaths.length > 0) {
      const expectedUploads = imgPaths.length;
      let uploadedCount = 0;
      let processedCount = 0;
      logger.info("配接器", `开始上傳 ${expectedUploads} 张圖片...`, meta);
      logger.debug("配接器", "點擊添加檔案按钮...", meta);
      const addFilesBtn = page.getByRole("button", {
        name: "Add files and more",
      });

      await uploadFilesViaChooser(
        page,
        addFilesBtn,
        imgPaths,
        {
          uploadValidator: (response) => {
            const url = response.url();
            if (response.status() === 200) {
              // 上傳请求
              if (
                url.includes("backend-api/files") &&
                !url.includes("process_upload_stream")
              ) {
                uploadedCount++;
                logger.debug(
                  "配接器",
                  `圖片上傳进度: ${uploadedCount}/${expectedUploads}`,
                  meta,
                );
                return false;
              }
              // 处理完成请求
              if (url.includes("backend-api/files/process_upload_stream")) {
                processedCount++;
                logger.info(
                  "配接器",
                  `圖片处理进度: ${processedCount}/${expectedUploads}`,
                  meta,
                );

                if (processedCount >= expectedUploads) {
                  return true;
                }
              }
            }
            return false;
          },
        },
        meta,
      );
      logger.info("配接器", "圖片上傳完成", meta);
    }

    // 3. 輸入提示詞
    logger.info("配接器", "輸入提示詞...", meta);
    await safeClick(page, INPUT_SELECTOR, { bias: "input" });
    await humanType(page, INPUT_SELECTOR, prompt);

    // 4. 发送提示詞
    logger.debug("配接器", "发送提示詞...", meta);
    await page.keyboard.press("Enter");

    logger.info("配接器", "等待生成结果...", meta);

    // 5. 等待 conversation API 回傳
    let conversationResponse;
    try {
      conversationResponse = await waitApiResponse(page, {
        urlMatch: "backend-api/f/conversation",
        method: "POST",
        timeout: waitTimeout, // 圖片生成可能较慢
        meta,
      });
    } catch (e) {
      const pageError = normalizePageError(e, meta);
      if (pageError) return pageError;
      throw e;
    }

    // 检查回應状态
    if (conversationResponse.status() !== 200) {
      logger.error(
        "配接器",
        `API 回傳錯誤: HTTP ${conversationResponse.status()}`,
        meta,
      );
      return { error: `API 回傳錯誤: HTTP ${conversationResponse.status()}` };
    }

    // 5.5 解析 conversation 回應，检查是否是纯文本回复（拒绝/限流场景）
    let conversationText = "";
    let isImageGenerationStarted = false;
    let conversationBody = "";
    try {
      conversationBody = await conversationResponse.text();

      // 检查是否有圖片生成相關的内容 (dalle 工具调用或 file_ 檔案引用)
      // 注意：不使用 'image' 关键词，因为拒绝消息也会包含这个词
      isImageGenerationStarted =
        conversationBody.includes("dalle") ||
        conversationBody.includes("file_");
      logger.debug(
        "配接器",
        `isImageGenerationStarted: ${isImageGenerationStarted}`,
        meta,
      );

      // 提取文本内容
      const lines = conversationBody.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === "[DONE]") continue;
        try {
          const data = JSON.parse(dataStr);
          // 提取初始文本 (channel=final 的 assistant 消息)
          if (
            data.v?.message?.channel === "final" &&
            data.v?.message?.author?.role === "assistant" &&
            data.v?.message?.content?.parts?.length > 0
          ) {
            const part = data.v.message.content.parts[0];
            if (typeof part === "string") {
              conversationText = part;
            }
          }
          // patch 格式累加 (data.v 是 patch 操作陣列)
          if (Array.isArray(data.v)) {
            for (const patch of data.v) {
              if (
                patch.o === "append" &&
                patch.p === "/message/content/parts/0" &&
                patch.v
              ) {
                conversationText += patch.v;
              }
            }
          }
        } catch {}
      }
      logger.debug(
        "配接器",
        `提取到文本 (${conversationText.length} 字元): ${conversationText.substring(0, 200)}...`,
        meta,
      );
    } catch (e) {
      logger.warn("配接器", `解析 conversation 回應失败: ${e.message}`, meta);
    }

    // 早期偵測：如果文本表明是拒绝/限流，立即回傳，不等待圖片逾時
    if (conversationText) {
      // 检查是否是速率限制錯誤 (不重試，同帳號重試也没用)
      const isRateLimit =
        conversationBody.includes("RateLimitException") ||
        conversationBody.includes("rate limit") ||
        /limit.*reset/i.test(conversationText);

      if (isRateLimit) {
        logger.warn(
          "配接器",
          `早期偵測到速率限制: ${conversationText.substring(0, 200)}...`,
          meta,
        );
        return {
          error: `触发速率限制: ${conversationText.substring(0, 200)}`,
          retryable: false,
        };
      }

      // 如果没有圖片生成迹象，检查是否是内容被拒绝
      if (!isImageGenerationStarted) {
        const isContentRejection =
          /cannot|can't|unable|sorry|policy|violat/i.test(conversationText);
        if (isContentRejection) {
          logger.warn(
            "配接器",
            `早期偵測到内容拒绝: ${conversationText.substring(0, 200)}...`,
            meta,
          );
          return {
            error: `内容被拒绝: ${conversationText.substring(0, 200)}`,
            retryable: false,
          };
        }
      }
    }

    logger.info("配接器", "生成中，等待圖片就绪...", meta);

    // 6. 监听檔案状态介面，等待圖片生成完成
    // 如果 conversation 回應中没有圖片生成迹象，使用较短逾時
    let downloadUrl = null;
    let fileName = null;
    const imageTimeout = isImageGenerationStarted ? 120000 : 30000;

    try {
      await page.waitForResponse(
        async (response) => {
          const url = response.url();
          if (!url.includes("backend-api/files/download/file_")) return false;
          if (response.status() !== 200) return false;

          try {
            const json = await response.json();
            const fn = json.file_name;
            const dl = json.download_url;

            if (fn && fn.startsWith("user-") && !fn.includes(".part") && dl) {
              fileName = fn;
              downloadUrl = dl;
              logger.info("配接器", `圖片生成完成: ${fn}`, meta);
              return true;
            } else {
              logger.debug(
                "配接器",
                `圖片生成中或非生成圖片: ${fn || "无檔案名"}`,
                meta,
              );
              return false;
            }
          } catch {
            return false;
          }
        },
        { timeout: imageTimeout },
      );
    } catch (e) {
      logger.debug(
        "配接器",
        `等待圖片逾時, conversationText长度: ${conversationText.length}, downloadUrl: ${downloadUrl}`,
        meta,
      );

      // 逾時时检查是否有 conversation 中的文本内容
      if (conversationText && !downloadUrl) {
        const isRateLimit =
          conversationBody.includes("RateLimitException") ||
          conversationBody.includes("rate limit") ||
          /limit.*reset/i.test(conversationText);

        if (isRateLimit) {
          logger.warn(
            "配接器",
            `触发速率限制: ${conversationText.substring(0, 200)}...`,
            meta,
          );
          return {
            error: `触发速率限制: ${conversationText.substring(0, 200)}`,
            retryable: false,
          };
        }

        logger.warn(
          "配接器",
          `模型回傳文本而非圖片: ${conversationText.substring(0, 200)}...`,
          meta,
        );
        return {
          error: `模型回傳文本而非圖片: ${conversationText.substring(0, 200)}`,
          retryable: false,
        };
      }

      // 如果没有提取到文本，但有原始回應体，尝试用简单方式提取
      if (!conversationText && conversationBody) {
        const partsMatch = conversationBody.match(/"parts":\s*\["([^"]+)"\]/);
        if (partsMatch && partsMatch[1]) {
          logger.warn(
            "配接器",
            `通过正则提取到文本: ${partsMatch[1].substring(0, 200)}...`,
            meta,
          );
          return {
            error: `模型回傳文本而非圖片: ${partsMatch[1].substring(0, 200)}`,
            retryable: false,
          };
        }
      }

      const pageError = normalizePageError(e, meta);
      if (pageError) return pageError;
      throw e;
    }

    if (!downloadUrl) {
      logger.error("配接器", "未取得到圖片下載链接", meta);
      return { error: "未取得到圖片下載链接" };
    }

    logger.info("配接器", "正在下載圖片...", meta);

    // 7. 使用 useContextDownload 下載圖片
    const imgDlCfg = config?.backend?.pool?.failover || {};
    const result = await useContextDownload(downloadUrl, page, {
      retries: imgDlCfg.imgDlRetry ? imgDlCfg.imgDlRetryMaxRetries || 2 : 0,
    });
    if (result.error) {
      logger.error("配接器", result.error, meta);
      return result;
    }

    logger.info("配接器", "已取得圖片，任务完成", meta);
    return result;
  } catch (err) {
    // 顶层錯誤处理
    const pageError = normalizePageError(err, meta);
    if (pageError) return pageError;

    logger.error("配接器", "生成任务失败", { ...meta, error: err.message });
    return { error: `生成任务失败: ${err.message}` };
  } finally {
  }
}

/**
 * 配接器 manifest
 */
export const manifest = {
  id: "chatgpt",
  displayName: "ChatGPT (圖片生成)",
  description:
    "使用 ChatGPT 官网生成圖片，支援参考圖片上傳。需要已登录的 ChatGPT 账户，请使用会员帳號 (包含 K12 教师认证)，非会员帳號会有速率限制。",

  // 入口 URL
  getTargetUrl(config, workerConfig) {
    return TARGET_URL;
  },

  // 模型列表
  models: [{ id: "gpt-image-1.5", imagePolicy: "optional" }],

  // 无需导航处理器
  navigationHandlers: [],

  // 核心生图方法
  generate,
};
