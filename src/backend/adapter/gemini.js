/**
 * @fileoverview Google Gemini 圖片、视频生成配接器
 */

import {
  sleep,
  humanType,
  safeClick,
  uploadFilesViaChooser,
} from "../engine/utils.js";
import {
  normalizePageError,
  normalizeHttpError,
  waitForInput,
  gotoWithCheck,
  waitApiResponse,
  useContextDownload,
} from "../utils/index.js";
import { logger } from "../../utils/logger.js";

// --- 配置常量 ---
const TARGET_URL = "https://gemini.google.com/app?hl=en";

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
  const inputLocator = page.getByRole("textbox");
  const sendBtnLocator = page.getByRole("button", { name: "Send message" });

  try {
    logger.info("配接器", "开启新会话...", meta);
    await gotoWithCheck(page, TARGET_URL);

    const useTempChat =
      config?.backend?.adapter?.gemini?.temporaryChat || false;
    if (useTempChat) {
      try {
        logger.debug("配接器", "尝试點擊 Temporary chat...", meta);
        const tempChatBtn = page.getByRole("button", {
          name: "Temporary chat",
        });
        await safeClick(page, tempChatBtn, { bias: "button", timeout: 3000 });
      } catch (e) {
        logger.debug(
          "配接器",
          "未找到 Temporary chat 按钮或點擊失败，忽略",
          meta,
        );
      }
    }

    // 1. 等待輸入框載入
    await waitForInput(page, inputLocator, { click: false });
    await sleep(300, 500);

    // 2. 上傳圖片
    if (imgPaths && imgPaths.length > 0) {
      logger.info("配接器", `开始上傳 ${imgPaths.length} 张圖片...`, meta);
      logger.debug("配接器", "點擊加号按钮...", meta);
      const uploadMenuBtn = page.getByRole("button", {
        name: "Open upload file menu",
      });
      await safeClick(page, uploadMenuBtn, { bias: "button" });

      // 使用公共函式上傳檔案
      const uploadFilesBtn = page.getByRole("menuitem", {
        name: /Upload files/,
      });
      await uploadFilesViaChooser(
        page,
        uploadFilesBtn,
        imgPaths,
        {
          uploadValidator: (response) => {
            const url = response.url();
            return (
              response.status() === 200 &&
              url.includes("google.com/upload/") &&
              url.includes("upload_id=")
            );
          },
        },
        meta,
      );
      logger.info("配接器", "圖片上傳完成", meta);
    }

    // 3. 點擊 Tools 按钮啟用圖片/视频生成
    logger.debug("配接器", "點擊 Tools 按钮...", meta);
    const toolsBtn = page.getByRole("button", { name: "Tools" });
    await safeClick(page, toolsBtn, { bias: "button" });

    // 偵測是否是视频模型
    const isVideoModel = modelId && modelId.startsWith("veo-");

    // 5. 點擊 Create images / Create videos 按钮
    if (isVideoModel) {
      logger.debug("配接器", "點擊 Create video 按钮...", meta);
      const createVideosBtn = page.getByRole("menuitemcheckbox", {
        name: "Create video",
      });

      // 检查按钮是否存在（有些帳號可能没有视频生成功能）
      const btnCount = await createVideosBtn.count();
      if (btnCount === 0) {
        logger.error(
          "配接器",
          "未找到 Create videos 按钮，该帳號可能不支援视频生成",
          meta,
        );
        return { error: "该帳號不支援视频生成功能 (未找到 Create video 按钮)" };
      }

      await safeClick(page, createVideosBtn, { bias: "button" });
    } else {
      logger.debug("配接器", "點擊 Create image 按钮...", meta);
      const createImagesBtn = page.getByRole("menuitemcheckbox", {
        name: "Create image",
      });
      await safeClick(page, createImagesBtn, { bias: "button" });
    }

    // 4. 輸入提示詞
    logger.info("配接器", "輸入提示詞...", meta);
    await sleep(300, 500);
    await safeClick(page, inputLocator, { bias: "input" });
    await humanType(page, inputLocator, prompt);

    // 6. 先啟動 API 监听
    logger.debug("配接器", "啟動 API 监听...", meta);
    const streamApiResponsePromise = waitApiResponse(page, {
      urlMatch: "assistant.lamda.BardFrontendService/StreamGenerate",
      method: "POST",
      timeout: waitTimeout,
      meta,
    });

    // 7. 发送提示詞
    logger.info("配接器", "发送提示詞...", meta);
    await safeClick(page, sendBtnLocator, { bias: "button" });

    logger.info("配接器", "等待生成结果...", meta);

    // 8. 等待 StreamGenerate API
    let streamApiResponse;
    try {
      streamApiResponse = await streamApiResponsePromise;
    } catch (e) {
      const pageError = normalizePageError(e, meta);
      if (pageError) return pageError;
      throw e;
    }

    // 检查 HTTP 錯誤
    const httpError = normalizeHttpError(streamApiResponse);
    if (httpError) {
      logger.error("配接器", `API 回傳錯誤: ${httpError.error}`, meta);
      return { error: `API 回傳錯誤: ${httpError.error}` };
    }

    // 8. 等待圖片/视频回應
    if (isVideoModel) {
      // 视频模式：等待视频下載链接
      logger.info("配接器", "生成请求成功，等待视频...", meta);

      let videoResponse;
      try {
        videoResponse = await waitApiResponse(page, {
          urlMatch: "contribution.usercontent.google.com/download",
          urlContains: "filename=video.mp4",
          method: "GET",
          timeout: waitTimeout,
          meta,
        });
      } catch (e) {
        const pageError = normalizePageError(e, meta);
        if (pageError) return pageError;
        throw e;
      }

      // 取得视频数据
      const buffer = await videoResponse.body();
      const base64 = buffer.toString("base64");
      const contentType =
        videoResponse.headers()["content-type"] || "video/mp4";
      const videoData = `data:${contentType};base64,${base64}`;

      logger.info("配接器", "已取得视频，任务完成", meta);
      return { image: videoData };
    } else {
      // 圖片模式：直接从 StreamGenerate 回應体解析圖片 URL
      logger.info("配接器", "生成请求成功，正在解析回應...", meta);

      // 解析回應体，提取圖片 URL
      const bodyBuffer = await streamApiResponse.body();
      const imageUrls = extractImageUrlsFromResponse(bodyBuffer);

      if (imageUrls.length === 0) {
        // 没有找到圖片 URL，尝试提取文本作为錯誤資訊
        const errorText = extractAiTextFromResponse(bodyBuffer);
        const errorMsg =
          errorText.substring(0, 150) || "生成失败，回應中未包含圖片";
        logger.error("配接器", `未找到圖片: ${errorMsg}`, meta);
        return { error: errorMsg };
      }

      // 取第一张圖片，追加 =d-I 取得全尺寸原图（而非 =s1024-rj 的缩略图）
      const imageUrl = imageUrls[0] + "=d-I";
      logger.info(
        "配接器",
        `找到 ${imageUrls.length} 张圖片，开始下載...`,
        meta,
      );

      // 提取圖片生成的详细描述（thinking）
      const thinking = extractImageThinking(bodyBuffer);
      if (thinking) {
        logger.info("配接器", `提取到详细描述，长度: ${thinking.length}`, meta);
      }

      // 使用封装的下載函式
      const imgDlCfg = config?.backend?.pool?.failover || {};
      const result = await useContextDownload(imageUrl, page, {
        retries: imgDlCfg.imgDlRetry ? imgDlCfg.imgDlRetryMaxRetries || 2 : 0,
      });
      if (result.error) {
        logger.error("配接器", result.error, meta);
        return result;
      }

      logger.info("配接器", "已取得圖片，任务完成", meta);
      // 回傳圖片和 thinking（如果有）
      return thinking ? { ...result, reasoning: thinking } : result;
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
  id: "gemini",
  displayName: "Google Gemini (圖片、视频生成)",
  description:
    "使用 Google Gemini 官网生成圖片和视频，支援参考圖片上傳。需要已登录的 Google 账户，免费账户圖片生成有速率限制，视频生成必須为会员账户才可使用。",

  // 配置项模式
  configSchema: [
    {
      key: "temporaryChat",
      label: "临时对话",
      type: "boolean",
      default: false,
      note: "开启后将使用临时对话模式",
    },
  ],

  // 入口 URL
  getTargetUrl(config, workerConfig) {
    return TARGET_URL;
  },

  // 模型列表
  models: [
    { id: "gemini-3-pro-image-preview", imagePolicy: "optional" },
    { id: "veo-3.1-generate-preview", imagePolicy: "optional" },
  ],

  // 无需导航处理器
  navigationHandlers: [],

  // 核心生图方法
  generate,
};

// ==========================================
// 解析 gRPC Batchexecute 回應
// ==========================================

/**
 * 解析 batchexecute/batch RPC 回應（直接操作 Buffer）
 * @param {Buffer} buf - 回應体 Buffer
 */
function parseLenFramedResponse(buf) {
  let i = 0;

  // 去掉 )]}' 这种 XSSI 前缀（通常是第一行）
  if (
    buf.length >= 4 &&
    buf[0] === 0x29 &&
    buf[1] === 0x5d &&
    buf[2] === 0x7d
  ) {
    const firstNl = buf.indexOf(0x0a);
    if (firstNl !== -1) i = firstNl + 1;
  }

  const frames = [];

  const readLineBuf = () => {
    if (i >= buf.length) return null;
    const nl = buf.indexOf(0x0a, i);
    let line;
    if (nl === -1) {
      line = buf.slice(i);
      i = buf.length;
    } else {
      line = buf.slice(i, nl);
      i = nl + 1;
    }
    if (line.length && line[line.length - 1] === 0x0d) line = line.slice(0, -1);
    return line;
  };

  let pendingLen = null;

  while (true) {
    const lineBuf = readLineBuf();
    if (lineBuf === null) break;

    const lineStr = lineBuf.toString("utf8").trim();
    if (!lineStr) continue;

    if (pendingLen === null) {
      if (/^\d+$/.test(lineStr)) pendingLen = Number(lineStr);
      continue;
    }

    let chunkBuf = lineBuf;
    let chunkStr = chunkBuf.toString("utf8").trim();

    while (true) {
      try {
        frames.push(JSON.parse(chunkStr));
        break;
      } catch (e) {
        const msg = String((e && e.message) || "");
        const looksTruncated =
          /Unexpected end of JSON input|Unterminated string/.test(msg);

        if (!looksTruncated) break;

        const savedPos = i;
        const next = readLineBuf();
        if (next === null) break;

        const nextStr = next.toString("utf8").trim();
        if (/^\d+$/.test(nextStr)) {
          i = savedPos;
          break;
        }

        chunkBuf = Buffer.concat([chunkBuf, Buffer.from("\n"), next]);
        chunkStr = chunkBuf.toString("utf8").trim();
      }
    }

    pendingLen = null;
  }

  return frames;
}

/**
 * 把 frame 里的 payload 再 parse 一次
 */
function extractPayloads(frames) {
  const payloads = [];
  for (const frame of frames) {
    if (!Array.isArray(frame)) continue;

    for (const item of frame) {
      if (!Array.isArray(item)) continue;
      const payloadStr = item[2];
      if (typeof payloadStr !== "string") continue;

      try {
        payloads.push(JSON.parse(payloadStr));
      } catch {
        // ignore
      }
    }
  }
  return payloads;
}

/**
 * 深度遍历，查找 googleusercontent.com/gg-dl 开头的圖片 URL
 * @param {any} root - 要遍历的物件
 * @returns {string[]} 圖片 URL 陣列
 */
function collectImageUrlsDeep(root) {
  const urls = [];
  const stack = [root];

  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;

    if (typeof cur === "string") {
      // 匹配 googleusercontent.com/gg-dl 圖片 URL
      if (cur.includes("googleusercontent.com/gg-dl")) {
        urls.push(cur);
      }
    } else if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
    } else if (typeof cur === "object") {
      for (const v of Object.values(cur)) stack.push(v);
    }
  }

  return urls;
}

