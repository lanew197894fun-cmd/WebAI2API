/**
 * @fileoverview 瀏覽器啟動与生命周期管理
 * @description 负责啟動 Camoufox（Playwright 内核）、注入指纹与代理，并在进程退出时做資源清理。
 *              导航和预热行为由工作池负责，本模組只负责啟動瀏覽器。
 *
 * 约定：
 * - 登录模式会尽量保留 Profile（用戶数据目錄）
 * - 清理采用三级退出：Playwright close -> SIGTERM -> SIGKILL
 */

import { Camoufox } from "camoufox-js";
import { sampleWebGL } from "camoufox-js/dist/webgl/sample.js";
import { FingerprintGenerator } from "fingerprint-generator";
import fs from "fs";
import path from "path";
import os from "os";
import { createCursor } from "ghost-cursor-playwright-port";
import { getRealViewport, clamp, random, sleep } from "./utils.js";
import { logger } from "../../utils/logger.js";
import { getBrowserProxy, cleanupProxy } from "../../utils/proxy.js";

// 全局状态：用于在登录模式下管理残留进程与复用上下文
let globalBrowserProcess = null;
let globalContext = null; // 替代 globalBrowser

/**
 * 清理瀏覽器資源和進程
 * 實現三级退出机制: Playwright close -> SIGTERM -> SIGKILL
 * @returns {Promise<void>}
 */
export async function cleanup() {
  // Level 1: 通过 Playwright 协议优雅關閉 Context，儲存 Profile
  if (globalContext) {
    try {
      logger.debug("瀏覽器", "正在断开远程调试連接并儲存 Profile...");
      await globalContext.close();
      globalContext = null;
      logger.debug("瀏覽器", "已關閉瀏覽器上下文");
    } catch (e) {
      logger.warn("瀏覽器", `關閉上下文失败: ${e.message}`);
    }
  }

  // Level 2 & 3: 处理残留进程 (主要用于登录模式)
  if (globalBrowserProcess && !globalBrowserProcess.killed) {
    logger.info("瀏覽器", "正在终止瀏覽器进程...");
    try {
      // Level 2: 发送 SIGTERM (软杀)
      globalBrowserProcess.kill("SIGTERM");

      // 等待进程退出
      const start = Date.now();
      while (Date.now() - start < 2000) {
        try {
          process.kill(globalBrowserProcess.pid, 0);
          await new Promise((r) => setTimeout(r, 200));
        } catch (e) {
          break;
        }
      }
    } catch (e) {}

    // Level 3: 强制查杀 (SIGKILL)
    try {
      process.kill(globalBrowserProcess.pid, 0);
      logger.debug("瀏覽器", "瀏覽器进程无回應，執行强制终止 (SIGKILL)...");
      process.kill(-globalBrowserProcess.pid, "SIGKILL");
    } catch (e) {}

    globalBrowserProcess = null;
    logger.info("瀏覽器", "瀏覽器进程已终止");
  }

  // 清理代理
  await cleanupProxy();
}

// 防止重复註冊
let signalHandlersRegistered = false;

/**
 * 註冊进程退出信号处理
 * @private
 */
function registerCleanupHandlers() {
  if (signalHandlersRegistered) return;

  process.on("exit", () => {
    if (globalBrowserProcess) globalBrowserProcess.kill();
  });

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit();
  });

  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit();
  });

  signalHandlersRegistered = true;
}

/**
 * 取得当前操作系统名称
 * 将 Node.js 的 platform 转换为 Camoufox/FingerprintGenerator 支援的格式
 */
function getCurrentOS() {
  const platform = os.platform();
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  // 其他情况預設为 linux
  return "linux";
}

/**
 * 取得 WebGL 平台标识
 * 将操作系统名称转换为 sampleWebGL 支援的格式
 */
function getWebGLPlatform(osName) {
  if (osName === "windows") return "win";
  if (osName === "macos") return "mac";
  return "lin";
}

