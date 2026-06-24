/**
 * @fileoverview LMArena 圖片生成配接器
 */

import { sleep, humanType, safeClick, pasteImages } from "../engine/utils.js";
import {
  waitApiResponse,
  normalizePageError,
  normalizeHttpError,
  waitForInput,
  gotoWithCheck,
  useContextDownload,
} from "../utils/index.js";
import { logger } from "../../utils/logger.js";

// --- 配置常量 ---
const TARGET_URL = "https://arena.ai/image/direct";

/**
 * 从回應文本中提取圖片 URL
 * @param {string} text - 回應文本内容
 * @returns {string|null} 提取到的圖片 URL，如果未找到则回傳 null
 */
function extractImage(text) {
  if (!text) return null;
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("a2:")) {
      try {
        const data = JSON.parse(line.substring(3));
        if (data?.[0]?.image) return data[0].image;
      } catch (e) {}
    }
  }
  return null;
}

/**
 * 从回應文本中提取錯誤資訊
 * SSE 錯誤格式:
 * - a3: 模型提供方錯誤 (如 OpenAI moderation_blocked)
 * - ae: Arena 平台錯誤 (如内容审核拦截)
 * @param {string} text - 回應文本内容
 * @returns {string|null} 提取到的錯誤資訊，如果未找到则回傳 null
 */
