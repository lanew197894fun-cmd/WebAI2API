/**
 * @fileoverview Gemini Business 圖片、视频生成配接器
 */

import { sleep, humanType, safeClick, pasteImages } from "../engine/utils.js";
import {
  normalizePageError,
  normalizeHttpError,
  waitApiResponse,
  waitForPageAuth,
  lockPageAuth,
  unlockPageAuth,
  isPageAuthLocked,
  waitForInput,
  gotoWithCheck,
} from "../utils/index.js";
import { logger } from "../../utils/logger.js";

// Gemini Biz 輸入框选择器
const INPUT_SELECTOR = "ucs-prosemirror-editor .ProseMirror";

/**
 * 处理账户选择页面跳转
 * @param {import('playwright-core').Page} page - Playwright 页面物件
 * @param {string} targetUrl - 目标 URL，用于判断跳转完成
 * @returns {Promise<boolean>} 是否处理了跳转
 */
async function handleAccountChooser(page) {
  // 防止重复处理
  if (isPageAuthLocked(page)) return false;

  try {
    const currentUrl = page.url();
    if (currentUrl.includes("auth.business.gemini.google/account-chooser")) {
      lockPageAuth(page);
      logger.info(
        "配接器",
        "[登录器(gemini_biz)] 偵測到账户选择页面，尝试自动确认...",
      );

      // 尝试查找提交按钮 (通常是标准的 button[type="submit"])
      const submitBtn = await page.$('button[type="submit"]');
      if (submitBtn) {
        // 确保按钮在可视区域
        await submitBtn.scrollIntoViewIfNeeded();
        await sleep(300, 500);

        // 使用 safeClick 模擬人类點擊行为
        logger.info("配接器", "[登录器(gemini_biz)] 正在點擊确认按钮...");
        await safeClick(page, submitBtn, { bias: "button" });

        // 點擊后等待跳转回目标页面
        logger.info("配接器", "[登录器(gemini_biz)] 等待跳转回目标页面...");
        try {
          await page.waitForFunction(
            () => {
              const href = window.location.href;
              return (
                !href.includes("accounts.google.com") &&
                !href.includes("auth.business.gemini.google") &&
                href.includes("business.gemini.google")
              );
            },
            { timeout: 60000, polling: 1000 },
          );

          logger.info("配接器", `[登录器(gemini_biz)] 已跳转回目标页面`);
        } catch (timeoutErr) {
          const finalUrl = page.url();
          logger.warn(
            "配接器",
            `[登录器(gemini_biz)] 等待跳转回目标页面逾時，尝试继续... 当前URL: ${finalUrl}`,
          );
        }

        // 额外缓冲时间，确保页面完全載入
        await sleep(2000, 3000);
        unlockPageAuth(page);
        return true;
      } else {
        // 按钮还没載入出来，保持锁，等待下次检查
        logger.debug("配接器", "[登录器(gemini_biz)] 按钮尚未載入，等待中...");
        await sleep(500, 1000);
        unlockPageAuth(page); // 释放锁让下次尝试
        return true; // 回傳 true 表示"仍在处理中"
      }
    }
  } catch (err) {
    logger.warn(
      "配接器",
      `[登录器(gemini_biz)] 处理账户选择页面失败: ${err.message}`,
    );
    unlockPageAuth(page);
  }
  return false;
}

