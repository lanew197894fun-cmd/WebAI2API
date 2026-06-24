/**
 * @fileoverview ChatGPT 文本生成配接器
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
} from "../utils/index.js";
import { logger } from "../../utils/logger.js";

// --- 配置常量 ---
const TARGET_URL = "https://chatgpt.com/"; // 基础URL
const INPUT_SELECTOR = ".ProseMirror";

/**
 * 通过 UI 选择模型
 * @param {import('playwright-core').Page} page - 页面物件
 * @param {string} codeName - 模型 codeName
 * @param {object} meta - 日誌元数据
 * @returns {Promise<boolean>} 是否成功选择了模型
 */
async function selectModel(page, codeName, meta = {}) {
  try {
    // 1. 點擊 Model selector 按钮
    const modelSelectorBtn = page.getByRole("button", {
      name: /^Model selector/,
    });
    const btnExists = await modelSelectorBtn.count();
    if (btnExists === 0) {
      logger.debug("配接器", "未找到模型选择器按钮，跳過选择模型", meta);
      return false;
    }

    await modelSelectorBtn.waitFor({ timeout: 5000 });
    await safeClick(page, modelSelectorBtn, { bias: "button" });
    await sleep(300, 500);

    // 2. 检查是否有 Legacy models 选项
    const legacyMenuItem = page.getByRole("menuitem", {
      name: /^Legacy models/,
    });
    const legacyExists = await legacyMenuItem.count();
    if (legacyExists > 0) {
      logger.debug("配接器", "发现 Legacy models 选项，正在點擊...", meta);
      await safeClick(page, legacyMenuItem, { bias: "button" });
      await sleep(300, 500);
    }

    // 3. 查找匹配 codeName 开头的 menuitem 或 menuitemradio
    let targetMenuItem = page.getByRole("menuitemradio", {
      name: new RegExp(`^${codeName}`, "i"),
    });
    let targetExists = await targetMenuItem.count();
    if (targetExists === 0) {
      targetMenuItem = page.getByRole("menuitem", {
        name: new RegExp(`^${codeName}`, "i"),
      });
      targetExists = await targetMenuItem.count();
    }

    if (targetExists > 0) {
      logger.info("配接器", `正在选择模型: ${codeName}`, meta);
      await safeClick(page, targetMenuItem.first(), { bias: "button" });
      return true;
    } else {
      logger.debug("配接器", `未找到模型 ${codeName}，使用預設模型`, meta);
      // 點擊空白区域關閉菜单
      await page.keyboard.press("Escape");
      return false;
    }
  } catch (e) {
    logger.warn("配接器", `选择模型失败: ${e.message}`, meta);
    // 尝试關閉菜单
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
}

/**
 * 執行文本生成任务
 * @param {object} context - 瀏覽器上下文 { page, config }
 * @param {string} prompt - 提示詞
 * @param {string[]} imgPaths - 圖片路徑陣列
 * @param {string} [modelId] - 模型 ID
 * @param {object} [meta={}] - 日誌元数据
 * @returns {Promise<{text?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
  const { page, config } = context;
  const waitTimeout = config?.backend?.pool?.waitTimeout ?? 120000;
  const sendBtnLocator = page.getByRole("button", { name: "Send prompt" });

  try {
    const useTemp =
      config?.backend?.adapter?.chatgpt_text?.temporaryChat || false;
    const targetUrl = useTemp
      ? "https://chatgpt.com/?temporary-chat=true"
      : "https://chatgpt.com/"; // 感谢 @zhongjianhua163 提供临时对话方案
    logger.info("配接器", "开启新会话...", meta);
    await gotoWithCheck(page, targetUrl);

    // 1. 等待輸入框載入
    await waitForInput(page, INPUT_SELECTOR, { click: false });

    // 2. 选择模型
    if (modelId) {
      const modelConfig = manifest.models.find((m) => m.id === modelId);
      if (modelConfig && modelConfig.codeName) {
        await selectModel(page, modelConfig.codeName, meta);
      } else {
        logger.info(
          "配接器",
          `未指定模型或未知模型 (${modelId})，跳過模型选择`,
          meta,
        );
      }
    }

    // 3. 上傳圖片 (双击 Add files and more 按钮)
    if (imgPaths && imgPaths.length > 0) {
      logger.info("配接器", `开始上傳 ${imgPaths.length} 张圖片...`, meta);
      const expectedUploads = imgPaths.length;
      let uploadedCount = 0;
      let processedCount = 0;

      logger.debug("配接器", "双击添加檔案按钮...", meta);
      const addFilesBtn = page.getByRole("button", {
        name: "Add files and more",
      });

      await uploadFilesViaChooser(
        page,
        addFilesBtn,
        imgPaths,
        {
          clickAction: "dblclick", // 使用双击
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
    }

    // 3. 輸入提示詞
    logger.info("配接器", "輸入提示詞...", meta);
    await safeClick(page, INPUT_SELECTOR, { bias: "input" });
    await humanType(page, INPUT_SELECTOR, prompt);

    // 4. 先啟動 SSE 监听，再发送提示詞（避免竞态）
    logger.info("配接器", "监听 SSE 流取得文本...", meta);

    let textContent = "";
    let isComplete = false;
    let targetMessageId = null; // 只追踪 channel: "final" 的消息

    const responsePromise = page.waitForResponse(
      async (response) => {
        const url = response.url();
        if (!url.includes("backend-api/f/conversation")) return false;
        if (response.request().method() !== "POST") return false;
        if (response.status() !== 200) return false;

        try {
          const body = await response.text();
          const lines = body.split("\n");

          for (const line of lines) {
            // 跳過空行和事件行
            if (!line.startsWith("data: ")) continue;

            const dataStr = line.slice(6).trim();
            if (dataStr === "[DONE]") {
              isComplete = true;
              continue;
            }

            try {
              const data = JSON.parse(dataStr);

              // 偵測目标消息 (assistant 角色, channel: "final", content_type: "text")
              if (
                data.v?.message?.author?.role === "assistant" &&
                data.v?.message?.channel === "final" &&
                data.v?.message?.content?.content_type === "text"
              ) {
                targetMessageId = data.v.message.id;
                // 重置内容（即使 parts[0] 为空也要重置，清除之前 commentary 的文本）
                const parts = data.v.message.content.parts;
                textContent = (parts && parts[0]) || "";
              }

              // 以下所有内容累积都必須在 targetMessageId 設定之后才執行
              // 避免误收 commentary / thinking 频道的内容
              if (!targetMessageId) continue;

              // 累积 delta 内容 (append 操作，顶层 path)
              if (
                data.o === "append" &&
                data.p === "/message/content/parts/0" &&
                data.v
              ) {
                textContent += data.v;
              }

              // patch 操作中的 append (陣列格式)
              if (Array.isArray(data.v)) {
                for (const patch of data.v) {
                  if (
                    patch.o === "append" &&
                    patch.p === "/message/content/parts/0" &&
                    patch.v
                  ) {
                    textContent += patch.v;
                  }
                  // 仅在 targetMessageId 存在时检查完成
                  if (
                    patch.p === "/message/status" &&
                    patch.v === "finished_successfully"
                  ) {
                    isComplete = true;
                  }
                }
              }

              // message_stream_complete 表示完成
              if (data.type === "message_stream_complete") {
                isComplete = true;
              }
            } catch {
              // 忽略解析錯誤
            }
          }

          return isComplete;
        } catch {
          return false;
        }
      },
      { timeout: waitTimeout },
    );

    // 5. 发送提示詞
    logger.debug("配接器", "发送提示詞...", meta);
    await page.keyboard.press("Enter");

    logger.info("配接器", "等待生成结果...", meta);

    // 6. 等待 SSE 回應完成
    try {
      await responsePromise;
    } catch (e) {
      const pageError = normalizePageError(e, meta);
      if (pageError) return pageError;
      throw e;
    }

    if (!textContent || textContent.trim() === "") {
      logger.warn("配接器", "回复内容为空", meta);
      return { error: "回复内容为空" };
    }

    logger.info("配接器", `已取得文本内容 (${textContent.length} 字元)`, meta);
    logger.info("配接器", "文本生成完成，任务完成", meta);
    return { text: textContent.trim() };
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
  id: "chatgpt_text",
  displayName: "ChatGPT (文本生成)",
  description:
    "使用 ChatGPT 官网生成文本，支援多模型切换和圖片上傳。需要已登录的 ChatGPT 账户，若需要选择模型，请使用会员帳號 (包含 K12 教室认证帳號)。",

  // 配置项模式
  configSchema: [
    {
      key: "temporaryChat",
      label: "临时对话",
      type: "boolean",
      default: false,
      note: "开启后将使用临时对话模式 (?temporary-chat=true)",
    },
  ],

  // 入口 URL
  getTargetUrl(config, workerConfig) {
    const useTemp =
      config?.backend?.adapter?.chatgpt_text?.temporaryChat || false;
    return useTemp
      ? "https://chatgpt.com/?temporary-chat=true"
      : "https://chatgpt.com/";
  },

  // 模型列表
  models: [
    {
      id: "gpt-instant",
      codeName: "Instant",
      imagePolicy: "optional",
      type: "text",
    },
    {
      id: "gpt-thinking",
      codeName: "Thinking",
      imagePolicy: "optional",
      type: "text",
    },
    { id: "gpt-pro", codeName: "Pro", imagePolicy: "optional", type: "text" },
  ],

  // 无需导航处理器
  navigationHandlers: [],

  // 核心文本生成方法
  generate,
};
