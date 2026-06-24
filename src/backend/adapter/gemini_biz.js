/**
 * @fileoverview Gemini Business 文本生成配接器
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
  scrollToElement,
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

    // 4. 設定拦截器
    logger.debug("配接器", "已啟用请求拦截", meta);
    await page.unroute("**/*").catch(() => {});

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

            // 根据模型 ID 选择 toolsSpec
            if (modelId && modelId.startsWith("veo-")) {
              postData.streamAssistRequest.toolsSpec = {
                videoGenerationSpec: {},
              };
              logger.info("配接器", "已拦截请求，使用视频生成规格", meta);
            } else {
              postData.streamAssistRequest.toolsSpec = {
                imageGenerationSpec: {},
              };
              logger.info("配接器", "已拦截请求，使用圖片生成规格", meta);
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

    // 7. 等待圖片下載回應
    logger.info("配接器", "已取得结果，正在下載圖片...", meta);

    let imageResponse;
    try {
      // 先啟動监听器，再滾動触发懒載入，避免错过请求
      const imageResponsePromise = waitApiResponse(page, {
        urlMatch: "download/v1alpha/projects",
        method: "GET",
        timeout: waitTimeout,
        errorText: ["is unable to reply as the prompt"],
        meta,
      });

      // 等待圖片元素出现并滾動到可视範圍，触发懒載入
      await scrollToElement(page, "ucs-markdown-image", { timeout: 20000 });

      imageResponse = await imageResponsePromise;
    } catch (e) {
      const pageError = normalizePageError(e, meta);
      if (pageError) {
        if (e.name === "TimeoutError") {
          return { error: "已取得结果, 但圖片下載时逾時 (120秒)" };
        }
        return pageError;
      }
      throw e;
    }

    const base64 = await imageResponse.text();

    // 从回應头取得内容類型
    const contentType =
      imageResponse.headers()["x-goog-safety-content-type"] || "image/png";
    logger.info("配接器", `已下載内容，類型: ${contentType}`, meta);

    const dataUri = `data:${contentType};base64,${base64}`;
    return { image: dataUri };
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
  id: "gemini_biz",
  displayName: "Gemini Business (圖片、视频生成)",
  description:
    "使用 Gemini Business 企业版生成圖片和视频。需要提供入口 URL 并已登录企业账户 (每个谷歌账户首次可以在官网點擊免费试用取得30天使用资格)。",

  // 配置表单定义
  configSchema: [
    {
      key: "entryUrl",
      label: "入口 URL",
      type: "string",
      required: true,
      placeholder:
        "https://business.gemini.google/home/cid/8888a888-b6e0-88be-86e1-888cf3ee8cf4",
    },
  ],

  // 入口 URL (从配置讀取，支援新旧路徑)
  getTargetUrl(config, workerConfig) {
    return (
      config?.backend?.adapter?.gemini_biz?.entryUrl ||
      config?.backend?.geminiBiz?.entryUrl ||
      null
    );
  },

  // 模型列表
  models: [
    { id: "gemini-3-pro-image-preview", imagePolicy: "optional" },
    { id: "veo-3.1-generate-preview", imagePolicy: "optional" },
  ],

  // 导航处理器
  navigationHandlers: [handleAccountChooser],

  // 核心生图方法
  generate,
};
