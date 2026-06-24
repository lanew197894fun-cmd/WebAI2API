/**
 * @fileoverview NanoBananaFree 圖片生成配接器
 */

import { sleep, humanType, safeClick, pasteImages } from "../engine/utils.js";
import {
  waitApiResponse,
  normalizePageError,
  normalizeHttpError,
  waitForInput,
  gotoWithCheck,
} from "../utils/index.js";
import { logger } from "../../utils/logger.js";

// --- 配置常量 ---
const TARGET_URL = "https://nanobananafree.ai/";

/**
 * 執行生图任务
 * @param {object} context - 瀏覽器上下文 { page, client }
 * @param {string} prompt - 提示詞
 * @param {string[]} imgPaths - 圖片路徑陣列 (仅取第一张)
 * @param {string} [modelId] - 指定的模型 ID (可选，目前未使用)
 * @param {object} [meta={}] - 日誌元数据
 * @returns {Promise<{image?: string, text?: string, error?: string}>} 生成结果
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
  const { page, config } = context;
  const waitTimeout = config?.backend?.pool?.waitTimeout ?? 120000;
  const textareaSelector = "textarea";

  try {
    logger.info("配接器", "开启新会话", meta);
    await gotoWithCheck(page, TARGET_URL);

    // 1. 等待輸入框載入
    await waitForInput(page, textareaSelector, { click: false });
    //await sleep(1500, 2500);

    // 2. 上傳圖片 (仅取第一张)
    if (imgPaths && imgPaths.length > 0) {
      logger.info("配接器", `开始上傳 ${imgPaths.length} 张圖片`, meta);
      const singleImage = [imgPaths[0]];
      if (imgPaths.length > 1) {
        logger.warn(
          "配接器",
          `此后端仅支援1张圖片, 已丢弃 ${imgPaths.length - 1} 张`,
          meta,
        );
      }
      await pasteImages(page, textareaSelector, singleImage, {}, meta);
      logger.info("配接器", "圖片上傳完成", meta);
    }

    // 3. 輸入提示詞
    logger.info("配接器", "輸入提示詞...", meta);
    await safeClick(page, textareaSelector, { bias: "input" });
    await humanType(page, textareaSelector, prompt);

    // 4. 先啟動 API 监听
    logger.debug("配接器", "啟動 API 监听...", meta);
    const responsePromise = waitApiResponse(page, {
      urlMatch: "v1/generateContent",
      method: "POST",
      timeout: waitTimeout,
      meta,
    });

    // 5. 发送提示詞
    logger.info("配接器", "发送提示詞...", meta);
    await safeClick(page, 'div[class*="_sendButton_"]', { bias: "button" });

    logger.info("配接器", "等待生成结果...", meta);

    // 6. 等待 API 回應
    let response;
    try {
      response = await responsePromise;
    } catch (e) {
      // 使用公共錯誤处理
      const pageError = normalizePageError(e, meta);
      if (pageError) return pageError;
      throw e;
    }

    // 6. 解析回應结果
    // 先尝试取得回應内容用于錯誤解析
    let content = null;
    try {
      content = await response.text();
    } catch (e) {}

    // 检查 HTTP 錯誤
    const httpError = normalizeHttpError(response, content);
    if (httpError) {
      logger.error("配接器", `请求生成时回傳錯誤: ${httpError.error}`, meta);
      return { error: `请求生成时回傳錯誤: ${httpError.error}` };
    }

    // 解析成功回應（使用已讀取的 content）
    let body;
    try {
      body = JSON.parse(content);
    } catch (e) {
      logger.error("配接器", "解析回應JSON时出错", meta);
      return { error: "解析回應JSON时出错" };
    }

    // 7. 提取 base64 圖片
    const inlineData =
      body?.data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (inlineData) {
      logger.info("配接器", "已取得生结果, 且已取得圖片数据", meta);
      return { image: `data:image/png;base64,${inlineData}` };
    } else {
      logger.info("配接器", "AI 回傳非圖片回應", {
        ...meta,
        preview: JSON.stringify(body).substring(0, 150),
      });
      return { text: JSON.stringify(body) };
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
  id: "nanobananafree_ai",
  displayName: "NanoBananaFree (圖片生成)",
  description:
    "使用 NanoBananaFree 平台生成圖片，仅支援上傳单张圖片。需要已登录的 Google 账户。",

  // 入口 URL
  getTargetUrl(config, workerConfig) {
    return TARGET_URL;
  },

  // 模型列表
  models: [{ id: "gemini-2.5-flash-image", imagePolicy: "optional" }],

  // 无需导航处理器
  navigationHandlers: [],

  // 核心生图方法
  generate,
};