function extractError(text) {
  if (!text) return null;
  const lines = text.split("\n");
  for (const line of lines) {
    // a3: 模型提供方錯誤
    if (line.startsWith("a3:")) {
      try {
        const errorMsg = JSON.parse(line.substring(3));
        if (typeof errorMsg === "string") {
          // 尝试提取嵌套的 JSON 錯誤
          const jsonMatch = errorMsg.match(/\{[\s\S]*"error"[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const nested = JSON.parse(jsonMatch[0]);
              if (nested.error?.message) {
                return `[模型錯誤] ${nested.error.message} (code: ${nested.error.code || "unknown"})`;
              }
            } catch {}
          }
          return `[模型錯誤] ${errorMsg}`;
        }
      } catch (e) {}
    }
    // ae: Arena 平台錯誤
    if (line.startsWith("ae:")) {
      try {
        const errorData = JSON.parse(line.substring(3));
        if (errorData?.message) {
          return `[平台錯誤] ${errorData.message}`;
        }
        if (typeof errorData === "string") {
          return `[平台錯誤] ${errorData}`;
        }
      } catch (e) {}
    }
  }
  return null;
}

/**
 * 執行生图任务
 * @param {object} context - 瀏覽器上下文 { page, client }
 * @param {string} prompt - 提示詞
 * @param {string[]} imgPaths - 圖片路徑陣列
 * @param {string} [modelId] - 指定的模型 ID (可选)
 * @param {object} [meta={}] - 日誌元数据
 * @returns {Promise<{image?: string, text?: string, error?: string}>} 生成结果
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
  const { page, config } = context;
  const waitTimeout = config?.backend?.pool?.waitTimeout ?? 120000;
  const textareaSelector = "textarea";

  try {
    logger.info("配接器", "开启新会话...", meta);
    await gotoWithCheck(page, TARGET_URL);

    // 1. 等待輸入框載入
    await waitForInput(page, textareaSelector, { click: true });

    // 2. 选择模型
    if (modelId) {
      logger.debug("配接器", `选择模型: ${modelId}`, meta);
      // 使用键盘导航展开模型选择框：按两次 Shift+Tab 然后 Enter
      await page.keyboard.down("Shift");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.up("Shift");
      await sleep(100, 200);
      await page.keyboard.press("Enter");

      // 取得模型配置，优先使用 codeName，否则使用 id
      const modelConfig = manifest.models.find((m) => m.id === modelId);
      const searchText = modelConfig?.codeName || modelId;

      // 模擬粘贴輸入模型名称
      await page.evaluate((text) => {
        document.execCommand("insertText", false, text);
      }, searchText);

      // 等待过滤完成：第一个选项包含目标模型的主 ID
      // searchText 可能是 codeName（含括号说明），但过滤后的选项应该包含 modelId
      try {
        await page.waitForFunction(
          (targetId) => {
            const firstOption = document.querySelector('[role="option"]');
            return firstOption && firstOption.textContent?.includes(targetId);
          },
          modelId,
          { timeout: 5000 },
        );
      } catch {
        // 逾時也继续，可能列表结构不同
        logger.debug("配接器", `等待模型选项过滤逾時，继续執行`, meta);
      }
      await sleep(300, 500);
      await page.keyboard.press("Enter");
    }

    // 3. 上傳圖片
    if (imgPaths && imgPaths.length > 0) {
      logger.info("配接器", `开始上傳 ${imgPaths.length} 张圖片`, meta);
      await pasteImages(page, textareaSelector, imgPaths, {}, meta);
      logger.info("配接器", "圖片上傳完成", meta);
    }

    // 4. 輸入提示詞
    await safeClick(page, textareaSelector, { bias: "input" });
    logger.info("配接器", "輸入提示詞...", meta);
    await humanType(page, textareaSelector, prompt);

    // 5. 先啟動 API 监听
    logger.debug("配接器", "啟動 API 监听...", meta);
    const responsePromise = waitApiResponse(page, {
      urlMatch: "/nextjs-api/stream",
      method: "POST",
      timeout: waitTimeout,
      meta,
    });

    // 6. 发送提示詞
    logger.info("配接器", "发送提示詞...", meta);
    await safeClick(page, 'button[type="submit"]', { bias: "button" });

    logger.info("配接器", "等待生成结果...", meta);

    // 7. 等待 API 回應
    let response;
    try {
      response = await responsePromise;
    } catch (e) {
      // 使用公共錯誤处理
      const pageError = normalizePageError(e, meta);
      if (pageError) return pageError;
      throw e;
    }

    // 7. 解析回應结果
    const content = await response.text();

    // 8. 检查 HTTP 錯誤
    const httpError = normalizeHttpError(response, content);
    if (httpError) {
      logger.error("配接器", `请求生成时回傳錯誤: ${httpError.error}`, meta);
      return {
        error: `请求生成时回傳錯誤: ${httpError.error}`,
        retryable: httpError.retryable,
      };
    }

    // 8.5 检查 SSE 錯誤 (a3/ae 行)
    const sseError = extractError(content);
    if (sseError) {
      logger.warn("配接器", `SSE 錯誤: ${sseError}`, meta);
      return { error: sseError, retryable: false };
    }

    // 9. 提取圖片 URL
    const img = extractImage(content);
    if (img) {
      // 检查是否配置了回傳 URL
      const returnUrl = config?.backend?.adapter?.lmarena?.returnUrl || false;
      if (returnUrl) {
        logger.info("配接器", "已取得结果，回傳 URL", meta);
        return { image: img };
      }

      logger.info("配接器", "已取得结果，正在下載圖片...", meta);
      const imgDlCfg = config?.backend?.pool?.failover || {};
      const result = await useContextDownload(img, page, {
        retries: imgDlCfg.imgDlRetry ? imgDlCfg.imgDlRetryMaxRetries || 2 : 0,
      });
      if (result.image) {
        logger.info("配接器", "已下載圖片，任务完成", meta);
      }
      return result;
    } else {
      logger.warn("配接器", "未获得结果，回應中无圖片数据", {
        ...meta,
        preview: content.substring(0, 150),
      });
      return {
        error: `未获得结果，回應中无圖片数据: ${content.substring(0, 200)}`,
      };
    }
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
  id: "lmarena",
  displayName: "LMArena (圖片生成)",
  description:
    "使用 LMArena 平台生成圖片，支援多种圖片生成模型。需要已登录的 LMArena 账户，若不登录会频繁弹出人机验证码且有速率限制。",

  // 配置项模式
  configSchema: [
    {
      key: "returnUrl",
      label: "回傳圖片 URL",
      type: "boolean",
      default: false,
      note: "开启后直接回傳圖片 URL (但其他不支援该选项的配接器仍然会回傳 Base64)",
    },
  ],

  // 入口 URL
  getTargetUrl(config, workerConfig) {
    return TARGET_URL;
  },

  // 模型列表
  models: [
    {
      id: "gemini-3.1-flash-image-preview",
      codeName: "gemini-3.1-flash-image-preview (nano-banana-2) [web-search]",
      imagePolicy: "optional",
    },
    { id: "gpt-image-1.5-high-fidelity", imagePolicy: "optional" },
    {
      id: "gemini-3-pro-image-preview-2k",
      codeName: "gemini-3-pro-image-preview-2k (nano-banana-pro)",
      imagePolicy: "optional",
    },
    { id: "mai-image-2", imagePolicy: "forbidden" },
    { id: "reve-v1.5", imagePolicy: "required" },
    { id: "flux-2-max", imagePolicy: "optional" },
    { id: "flux-2-flex", imagePolicy: "optional" },
    { id: "flux-2-pro", imagePolicy: "optional" },
    { id: "hunyuan-image-3.0", imagePolicy: "forbidden" },
    { id: "flux-2-dev", imagePolicy: "optional" },
    { id: "seedream-4.5", imagePolicy: "optional" },
    { id: "qwen-image-2512", imagePolicy: "forbidden" },
    { id: "imagen-4.0-generate-001", imagePolicy: "forbidden" },
    { id: "wan2.5-t2i-preview", imagePolicy: "forbidden" },
    { id: "gpt-image-1", imagePolicy: "optional" },
    { id: "seedream-5.0-lite", imagePolicy: "optional" },
    { id: "seedream-4-high-res-fal", imagePolicy: "optional" },
    { id: "gpt-image-1-mini", imagePolicy: "optional" },
    { id: "recraft-v4", imagePolicy: "forbidden" },
    { id: "seedream-3", imagePolicy: "forbidden" },
    { id: "flux-2-klein-9b", imagePolicy: "optional" },
    { id: "qwen-image-prompt-extend", imagePolicy: "forbidden" },
    { id: "flux-1-kontext-pro", imagePolicy: "optional" },
    { id: "imagen-3.0-generate-002", imagePolicy: "forbidden" },
    { id: "ideogram-v3-quality", imagePolicy: "forbidden" },
    { id: "photon", imagePolicy: "forbidden" },
    { id: "p-image", imagePolicy: "forbidden" },
    { id: "flux-2-klein-4b", imagePolicy: "optional" },
    { id: "recraft-v3", imagePolicy: "forbidden" },
    { id: "runway-gen4", imagePolicy: "forbidden" },
    { id: "lucid-origin", imagePolicy: "forbidden" },
    { id: "dall-e-3", imagePolicy: "forbidden" },
    { id: "flux-1-kontext-dev", imagePolicy: "optional" },
    { id: "imagen-4.0-ultra-generate-001", imagePolicy: "forbidden" },
    { id: "p-image-edit", imagePolicy: "required" },
    { id: "hunyuan-image-2.1", imagePolicy: "forbidden" },
    { id: "reve-v1.1", imagePolicy: "required" },
    { id: "vidu-q2-image", imagePolicy: "optional" },
    { id: "imagen-4.0-fast-generate-001", imagePolicy: "forbidden" },
    { id: "qwen-image-2.0", imagePolicy: "forbidden" },
    { id: "qwen-image-2.0-pro", imagePolicy: "forbidden" },
    { id: "reve-v1.1-fast", imagePolicy: "required" },
    { id: "kling-image-o1", imagePolicy: "forbidden" },
    {
      id: "chatgpt-image-latest-high-fidelity",
      codeName: "chatgpt-image-latest-high-fidelity (20251216)",
      imagePolicy: "required",
    },
    { id: "hunyuan-image-3.0-instruct", imagePolicy: "required" },
    { id: "wan2.7-image", imagePolicy: "required" },
    { id: "grok-imagine-image-pro", imagePolicy: "forbidden" },
    { id: "grok-imagine-image", imagePolicy: "forbidden" },
    { id: "wan2.7-image-pro", imagePolicy: "required" },
    { id: "qwen-image-edit-2511", imagePolicy: "required" },
    {
      id: "gemini-2.5-flash-image-preview",
      codeName: "gemini-2.5-flash-image-preview (nano-banana)",
      imagePolicy: "optional",
    },
    { id: "wan2.5-i2i-preview", imagePolicy: "required" },
    { id: "qwen-image-edit", imagePolicy: "required" },
    { id: "wan2.6-image", imagePolicy: "required" },
    { id: "seededit-3.0", imagePolicy: "required" },
    { id: "wan2.6-t2i", imagePolicy: "forbidden" },
  ],

  // 无需导航处理器
  navigationHandlers: [],

  // 核心生图方法
  generate,
};