/**
 * 取得或生成持久化指纹 (含 WebGL 配置校验)
 * @param {string} filePath - JSON檔案儲存路徑
 */
async function getPersistentFingerprint(filePath) {
  // 确保 data 目錄存在
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let fingerprintData = null;
  let webglPair = null;
  let shouldSave = false;
  const currentOS = getCurrentOS();
  const targetWebGLOS = getWebGLPlatform(currentOS);

  // 1. 尝试讀取现有指纹
  if (fs.existsSync(filePath)) {
    try {
      const fileContent = fs.readFileSync(filePath, "utf8");
      fingerprintData = JSON.parse(fileContent);
    } catch (e) {
      logger.warn("瀏覽器", `指纹檔案损坏: ${e.message}`);
    }
  }

  // 2. 校验 WebGL 配置的有效性 (从 videoCard 讀取)
  if (
    fingerprintData?.videoCard?.["webGl:vendor"] &&
    fingerprintData?.videoCard?.["webGl:renderer"]
  ) {
    const savedVendor = fingerprintData.videoCard["webGl:vendor"];
    const savedRenderer = fingerprintData.videoCard["webGl:renderer"];
    try {
      // 拿着儲存的配置，去数据库里"试探"一下是否存在
      await sampleWebGL(targetWebGLOS, savedVendor, savedRenderer);

      // 如果没报错，说明配置有效，保留使用
      webglPair = [savedVendor, savedRenderer];
      logger.debug("瀏覽器", `載入 WebGL 配置成功: ${savedRenderer}`);
    } catch (e) {
      // 数据库里没找到 -> 配置失效
      logger.warn(
        "瀏覽器",
        `儲存的 WebGL 配置与当前系统(${targetWebGLOS})不匹配，将重新生成`,
      );
      webglPair = null;
      shouldSave = true;
    }
  }

  // 3. 如果指纹完全不存在，生成新的基础指纹
  if (!fingerprintData) {
    logger.info("瀏覽器", `正在为系统 [${currentOS}] 生成新指纹...`);
    const generatorOptions = {
      browsers: ["firefox"],
      operatingSystems: [currentOS],
      devices: ["desktop"],
      locales: ["en-US"],
      screen: {
        minWidth: 1280,
        maxWidth: 1366,
        minHeight: 720,
        maxHeight: 768,
      },
    };
    const generator = new FingerprintGenerator(generatorOptions);
    fingerprintData = generator.getFingerprint().fingerprint;

    // 清洗 UA 版本
    if (fingerprintData.navigator) {
      let ua = fingerprintData.navigator.userAgent;
      const TARGET_VERSION = "135.0";
      ua = ua.replace(/rv:[\d\.]+/g, `rv:${TARGET_VERSION}`);
      ua = ua.replace(/Firefox\/[\d\.]+/g, `Firefox/${TARGET_VERSION}`);
      fingerprintData.navigator.userAgent = ua;
    }

    // 清洗插件数据
    if (fingerprintData.pluginsData) {
      fingerprintData.pluginsData.plugins = [];
      fingerprintData.pluginsData.mimeTypes = [];
    }

    shouldSave = true;
  }

  // 4. 如果 WebGL 配置为空，重新生成
  if (!webglPair) {
    try {
      logger.info("瀏覽器", `正在生成新的 WebGL 配置 (${targetWebGLOS})...`);
      const webglData = await sampleWebGL(targetWebGLOS);
      webglPair = [webglData["webGl:vendor"], webglData["webGl:renderer"]];

      // 覆盖 videoCard
      fingerprintData.videoCard = {
        "webGl:vendor": webglPair[0],
        "webGl:renderer": webglPair[1],
      };

      shouldSave = true;
    } catch (e) {
      logger.error("瀏覽器", `致命錯誤：无法生成 WebGL 配置: ${e.message}`);
    }
  }

  // 5. 如果 Canvas 噪点不存在，生成新的
  if (fingerprintData.canvasOffset === undefined) {
    const offset = Math.floor(Math.random() * 41) - 20;
    fingerprintData.canvasOffset = offset;
    logger.info("瀏覽器", `已生成 Canvas 噪点偏移: ${offset}`);
    shouldSave = true;
  }

  // 5. 如果有变动，儲存回檔案
  if (shouldSave) {
    fs.writeFileSync(filePath, JSON.stringify(fingerprintData, null, 2));
    logger.info("瀏覽器", `指纹已更新并儲存至: ${filePath}`);
  }

  return fingerprintData;
}