/**
 * 生成圖片
 * @param {object} context - 瀏覽器上下文 { page, client, config }
 * @param {string} prompt - 提示詞
 * @param {string[]} imgPaths - 参考圖片路徑陣列
 * @param {string} modelId - 模型 ID (目前未使用,固定为 gemini-3-pro-preview)
 * @returns {Promise<{image?: string, error?: string}>} 生成结果
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
  const { page, config } = context;
  const waitTimeout = config?.backend?.pool?.waitTimeout ?? 120000;

  try {
    // 支援新路徑 adapter.gemini_biz.entryUrl，向下兼容旧路徑 geminiBiz.entryUrl
    const targetUrl =
      config.backend?.adapter?.gemini_biz?.entryUrl ||
      config.backend?.geminiBiz?.entryUrl;

    if (!targetUrl) {
      throw new Error("未填写 gemini_biz 配接器的 entry URL");
    }

    // 验证 URL 域名
    if (!targetUrl.includes("business.gemini.google")) {
      throw new Error(
        "无效的 Gemini Business URL，必須包含 business.gemini.google 域名",
      );
    }

    // 开启新对话 - 先等待可能正在进行的登录处理完成
    await waitForPageAuth(page);
    logger.info("配接器", "开启新会话", meta);
    await gotoWithCheck(page, targetUrl);

    // 如果触发了账户选择跳转，等待全局处理器完成
    await waitForPageAuth(page);

    // 1. 等待輸入框載入
    logger.debug("配接器", "正在寻找輸入框...", meta);
    await waitForInput(page, INPUT_SELECTOR, { click: false });

    // 2. 上傳圖片
    if (imgPaths && imgPaths.length > 0) {
      logger.info("配接器", `开始上傳 ${imgPaths.length} 张圖片...`, meta);
      await pasteImages(
        page,
        INPUT_SELECTOR,
        imgPaths,
        {
          uploadValidator: (response) => {
            const url = response.url();
            // 只追踪 widgetAddContextFile 请求，每个请求代表一张圖片上傳
            return (
              response.status() === 200 &&
              url.includes("global/widgetAddContextFile")
            );
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

    // 4. 設定请求拦截器（根据模型類型修改请求）
    logger.debug("配接器", "已啟用请求拦截", meta);
    await page.unroute("**/*").catch(() => {});

    // 判断是否为 grounding 模式
    const isGrounding = modelId.endsWith("-grounding");
    // 从 models 列表中查找对应的 codeName
    const modelConfig = manifest.models.find((m) => m.id === modelId);
    const baseCodeName = modelConfig?.codeName || modelId;
    const actualModelId = isGrounding ? baseCodeName : baseCodeName;

    await page.route(
      (url) => url.href.includes("global/widgetStreamAssist"),
      async (route) => {
        const request = route.request();
        if (request.method() !== "POST") return route.continue();

        try {
          const postData = request.postDataJSON();
          if (postData) {
            logger.debug("配接器", "已拦截请求，正在修改...", meta);
            if (!postData.streamAssistRequest)
              postData.streamAssistRequest = {};
            if (!postData.streamAssistRequest.assistGenerationConfig)
              postData.streamAssistRequest.assistGenerationConfig = {};

            // 設定模型 ID
            postData.streamAssistRequest.assistGenerationConfig.modelId =
              actualModelId;

            // 根据模式設定 toolsSpec
            if (isGrounding) {
              postData.streamAssistRequest.toolsSpec = { webGroundingSpec: {} };
              logger.info(
                "配接器",
                `已拦截请求，使用 Grounding 模式 (模型: ${actualModelId})`,
                meta,
              );
            } else {
              // 文本模式不需要额外工具
              postData.streamAssistRequest.toolsSpec = {};
              logger.info(
                "配接器",
                `已拦截请求，使用文本模式 (模型: ${actualModelId})`,
                meta,
              );
            }

            await route.continue({ postData: JSON.stringify(postData) });
            return;
          }
        } catch (e) {
          logger.error("配接器", "请求拦截处理失败", {
            ...meta,
            error: e.message,
          });
        }
        await route.continue();
      },
    );

    // 5. 先啟動 API 监听
    logger.debug("配接器", "啟動 API 监听...", meta);
    const apiResponsePromise = waitApiResponse(page, {
      urlMatch: "global/widgetStreamAssist",
      method: "POST",
      timeout: waitTimeout,
      errorText: ["modelArmorViolation"],
      meta,
    });

    // 6. 发送提示詞
    logger.info("配接器", "发送提示詞...", meta);
    await safeClick(
      page,
      'md-icon-button.send-button.submit, button[aria-label="Send"], .send-button',
      { bias: "button" },
    );

    logger.info("配接器", "等待生成结果中...", meta);

    // 7. 等待 API 回應
    let apiResponse;
    try {
      apiResponse = await apiResponsePromise;
    } catch (e) {
      const pageError = normalizePageError(e, meta);
      if (pageError) return pageError;
      throw e;
    }

    // 检查 API 回應状态
    const httpError = normalizeHttpError(apiResponse);
    if (httpError) {
      logger.error("配接器", `请求生成时回傳錯誤: ${httpError.error}`, meta);
      return { error: `请求生成时回傳錯誤: ${httpError.error}` };
    }

    // 7. 解析文本回應
    const content = await apiResponse.text();
    logger.debug("配接器", `收到回應，长度: ${content.length}`, meta);

    // 解析 JSON 陣列回應
    // 格式: [{uToken, streamAssistResponse: {answer: {replies: [...], state: "..."}}}, ...]
    let fullText = "";
    try {
      const parsed = JSON.parse(content);

      if (!Array.isArray(parsed)) {
        logger.error("配接器", "回應不是陣列格式", meta);
        return { error: "回應格式錯誤：不是陣列" };
      }

      for (const item of parsed) {
        const response = item?.streamAssistResponse;
        const answer = response?.answer;
        const state = answer?.state;

        // 如果是 SUCCEEDED 状态，跳過（只是告知会话结束）
        if (state === "SUCCEEDED") {
          continue;
        }

        // 只处理 IN_PROGRESS 状态
        if (state === "IN_PROGRESS") {
          const replies = answer?.replies;
          if (replies && replies.length > 0) {
            const groundedContent = replies[0]?.groundedContent?.content;

            // 如果是思考过程，跳過
            if (groundedContent?.thought === true) {
              continue;
            }

            // 提取文本内容
            const text = groundedContent?.text;
            if (text) {
              fullText += text;
            }
          }
        }
      }
    } catch (e) {
      logger.error("配接器", "解析回應失败", { ...meta, error: e.message });
      return { error: `解析回應失败: ${e.message}` };
    }

    if (fullText) {
      logger.info("配接器", `取得文本成功，长度: ${fullText.length}`, meta);
      return { text: fullText };
    } else {
      logger.warn("配接器", "未解析到有效文本内容", {
        ...meta,
        preview: content.substring(0, 200),
      });
      return { error: "未解析到有效文本内容" };
    }
  } catch (err) {
    // 顶层錯誤处理
    const pageError = normalizePageError(err, meta);
    if (pageError) return pageError;

    logger.error("配接器", "生成任务失败", { ...meta, error: err.message });
    return { error: `生成任务失败: ${err.message}` };
  } finally {
    // 清理拦截器
    await page.unroute("**/*").catch(() => {});
  }
}