/**
 * 深度遍历，查找 rc_ 开头的文本内容
 */
function collectRcTextsDeep(root) {
  const bestByRc = new Map();
  const stack = [root];

  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;

    if (Array.isArray(cur)) {
      const maybeRc = cur[0];
      const maybeArr = cur[1];
      if (
        typeof maybeRc === "string" &&
        maybeRc.startsWith("rc_") &&
        Array.isArray(maybeArr)
      ) {
        const text = maybeArr.filter((v) => typeof v === "string").join("");
        if (text) {
          const prev = bestByRc.get(maybeRc) || "";
          if (text.length >= prev.length) bestByRc.set(maybeRc, text);
        }
      }
      for (const v of cur) stack.push(v);
    } else if (typeof cur === "object") {
      for (const v of Object.values(cur)) stack.push(v);
    }
  }

  return bestByRc;
}

/**
 * 从回應体 Buffer 中提取圖片 URL
 * @param {Buffer} bodyBuffer - 回應体 Buffer
 * @returns {string[]} 圖片 URL 陣列
 */
function extractImageUrlsFromResponse(bodyBuffer) {
  const frames = parseLenFramedResponse(bodyBuffer);
  const payloads = extractPayloads(frames);

  const allUrls = [];
  for (const payload of payloads) {
    const urls = collectImageUrlsDeep(payload);
    allUrls.push(...urls);
  }

  // 去重
  return [...new Set(allUrls)];
}

