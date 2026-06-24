/**
 * @fileoverview Google Flow 圖片生成配接器
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
import sharp from "sharp";

// --- 配置常量 ---
const TARGET_URL = "https://labs.google/fx/zh/tools/flow";

/**
 * 根据圖片路徑偵測其宽高比，回傳 '16:9' 或 '9:16'
 * @param {string} imgPath - 圖片路徑
 * @returns {Promise<string>} 尺寸比例
 */
async function detectImageAspect(imgPath) {
  try {
    const metadata = await sharp(imgPath).metadata();
    const { width, height } = metadata;
    // 宽 >= 高 为横版，否则为竖版
    return width >= height ? "16:9" : "9:16";
  } catch (e) {
    // 偵測失败預設横版
    return "16:9";
  }
}

/**
 * 執行圖片生成任务
 * @param {object} context - 瀏覽器上下文 { page, config }
 * @param {string} prompt - 提示詞
 * @param {string[]} imgPaths - 圖片路徑陣列
 * @param {string} modelId - 模型 ID
 * @param {object} [meta={}] - 日誌元数据
 * @returns {Promise<{image?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
  const { page, config } = context;
  const waitTimeout = config?.backend?.pool?.waitTimeout ?? 120000;

  // 取得模型配置
  const modelConfig =
    manifest.models.find((m) => m.id === modelId) || manifest.models[0];
  let { codeName, imageSize } = modelConfig;

  // 如果 imageSize 为 '0'，根据第一张圖片动态决定尺寸
  if (imageSize === "0" && imgPaths && imgPaths.length > 0) {
    imageSize = await detectImageAspect(imgPaths[0]);
    logger.info("配接器", `根据圖片偵測尺寸: ${imageSize}`, meta);
  } else if (imageSize === "0") {
    // 没有圖片时預設横版
    imageSize = "16:9";
  }

  try {
    // 1. 导航到入口页面
    logger.info("配接器", "开启新会话...", meta);
    await gotoWithCheck(page, TARGET_URL);

    // 2. 建立项目
    logger.debug("配接器", "建立新项目...", meta);
    const addProjectBtn = page.getByRole("button", { name: /^add_2/ });
    await addProjectBtn.waitFor({ state: "visible", timeout: 30000 });
    await safeClick(page, addProjectBtn, { bias: "button" });

    // 3. 选择 Images 模式 (通过 combobox + option 选择)
    logger.debug("配接器", "选择圖片制作模式...", meta);
    const modeCombo = page.getByRole("combobox").filter({
      has: page.locator("i", { hasText: "arrow_drop_down" }),
    });
    await modeCombo.first().waitFor({ state: "visible", timeout: 30000 });
    await safeClick(page, modeCombo.first(), { bias: "button" });

    const imageOption = page.getByRole("option").filter({
      has: page.locator("i", { hasText: "add_photo_alternate" }),
    });
    await safeClick(page, imageOption.first(), { bias: "button" });

    // 4. 打开 Tune 菜单进行配置
    logger.debug("配接器", "打开設定菜单...", meta);
    const tuneBtn = page.getByRole("button", { name: /^tune/ });
    await tuneBtn.waitFor({ state: "visible", timeout: 30000 });
    await safeClick(page, tuneBtn, { bias: "button" });
    await sleep(300, 500);

    // 4.1 設定生成数量为 1 (链式 filter：包含数字1-4，排除模型和尺寸关键词)
    logger.debug("配接器", "設定生成数量为 1...", meta);
    const countCombobox = page
      .getByRole("combobox")
      .filter({ hasText: /[1-4]/ })
      .filter({ hasNotText: /Banana|Imagen/i })
      .filter({ hasNotText: /16:9|9:16|1:1|4:3|3:4/ });

    if ((await countCombobox.count()) > 0) {
      await safeClick(page, countCombobox.first(), { bias: "button" });
      await sleep(300, 500);
      await safeClick(page, page.getByRole("option", { name: "1" }), {
        bias: "button",
      });
      logger.debug("配接器", "生成数量已設定为 1", meta);
    } else {
      logger.warn("配接器", "未找到数量选择 combobox，跳過", meta);
    }

    // 4.2 选择模型 (查找包含模型名称的 combobox)
    logger.debug("配接器", `选择模型: ${codeName}...`, meta);
    const modelCombobox = page
      .getByRole("combobox")
      .filter({ hasText: /Nano Banana|Imagen 4/ });

    if ((await modelCombobox.count()) > 0) {
      await safeClick(page, modelCombobox.first(), { bias: "button" });
      await sleep(300, 500);
      await safeClick(
        page,
        page.getByRole("option", { name: codeName, exact: true }),
        { bias: "button" },
      );
      logger.debug("配接器", `模型已設定为 ${codeName}`, meta);
    }

    // 4.3 选择横竖版 (查找包含比例的 combobox)
    logger.debug("配接器", `选择尺寸: ${imageSize}...`, meta);
    const sizeCombobox = page
      .getByRole("combobox")
      .filter({ hasText: /16:9|9:16/ });

    if ((await sizeCombobox.count()) > 0) {
      await safeClick(page, sizeCombobox.first(), { bias: "button" });
      await sleep(300, 500);
      const sizeOption = page
        .getByRole("option")
        .filter({ hasText: imageSize });
      await safeClick(page, sizeOption.first(), { bias: "button" });
      logger.debug("配接器", `尺寸已設定为 ${imageSize}`, meta);
    }

    // 5. 上傳圖片 (如果有)
    if (imgPaths && imgPaths.length > 0) {
      logger.info("配接器", `开始上傳 ${imgPaths.length} 张圖片...`, meta);

      for (let i = 0; i < imgPaths.length; i++) {
        const imgPath = imgPaths[i];
        logger.debug("配接器", `上傳圖片 ${i + 1}/${imgPaths.length}...`, meta);

        // 5.1 點擊 add 按钮
        await sleep(300, 500);
        const addBtn = page.getByRole("button", { name: "add" });
        await addBtn.waitFor({ state: "visible", timeout: 30000 });
        await safeClick(page, addBtn, { bias: "button" });

        // 5.1.1 清理已有圖片，只保留上傳按钮，并调整弹出框样式
        await page.evaluate(() => {
          const grid = document.querySelector('[class*="virtuoso-grid-list"]');
          if (grid) {
            const children = Array.from(grid.children);
            children.slice(1).forEach((child) => child.remove());
          }
          const popper = document.querySelector(
            "[data-radix-popper-content-wrapper]",
          );
          if (popper) {
            popper.style.height = "335px";
            popper.style.transform = "translate(0px, -391px)";
          }
        });

        // 5.2 點擊 upload 按钮并选择檔案（不等待上傳完成）
        const uploadBtn = page.getByRole("button", { name: /^upload/ });
        await uploadFilesViaChooser(page, uploadBtn, [imgPath], {}, meta);

        // 5.3 先啟動上傳监听，再點擊 crop 按钮
        const uploadResponsePromise = waitApiResponse(page, {
          urlMatch: "v1:uploadUserImage",
          method: "POST",
          timeout: 60000,
        });

        const cropBtn = page.getByRole("button", { name: /^crop/ });
        await cropBtn.waitFor({ state: "visible", timeout: 30000 });
        await safeClick(page, cropBtn, { bias: "button" });

        // 5.4 等待上傳完成
        await uploadResponsePromise;
        logger.info("配接器", `圖片 ${i + 1} 上傳完成`, meta);
      }

      logger.info("配接器", "圖片上傳完成", meta);
    }

    // 6. 輸入提示詞
    logger.info("配接器", "輸入提示詞...", meta);
    const textarea = page.locator("textarea[placeholder]");
    await waitForInput(page, textarea, { click: true });
    await humanType(page, textarea, prompt);

    // 7. 先啟動 API 监听，再點擊发送
    logger.debug("配接器", "啟動 API 监听...", meta);
    const apiResponsePromise = waitApiResponse(page, {
      urlMatch: "flowMedia:batchGenerateImages",
      method: "POST",
      timeout: waitTimeout,
      meta,
    });

    // 8. 发送提示詞
    logger.info("配接器", "发送提示詞...", meta);
    const sendBtn = page.getByRole("button", { name: /^arrow_forward/ });
    await sendBtn.waitFor({ state: "visible", timeout: 30000 });
    await safeClick(page, sendBtn, { bias: "button" });

    // 9. 等待 API 回應
    logger.info("配接器", "等待生成结果...", meta);
    const apiResponse = await apiResponsePromise;

    // 10. 解析回應取得圖片 URL
    let imageUrl;
    try {
      const responseBody = await apiResponse.json();
      imageUrl = responseBody?.media?.[0]?.image?.generatedImage?.fifeUrl;

      if (!imageUrl) {
        logger.error("配接器", "回應中没有圖片 URL", meta);
        return { error: "生成成功但回應中没有圖片 URL" };
      }

      logger.info("配接器", "已取得圖片链接", meta);
    } catch (e) {
      logger.error("配接器", "解析回應失败", { ...meta, error: e.message });
      return { error: `解析回應失败: ${e.message}` };
    }

    // 11. 下載圖片并转为 base64
    logger.info("配接器", "正在下載圖片...", meta);
    const imgDlCfg = config?.backend?.pool?.failover || {};
    const downloadResult = await useContextDownload(imageUrl, page, {
      retries: imgDlCfg.imgDlRetry ? imgDlCfg.imgDlRetryMaxRetries || 2 : 0,
    });

    if (downloadResult.error) {
      logger.error("配接器", downloadResult.error, meta);
      return downloadResult;
    }

    logger.info("配接器", "圖片生成完成", meta);
    return { image: downloadResult.image };
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
  id: "google_flow",
  displayName: "Google Flow (圖片生成)",
  description:
    "使用 Google Labs Flow 工具生成圖片，支援多张参考圖片上傳和横竖版选择。需要已登录的 Google 账户。",

  // 入口 URL
  getTargetUrl(config, workerConfig) {
    return TARGET_URL;
  },

  // 模型列表
  models: [
    // 根据上傳的第一张圖片动态取得圖片比例
    {
      id: "gemini-3-pro-image-preview",
      codeName: "🍌 Nano Banana Pro",
      imageSize: "0",
      imagePolicy: "optional",
    },
    {
      id: "gemini-2.5-flash-image-preview",
      codeName: "🍌 Nano Banana",
      imageSize: "0",
      imagePolicy: "optional",
    },
    {
      id: "imagen-4",
      codeName: "Imagen 4",
      imageSize: "0",
      imagePolicy: "optional",
    },
    // 指定圖片比例
    {
      id: "gemini-3-pro-image-preview-landspace",
      codeName: "🍌 Nano Banana Pro",
      imageSize: "16:9",
      imagePolicy: "optional",
    },
    {
      id: "gemini-3-pro-image-preview-portrait",
      codeName: "🍌 Nano Banana Pro",
      imageSize: "9:16",
      imagePolicy: "optional",
    },
    {
      id: "gemini-2.5-flash-image-preview-landspace",
      codeName: "🍌 Nano Banana",
      imageSize: "16:9",
      imagePolicy: "optional",
    },
    {
      id: "gemini-2.5-flash-image-preview-portrait",
      codeName: "🍌 Nano Banana",
      imageSize: "9:16",
      imagePolicy: "optional",
    },
    {
      id: "imagen-4-landspace",
      codeName: "Imagen 4",
      imageSize: "16:9",
      imagePolicy: "optional",
    },
    {
      id: "imagen-4-portrait",
      codeName: "Imagen 4",
      imageSize: "9:16",
      imagePolicy: "optional",
    },
  ],

  // 无需导航处理器
  navigationHandlers: [],

  // 核心圖片生成方法
  generate,
};