/**
 * 配接器 manifest
 */
export const manifest = {
  id: "gemini_biz_text",
  displayName: "Gemini Business (文本生成)",
  description:
    "使用 Gemini Business 企业版生成文本，支援 Grounding 搜索模式。需要提供入口 URL 并已登录企业账户 (每个谷歌账户首次可以在官网點擊免费试用取得30天使用资格)，与 gemini_biz 共享配置。",

  // 配置表单定义（与 gemini_biz 共享配置）
  configSchema: [
    {
      key: "entryUrl",
      label: "入口 URL",
      type: "string",
      required: true,
      placeholder:
        "https://business.gemini.google/home/cid/8888a888-b6e0-88be-86e1-888cf3ee8cf4",
      note: "与 gemini_biz 共享配置",
    },
  ],

  // 入口 URL (从配置讀取，与 gemini_biz 共享)
  getTargetUrl(config, workerConfig) {
    return (
      config?.backend?.adapter?.gemini_biz?.entryUrl ||
      config?.backend?.geminiBiz?.entryUrl ||
      null
    );
  },

  // 模型列表
  models: [
    {
      id: "gemini-3-pro",
      codeName: "gemini-3-pro-preview",
      imagePolicy: "optional",
      type: "text",
    },
    {
      id: "gemini-2.5-pro",
      codeName: "gemini-2.5pro",
      imagePolicy: "optional",
      type: "text",
    },
    {
      id: "gemini-3-flash",
      codeName: "gemini-3-pro-preview",
      imagePolicy: "optional",
      type: "text",
    },
    {
      id: "gemini-2.5-flash",
      codeName: "gemini-2.5-flash",
      imagePolicy: "optional",
      type: "text",
    },
    {
      id: "gemini-3-pro-grounding",
      codeName: "gemini-3-pro-preview",
      imagePolicy: "optional",
      type: "text",
    },
    {
      id: "gemini-2.5-pro-grounding",
      codeName: "gemini-2.5-pro",
      imagePolicy: "optional",
      type: "text",
    },
    {
      id: "gemini-2.5-flash-grounding",
      codeName: "gemini-2.5-flash",
      imagePolicy: "optional",
      type: "text",
    },
    {
      id: "gemini-3-flash-grounding",
      codeName: "gemini-3-flash-preview",
      imagePolicy: "optional",
      type: "text",
    },
  ],

  // 导航处理器
  navigationHandlers: [handleAccountChooser],

  // 核心生图方法
  generate,
};