/**
 * 从回應体 Buffer 中提取 AI 文本（用于錯誤提示）
 * @param {Buffer} bodyBuffer - 回應体 Buffer
 * @returns {string}
 */
function extractAiTextFromResponse(bodyBuffer) {
  const frames = parseLenFramedResponse(bodyBuffer);
  const payloads = extractPayloads(frames);

  let best = "";
  for (const payload of payloads) {
    const m = collectRcTextsDeep(payload);
    for (const text of m.values()) {
      if (text.length > best.length) best = text;
    }
  }
  return best;
}

/**
 * 深度遍历，查找长文本描述（圖片生成的 thinking/详细描述）
 * 排除 URL、base64、分类器名称等非描述性长字串
 * @param {any} root - 要遍历的物件
 * @returns {string} 最长的描述文本，未找到则回傳空字串
 */
function findLongDescriptionDeep(root) {
  const candidates = [];
  const stack = [root];

  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;

    if (typeof cur === "string") {
      if (
        cur.length > 200 &&
        !cur.startsWith("http") &&
        !cur.startsWith("data:") &&
        !cur.includes("googleapis.com") &&
        !cur.includes("googleusercontent.com") &&
        !/^[A-Za-z0-9+/=]{100,}$/.test(cur)
      ) {
        candidates.push(cur);
      }
    } else if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
    } else if (typeof cur === "object") {
      for (const v of Object.values(cur)) stack.push(v);
    }
  }

  if (candidates.length === 0) return "";
  return candidates.reduce((a, b) => (a.length >= b.length ? a : b), "");
}

/**
 * 从回應体 Buffer 中提取圖片生成的详细描述（thinking）
 * @param {Buffer} bodyBuffer - 回應体 Buffer
 * @returns {string} 详细描述文本，未找到则回傳空字串
 */
function extractImageThinking(bodyBuffer) {
  const frames = parseLenFramedResponse(bodyBuffer);
  const payloads = extractPayloads(frames);

  let best = "";
  for (const payload of payloads) {
    const text = findLongDescriptionDeep(payload);
    if (text.length > best.length) {
      best = text;
    }
  }
  return best;
}
