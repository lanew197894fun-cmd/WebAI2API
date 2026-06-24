/**
 * @fileoverview Sora 视频生成配接器
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
  useContextDownload,
} from "../utils/index.js";
import { logger } from "../../utils/logger.js";

// --- 配置常量 ---
const TARGET_URL = "https://sora.chatgpt.com/profile";
const INPUT_SELECTOR = "textarea";

/**
 * 執行视频生成任务
 * @param {object} context - 瀏覽器上下文 { page, config }
 * @param {string} prompt - 提示詞
 * @param {string[]} imgPaths - 圖片路徑陣列 (只使用第一张)
 * @param {string} [modelId] - 模型 ID (此配接器未使用)
 * @param {object} [meta={}] - 日誌元数据
 * @returns {Promise<{video?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
  const { page, config } = context;

  // 用于存储任务 ID 和视频 URL
  let taskId = null;
  let videoUrl = null;

  try {
    logger.info("配接器", "开启新会话...", meta);
    await gotoWithCheck(page, TARGET_URL);

    // 1. 等待輸入框載入
    await waitForInput(page, INPUT_SELECTOR, { click: false });

    // 2. 上傳圖片 (仅取第一张)
    if (imgPaths && imgPaths.length > 0) {
      logger.info("配接器", `开始上傳 ${imgPaths.length} 张圖片`, meta);
      const singleImgPath = [imgPaths[0]];
      if (imgPaths.length > 1) {
        logger.warn(
          "配接器",
          `此后端仅支援1张圖片，已丢弃 ${imgPaths.length - 1} 张`,
          meta,
        );
      }

      logger.debug("配接器", "點擊上傳檔案按钮...", meta);
      const attachBtn = page.getByRole("button", { name: "Attach media" });

      await uploadFilesViaChooser(
        page,
        attachBtn,
        singleImgPath,
        {
          uploadValidator: (response) => {
            const url = response.url();
            if (
              response.status() === 200 &&
              url.includes("project_y/file/upload")
            ) {
              return true;
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

    // 4. 提前設定回應监听器 (drafts 介面)
    // 因为 drafts 请求在 pending/v2 偵測到任务消失后立即出现，需要提前监听
    let draftsResponsePromise = null;
    const startDraftsListener = () => {
      draftsResponsePromise = page.waitForResponse(
        async (response) => {
          const url = response.url();
          if (!url.includes("project_y/profile/drafts")) return false;
          if (response.request().method() !== "GET") return false;
          if (response.status() !== 200) return false;
          return true;
        },
        { timeout: 600000 },
      ); // 10 分钟逾時
    };

    // 5. 點擊 Create video 按钮并监听 nf/create 请求
    logger.debug("配接器", "設定监听器视频...", meta);
    const createBtn = page.getByRole("button", { name: "Create video" });

    // 設定 create 请求监听
    const createResponsePromise = page.waitForResponse(
      async (response) => {
        const url = response.url();
        if (!url.includes("nf/create")) return false;
        if (response.request().method() !== "POST") return false;
        if (response.status() !== 200) return false;
        return true;
      },
      { timeout: 60000 },
    );

    // 发送提示詞
    logger.info("配接器", "发送提示詞...", meta);
    await safeClick(page, createBtn, { bias: "button" });

    // 等待 create 回應
    logger.info("配接器", "等待建立任务...", meta);
    const createResponse = await createResponsePromise;

    try {
      const createBody = await createResponse.json();
      taskId = createBody.id;
      if (!taskId) {
        logger.error("配接器", "建立回應中没有 id", meta);
        return { error: "建立任务失败：回應中没有 id" };
      }
      logger.info("配接器", `任务已建立, id: ${taskId}`, meta);
    } catch (e) {
      logger.error("配接器", "解析 create 回應失败", {
        ...meta,
        error: e.message,
      });
      return { error: "解析建立回應失败" };
    }

    // 6. 啟動 drafts 监听器 (提前监听)
    startDraftsListener();

    // 7. 监听 nf/pending/v2 等待任务完成
    logger.info("配接器", "等待视频生成完成...", meta);

    let taskCompleted = false;
    const maxWaitTime = 300000; // 5 分钟
    const startTime = Date.now();

    while (!taskCompleted && Date.now() - startTime < maxWaitTime) {
      try {
        const pendingResponse = await page.waitForResponse(
          async (response) => {
            const url = response.url();
            if (!url.includes("nf/pending/v2")) return false;
            if (response.request().method() !== "GET") return false;
            if (response.status() !== 200) return false;
            return true;
          },
          { timeout: 30000 },
        );

        const pendingBody = await pendingResponse.json();

        // 检查任务是否还在列表中
        const taskInList = pendingBody.find((item) => item.id === taskId);

        if (taskInList) {
          const status = taskInList.status;
          logger.debug("配接器", `任务状态: ${status}`, meta);
          // preprocessing, queued, running, processing 都表示进行中
        } else {
          // 任务不在列表中，说明已完成
          logger.info("配接器", "任务已完成，等待取得视频链接...", meta);
          taskCompleted = true;
        }
      } catch (e) {
        // 逾時重試
        if (e.name === "TimeoutError") {
          logger.debug("配接器", "等待 pending 回應逾時，继续等待...", meta);
        } else {
          throw e;
        }
      }
    }

    if (!taskCompleted) {
      logger.error("配接器", "等待视频生成逾時 (5分钟)", meta);
      return { error: "等待视频生成逾時 (5分钟)" };
    }

    // 8. 取得 drafts 回應中的视频 URL
    logger.debug("配接器", "取得视频链接...", meta);

    try {
      const draftsResponse = await draftsResponsePromise;
      const draftsBody = await draftsResponse.json();

      // 在 items 陣列中查找 task_id 匹配的项目
      const items = draftsBody.items || draftsBody;
      const targetItem = (Array.isArray(items) ? items : []).find(
        (item) => item.task_id === taskId,
      );

      if (!targetItem) {
        logger.error("配接器", "未找到匹配的视频任务", meta);
        return { error: "未找到匹配的视频任务" };
      }

      videoUrl = targetItem.url;
      if (!videoUrl) {
        logger.error("配接器", "视频项目中没有 url", meta);
        return { error: "视频项目中没有 url" };
      }

      logger.info("配接器", "已取得视频链接", meta);
    } catch (e) {
      logger.error("配接器", "取得视频链接失败", { ...meta, error: e.message });
      return { error: `取得视频链接失败: ${e.message}` };
    }

    // 9. 下載视频并转为 base64
    logger.info("配接器", "正在下載视频...", meta);
    const imgDlCfg = config?.backend?.pool?.failover || {};
    const downloadResult = await useContextDownload(videoUrl, page, {
      retries: imgDlCfg.imgDlRetry ? imgDlCfg.imgDlRetryMaxRetries || 2 : 0,
    });

    if (downloadResult.error) {
      logger.error("配接器", downloadResult.error, meta);
      return downloadResult;
    }

    logger.info("配接器", "视频生成完成，任务完成", meta);
    return { image: downloadResult.image }; // 复用 image 字段存储 base64
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
  id: "sora",
  displayName: "Sora (视频生成)",
  description:
    "使用 OpenAI Sora 生成视频，仅支援上傳单张参考圖片。需要已登录的 ChatGPT 账户。",

  // 入口 URL
  getTargetUrl(config, workerConfig) {
    return TARGET_URL;
  },

  // 模型列表
  models: [{ id: "sora-2", imagePolicy: "optional" }],

  // 无需导航处理器
  navigationHandlers: [],

  // 核心视频生成方法
  generate,
};