/**
 * 啟動瀏覽器实例 (仅负责啟動，不负责导航和预热)
 *
 * 导航到目标页面、註冊导航处理器、预热行为由工作池 (pool.js) 负责。
 *
 * @param {object} config - 全局配置物件
 * @param {object} options - 啟動选项
 * @param {string} options.userDataDir - 用戶数据目錄路徑
 * @param {string} [options.userDataMark] - 用戶数据目錄标识 (用于日誌显示)
 * @param {object} [options.proxyConfig] - Worker 级代理配置
 * @returns {Promise<{context: object, page: object}>} 瀏覽器上下文和初始页面
 */
export async function initBrowserBase(config, options = {}) {
  const { userDataDir, instanceName = null, proxyConfig = null } = options;

  // 日誌标识 (优先使用实例名称)
  const markLabel = instanceName || "預設";

  // 偵測登录模式和 Xvfb 模式
  const isLoginMode = process.argv.some((arg) => arg.startsWith("-login"));
  const isXvfbMode = process.env.XVFB_RUNNING === "true";
  const headlessMode = config?.browser?.headless && !isLoginMode && !isXvfbMode;

  // 如果配置了无头模式但被强制停用，輸出原因
  if (config?.browser?.headless && !headlessMode) {
    const reasons = [];
    if (isLoginMode) reasons.push("登录模式");
    if (isXvfbMode) reasons.push("Xvfb 模式");
    logger.info(
      "瀏覽器",
      `[${markLabel}] 无头模式已被停用 (${reasons.join(" + ")})`,
    );
  }

  logger.info("瀏覽器", `[${markLabel}] 啟動瀏覽器实例...`);

  const browserConfig = config?.browser || {};

  // 取得指纹物件（指纹檔案放在对应的 userDataDir 内）
  const fingerprintPath = path.join(userDataDir, "fingerprint.json");
  const myFingerprint = await getPersistentFingerprint(fingerprintPath);

  // 构造 Camoufox 啟動选项
  const currentOS = getCurrentOS();
  const camoufoxLaunchOptions = {
    executable_path: browserConfig.path || undefined,
    headless: headlessMode,
    user_data_dir: userDataDir,
    ff_version: 135,
    fingerprint: myFingerprint,
    os: currentOS,
    i_know_what_im_doing: true,
    webgl_config: myFingerprint.videoCard
      ? [
          myFingerprint.videoCard["webGl:vendor"],
          myFingerprint.videoCard["webGl:renderer"],
        ]
      : undefined,
    block_webrtc: true,
    exclude_addons: ["UBO"],
    geoip: true,
    humanize: browserConfig.humanizeCursor === "camou",
    config: {
      forceScopeAccess: true,
      // Canvas 抗指纹：注入固定噪点偏移
      "canvas:aaOffset": myFingerprint.canvasOffset ?? 0,
      "canvas:aaCapOffset": true,
    },
    // 關閉动画減輕資源壓力
    firefox_user_prefs: {
      // 停用背景模糊滤镜 (高 CPU 消耗)
      "layout.css.backdrop-filter.enabled": false,
      // 告诉网页用戶倾向于减少动画 (触发网页自身的优化)
      "ui.prefersReducedMotion": 1,
      // 站点隔离
      ...(browserConfig.fission === false
        ? { "fission.autostart": false }
        : {}),
    },
  };

  // 代理配置
  const proxyObj = await getBrowserProxy(proxyConfig);
  if (proxyObj) {
    camoufoxLaunchOptions.proxy = proxyObj;
  }

  // 啟動 Camoufox
  const context = await Camoufox(camoufoxLaunchOptions);
  globalContext = context;

  // 构建状态描述
  const statusParts = [];
  statusParts.push(`无头模式: ${headlessMode ? "是" : "否"}`);
  if (proxyObj) statusParts.push("代理: 已配置");
  logger.info(
    "瀏覽器",
    `[${markLabel}] 瀏覽器已啟動 (${statusParts.join(", ")})`,
  );

  // 註冊清理处理器
  registerCleanupHandlers();

  // 註冊断开連接事件（不再自动退出进程，由 Worker 决定后续行为）
  context.on("close", async () => {
    logger.warn("瀏覽器", `[${markLabel}] 瀏覽器已断开連接`);
    // 清理全局状态，但不退出进程
    globalContext = null;
    globalBrowserProcess = null;
  });

  // 取得或建立 Page
  let page;
  const existingPages = context.pages();
  if (existingPages.length > 0) {
    page = existingPages[0];
  } else {
    page = await context.newPage();
  }

  // 强制刷新视口大小 (使用指纹中的屏幕尺寸)
  const screenWidth = myFingerprint.screen?.availWidth || 1366;
  const screenHeight = myFingerprint.screen?.availHeight || 768;
  await page.setViewportSize({ width: screenWidth, height: screenHeight });

  // CSS 性能优化注入
  const cssInjectConfig = browserConfig.cssInject || {};
  const cssToInject = [];

  if (cssInjectConfig.animation) {
    cssToInject.push(`
            *, *::before, *::after {
                /* 过渡和关键帧动画 */
                transition: none !important;
                animation: none !important;
                transition-property: none !important;
                
                /* 平滑滾動 */
                scroll-behavior: auto !important;
            }
            
            /* transform 动画 */
            *:not(dummy-selector) {
                transition-duration: 0s !important;
                animation-duration: 0s !important;
                transition-delay: 0s !important;
                animation-delay: 0s !important;
            }
        `);
  }

  if (cssInjectConfig.filter) {
    cssToInject.push(`
            *, *::before, *::after {
                filter: none !important;
                backdrop-filter: none !important;
                box-shadow: none !important;
                text-shadow: none !important;
                mix-blend-mode: normal !important;
            }
        `);
  }

  if (cssInjectConfig.font) {
    cssToInject.push(`
            html, body {
                text-rendering: optimizeSpeed !important;
            }
        `);
  }

  // 只有当至少一个开关啟用时才进行注入，防止影响瀏覽器指纹
  if (cssToInject.length > 0) {
    const cssString = cssToInject.join("\n");
    await context.addInitScript(`
            (function() {
                const style = document.createElement('style');
                style.textContent = ${JSON.stringify(cssString)};
                if (document.head) {
                    document.head.appendChild(style);
                } else {
                    document.addEventListener('DOMContentLoaded', () => {
                        document.head.appendChild(style);
                    });
                }
            })();
        `);
    const enabledFeatures = [];
    if (cssInjectConfig.animation) enabledFeatures.push("动画停用");
    if (cssInjectConfig.filter) enabledFeatures.push("滤镜停用");
    if (cssInjectConfig.font) enabledFeatures.push("字体优化");
    logger.info(
      "瀏覽器",
      `[${markLabel}] CSS 注入已啟用: ${enabledFeatures.join(", ")}`,
    );
  }

  // 回傳 context 和 page（导航、预热、cursor 初始化由工作池负责）
  return {
    context,
    page,
  };
}

// 导出工具函式供 pool.js 使用
export { createCursor, getRealViewport, clamp, random, sleep };
