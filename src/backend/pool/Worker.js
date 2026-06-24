/**
 * @fileoverview Worker 类
 * @description 封装单个瀏覽器实例，提供模型匹配和任务執行能力
 */

import fs from "fs";
import { logger } from "../../utils/logger.js";
import { initBrowserBase, createCursor } from "../engine/launcher.js";
import { registry } from "../registry.js";
import { tryGotoWithCheck } from "../utils/page.js";

/**
 * Worker 类 - 封装单个瀏覽器实例
 */
export class Worker {
  /**
   * @param {object} globalConfig - 全局配置
   * @param {object} workerConfig - Worker 配置
   */
  constructor(globalConfig, workerConfig) {
    this.name = workerConfig.name;
    this.type = workerConfig.type;
    this.instanceName = workerConfig.instanceName || null;
    this.userDataDir = workerConfig.userDataDir;
    this.proxyConfig = workerConfig.resolvedProxy;
    this.globalConfig = globalConfig;
    this.workerConfig = workerConfig;

    // Merge 模式专属
    this.mergeTypes = workerConfig.mergeTypes || [];
    this.mergeMonitor = workerConfig.mergeMonitor || null;

    // 執行時狀態
    this.browser = null;
    this.page = null;
    this.busyCount = 0;
    this.initialized = false;

    // 瀏覽器所有权（用于共享瀏覽器场景的协调重启）
    this._isBrowserOwner = false; // 是否是瀏覽器的所有者（负责重启）
    this._browserOwner = null; // 如果是共享者，指向所有者 Worker
    this._sharedWorkers = []; // 如果是所有者，儲存共享该瀏覽器的 Worker 列表
  }

  /**
   * 初始化瀏覽器实例
   * @param {object} [sharedBrowser] - 可选，共享的瀏覽器实例
   */
  async init(sharedBrowser = null) {
    if (this.initialized) return;

    // 确保用戶数据目錄存在
    if (!fs.existsSync(this.userDataDir)) {
      fs.mkdirSync(this.userDataDir, { recursive: true });
    }

    // 取得目标 URL
    let targetUrl = "about:blank";
    if (this.type === "merge") {
      const firstType = this.mergeTypes[0];
      targetUrl =
        registry.getTargetUrl(
          firstType,
          this.globalConfig,
          this.workerConfig,
        ) || "about:blank";
    } else {
      targetUrl =
        registry.getTargetUrl(
          this.type,
          this.globalConfig,
          this.workerConfig,
        ) || "about:blank";
    }

    // 登录模式下不註冊导航处理器，避免自动登录干预用戶操作
    const isLoginMode = process.argv.some((arg) => arg.startsWith("-login"));
    let navigationHandler = null;

    if (!isLoginMode) {
      // 收集导航处理器
      const handlers = [];
      const typesToHandle =
        this.type === "merge" ? this.mergeTypes : [this.type];
      for (const type of typesToHandle) {
        const typeHandlers = registry.getNavigationHandlers(type);
        handlers.push(...typeHandlers);
      }

      navigationHandler =
        handlers.length > 0
          ? async (page) => {
              for (const handler of handlers) {
                try {
                  await handler(page);
                } catch (e) {
                  logger.debug("工作池", `导航处理器執行失败: ${e.message}`);
                }
              }
            }
          : null;
    }

    logger.info("工作池", `[${this.name}] 正在初始化瀏覽器...`);
    if (this.proxyConfig) {
      logger.info(
        "工作池",
        `[${this.name}] 使用代理: ${this.proxyConfig.type}://${this.proxyConfig.host}:${this.proxyConfig.port}`,
      );
    } else {
      logger.info("工作池", `[${this.name}] 直连模式（无代理）`);
    }

    if (sharedBrowser) {
      await this._initWithSharedBrowser(
        sharedBrowser,
        targetUrl,
        navigationHandler,
      );
      this._isBrowserOwner = false;
    } else {
      await this._initNewBrowser(targetUrl, navigationHandler);
      this._isBrowserOwner = true;
    }

    this.initialized = true;
  }

  /**
   * 使用共享瀏覽器初始化
   * @private
   */
  async _initWithSharedBrowser(sharedBrowser, targetUrl, navigationHandler) {
    logger.info("工作池", `[${this.name}] 复用已有瀏覽器，建立新標籤页...`);
    this.browser = sharedBrowser;
    this.page = await sharedBrowser.newPage();
    this.page.authState = { isHandlingAuth: false };
    this.page._browserMutex = this._browserMutex;
    const humanizeCursorMode = this.globalConfig?.browser?.humanizeCursor;
    this.page._humanizeCursorMode = humanizeCursorMode;
    // true 表示使用项目维护的 ghost-cursor
    if (humanizeCursorMode === true) {
      this.page.cursor = createCursor(this.page);
    }

    // 儲存参数用于重新初始化
    this._targetUrl = targetUrl;
    this._navigationHandler = navigationHandler;

    await this._navigateToTarget(targetUrl);

    if (navigationHandler) {
      this.page.on("framenavigated", async () => {
        try {
          await navigationHandler(this.page);
        } catch (e) {
          /* ignore */
        }
      });
    }

    // 监听標籤页關閉事件，自动重新建立（仅针对共享者）
    this._registerPageCloseHandler();

    logger.info("工作池", `[${this.name}] 初始化完成`);
  }

  /**
   * 註冊標籤页關閉事件处理器
   * @private
   */
  _registerPageCloseHandler() {
    if (!this.page) return;

    this.page.on("close", async () => {
      // 如果瀏覽器還在執行，说明只是標籤页被關閉
      if (this.browser && !this.browser.isClosed?.()) {
        logger.warn("工作池", `[${this.name}] 標籤页已關閉，正在重新建立...`);
        this.initialized = false;
        this.page = null;
        try {
          await this._recreatePage();
        } catch (e) {
          logger.error(
            "工作池",
            `[${this.name}] 重新建立標籤页失败: ${e.message}`,
          );
        }
      }
    });
  }

  /**
   * 重新建立標籤页（標籤页關閉恢复）
   * @private
   */
  async _recreatePage() {
    this.page = await this.browser.newPage();
    this.page.authState = { isHandlingAuth: false };
    const humanizeCursorMode = this.globalConfig?.browser?.humanizeCursor;
    this.page._humanizeCursorMode = humanizeCursorMode;
    if (humanizeCursorMode === true) {
      this.page.cursor = createCursor(this.page);
    }
    await this._navigateToTarget(this._targetUrl || "about:blank");

    if (this._navigationHandler) {
      this.page.on("framenavigated", async () => {
        try {
          await this._navigationHandler(this.page);
        } catch (e) {
          /* ignore */
        }
      });
    }

    // 重新註冊標籤页關閉处理器
    this._registerPageCloseHandler();

    this.initialized = true;
    logger.info("工作池", `[${this.name}] 標籤页已成功重新建立`);
  }

  /**
   * 啟動新瀏覽器初始化
   * @private
   */
  async _initNewBrowser(targetUrl, navigationHandler) {
    const base = await initBrowserBase(this.globalConfig, {
      userDataDir: this.userDataDir,
      instanceName: this.instanceName,
      proxyConfig: this.proxyConfig,
    });

    this.browser = base.context;
    this.page = base.page;
    this.page.authState = { isHandlingAuth: false };
    const humanizeCursorMode = this.globalConfig?.browser?.humanizeCursor;
    this.page._humanizeCursorMode = humanizeCursorMode;
    if (humanizeCursorMode === true) {
      this.page.cursor = createCursor(this.page);
    }

    if (navigationHandler) {
      this.page.on("framenavigated", async () => {
        try {
          await navigationHandler(this.page);
        } catch (e) {
          /* ignore */
        }
      });
    }

    // 儲存 navigationHandler 用于重新初始化
    this._navigationHandler = navigationHandler;
    this._targetUrl = targetUrl;

    logger.info("工作池", `[${this.name}] 正在連接目标页面...`);
    await this._navigateToTarget(targetUrl);

    // 登录模式：註冊瀏覽器關閉事件（不阻塞，關閉后退出进程）
    const isLoginMode = process.argv.some((arg) => arg.startsWith("-login"));
    if (isLoginMode) {
      logger.info(
        "工作池",
        `[${this.name}] 登录模式已就绪，请在瀏覽器中完成登录`,
      );
      this.browser.on("close", () => {
        logger.info("工作池", `[${this.name}] 瀏覽器已關閉，登录模式结束`);
        process.exit(0);
      });
    } else {
      // 非登录模式：註冊断开事件，所有者负责重启并同步到共享者
      this.browser.on("close", async () => {
        logger.warn(
          "工作池",
          `[${this.name}] 瀏覽器已断开連接，正在自动重新初始化...`,
        );

        // 标记自己和所有共享者为未初始化
        this.initialized = false;
        this.browser = null;
        this.page = null;
        for (const sharedWorker of this._sharedWorkers) {
          sharedWorker.initialized = false;
          sharedWorker.browser = null;
          sharedWorker.page = null;
        }

        try {
          // 重新初始化瀏覽器
          await this._reinit();

          // 为所有共享者建立新的標籤页
          for (const sharedWorker of this._sharedWorkers) {
            try {
              logger.info(
                "工作池",
                `[${sharedWorker.name}] 正在恢复共享瀏覽器連接...`,
              );
              sharedWorker.browser = this.browser;
              sharedWorker.page = await this.browser.newPage();
              sharedWorker.page.authState = { isHandlingAuth: false };
              const sharedCursorMode =
                this.globalConfig?.browser?.humanizeCursor;
              sharedWorker.page._humanizeCursorMode = sharedCursorMode;
              if (sharedCursorMode === true) {
                sharedWorker.page.cursor = createCursor(sharedWorker.page);
              }
              await sharedWorker._navigateToTarget(
                sharedWorker._targetUrl || "about:blank",
              );
              sharedWorker._registerPageCloseHandler(); // 重新註冊標籤页關閉处理器
              sharedWorker.initialized = true;
              logger.info(
                "工作池",
                `[${sharedWorker.name}] 共享瀏覽器連接已恢复`,
              );
            } catch (e) {
              logger.error(
                "工作池",
                `[${sharedWorker.name}] 恢复共享瀏覽器連接失败: ${e.message}`,
              );
            }
          }
        } catch (e) {
          logger.error(
            "工作池",
            `[${this.name}] 自动重新初始化失败: ${e.message}`,
          );
        }
      });

      // 所有者也需要监听標籤页關閉事件
      this._registerPageCloseHandler();
    }

    logger.info("工作池", `[${this.name}] 初始化完成`);
  }

  /**
   * 导航到目标 URL
   * @private
   */
  async _navigateToTarget(targetUrl) {
    if (this.type === "merge") {
      let gotoSuccess = false;
      for (const type of this.mergeTypes) {
        const url = registry.getTargetUrl(
          type,
          this.globalConfig,
          this.workerConfig,
        );
        if (!url) continue;
        const gotoResult = await tryGotoWithCheck(this.page, url, {
          timeout: 30000,
        });
        if (!gotoResult.error) {
          gotoSuccess = true;
          logger.debug(
            "工作池",
            `[${this.name}] 使用 ${type} 配接器初始化成功`,
          );
          break;
        }
        logger.warn(
          "工作池",
          `[${this.name}] ${type} 网站不可用，尝试下一个...`,
          { error: gotoResult.error },
        );
      }
      if (!gotoSuccess) {
        logger.warn(
          "工作池",
          `[${this.name}] 所有配接器网站当前不可用，但 Worker 仍将初始化（请求时可能会失败）`,
        );
      }
    } else {
      const gotoResult = await tryGotoWithCheck(this.page, targetUrl, {
        timeout: 60000,
      });
      if (gotoResult.error) {
        logger.warn(
          "工作池",
          `[${this.name}] 目标网站当前不可用: ${gotoResult.error}，但 Worker 仍将初始化`,
        );
      }
    }
  }

  /**
   * 检查是否支援指定模型
   */
  supports(modelId) {
    if (this.type === "merge") {
      // 检查任一配接器是否支援该模型
      for (const type of this.mergeTypes) {
        if (registry.supportsModel(type, modelId)) return true;
      }
      // 支援 type/model 格式
      if (modelId.includes("/")) {
        const [specifiedType, actualModel] = modelId.split("/", 2);
        if (this.mergeTypes.includes(specifiedType)) {
          return registry.supportsModel(specifiedType, actualModel);
        }
      }
      return false;
    } else {
      // 支援 type/model 格式
      if (modelId.includes("/")) {
        const [specifiedType, actualModel] = modelId.split("/", 2);
        if (specifiedType === this.type) {
          return registry.supportsModel(this.type, actualModel);
        }
        return false;
      }
      return registry.supportsModel(this.type, modelId);
    }
  }

  /**
   * 确定模型对应的配接器類型（内部辅助方法）
   * @private
   */
  _getAdapterType(modelKey) {
    if (this.type === "merge") {
      if (modelKey.includes("/")) {
        const [specifiedType] = modelKey.split("/", 2);
        return this.mergeTypes.includes(specifiedType)
          ? specifiedType
          : this.mergeTypes[0];
      }
      // 找到第一个支援该模型的配接器
      for (const type of this.mergeTypes) {
        if (registry.supportsModel(type, modelKey)) return type;
      }
      return this.mergeTypes[0];
    }
    return this.type;
  }

  /**
   * 生成圖片
   */
  async generate(ctx, prompt, paths, modelId, meta) {
    const failoverConfig = this.globalConfig.backend?.pool?.failover || {};
    const failoverEnabled = failoverConfig.enabled !== false;

    if (this.type === "merge" && failoverEnabled) {
      return this._generateWithFailover(
        ctx,
        prompt,
        paths,
        modelId,
        meta,
        failoverConfig,
      );
    }

    // 验证是否支援该模型
    if (!this.supports(modelId)) {
      return { error: `Worker [${this.name}] 不支援模型: ${modelId}` };
    }

    // 确定配接器類型
    const type = this._getAdapterType(modelId);

    // 处理 type/model 格式，提取实际 modelId
    let actualModelId = modelId;
    if (modelId.includes("/")) {
      const parts = modelId.split("/", 2);
      actualModelId = parts[1];
    }

    // 传递原始 modelId 给配接器，由配接器自己解析
    return this._executeAdapter(ctx, type, actualModelId, prompt, paths, meta);
  }

  /**
   * Merge 模式下的故障转移生成
   * @private
   */
  async _generateWithFailover(
    ctx,
    prompt,
    paths,
    modelId,
    meta,
    failoverConfig = {},
  ) {
    const maxRetries = failoverConfig.maxRetries || 2;
    const candidateTypes = this._getCandidateTypes(modelId);

    if (candidateTypes.length === 0) {
      return { error: `Worker [${this.name}] 不支援模型: ${modelId}` };
    }

    const maxAttempts =
      maxRetries === 0
        ? candidateTypes.length
        : Math.min(maxRetries + 1, candidateTypes.length);
    let lastError = null;
    let lastRetryable = undefined;

    for (let i = 0; i < maxAttempts; i++) {
      const { type, modelId: actualModelId } = candidateTypes[i];
      const result = await this._executeAdapter(
        ctx,
        type,
        actualModelId,
        prompt,
        paths,
        meta,
      );

      if (!result.error) {
        return result;
      }

      lastError = result.error;
      lastRetryable = result.retryable;

      // 如果明确标记为不可重試（如内容安全问题），立即回傳
      if (result.retryable === false) {
        return {
          error: `所有支援该模型的配接器都无法使用: ${lastError}`,
          retryable: false,
        };
      }

      if (i < maxAttempts - 1) {
        logger.warn(
          "工作池",
          `[${this.name}] ${type} 失败，尝试下一个配接器...`,
          { error: lastError, ...meta },
        );
      }
    }

    return {
      error: `所有支援该模型的配接器都无法使用: ${lastError}`,
      retryable: lastRetryable,
    };
  }

  /**
   * 取得支援指定模型的候选配接器類型列表
   * @private
   */
  _getCandidateTypes(modelKey) {
    const candidates = [];

    if (modelKey.includes("/")) {
      const [specifiedType, actualModel] = modelKey.split("/", 2);
      if (
        this.mergeTypes.includes(specifiedType) &&
        registry.supportsModel(specifiedType, actualModel)
      ) {
        candidates.push({ type: specifiedType, modelId: actualModel });
      }
      return candidates;
    }

    // 收集所有支援该模型的配接器
    for (const type of this.mergeTypes) {
      if (registry.supportsModel(type, modelKey)) {
        candidates.push({ type, modelId: modelKey });
      }
    }

    return candidates;
  }

  /**
   * 執行单个配接器
   * @private
   */
  async _executeAdapter(ctx, type, modelId, prompt, paths, meta) {
    // 检查 Worker 是否已初始化（瀏覽器崩溃后会被标记为 false）
    if (!this.initialized || !this.page || this.page.isClosed()) {
      logger.info(
        "工作池",
        `[${this.name}] 瀏覽器已断开，正在自动重新初始化...`,
        meta,
      );
      try {
        await this._reinit();
      } catch (e) {
        logger.error("工作池", `[${this.name}] 重新初始化失败`, {
          error: e.message,
          ...meta,
        });
        return { error: `Worker 重新初始化失败: ${e.message}` };
      }
    }

    const adapter = registry.getAdapter(type);
    if (!adapter) {
      return { error: `配接器不存在: ${type}` };
    }

    logger.info(
      "工作池",
      `[${this.name}] 執行任务 -> ${type}/${modelId}`,
      meta,
    );

    const subContext = {
      ...ctx,
      page: this.page,
      config: this.globalConfig,
      proxyConfig: this.proxyConfig,
      userDataDir: this.userDataDir,
    };

    // 扩展 meta，添加 adapter 和 model 資訊
    const enrichedMeta = { ...meta, adapter: type, model: modelId };

    this.busyCount++;
    try {
      // 传递原始 modelId，由配接器自己解析
      return await adapter.generate(
        subContext,
        prompt,
        paths,
        modelId,
        enrichedMeta,
      );
    } finally {
      this.busyCount--;
    }
  }

  /**
   * 重新初始化瀏覽器（崩溃恢复）
   * @private
   */
  async _reinit() {
    this.initialized = false;
    this.browser = null;
    this.page = null;

    // 使用儲存的参数重新初始化
    await this._initNewBrowser(
      this._targetUrl || "about:blank",
      this._navigationHandler || null,
    );
    this.initialized = true;
    logger.info("工作池", `[${this.name}] 瀏覽器已成功重新初始化`);
  }

  /**
   * 取得支援的模型列表
   */
  getModels() {
    if (this.type === "merge") {
      const allModels = [];
      const seenIds = new Set();

      for (const type of this.mergeTypes) {
        const result = registry.getModelsForAdapter(type);
        if (result?.data) {
          for (const m of result.data) {
            if (!seenIds.has(m.id)) {
              seenIds.add(m.id);
              allModels.push({ ...m, owned_by: "internal_server" });
            }
          }
        }
      }

      for (const type of this.mergeTypes) {
        const result = registry.getModelsForAdapter(type);
        if (result?.data) {
          for (const m of result.data) {
            allModels.push({
              ...m,
              id: `${type}/${m.id}`,
              owned_by: type,
            });
          }
        }
      }

      return allModels;
    } else {
      const result = registry.getModelsForAdapter(this.type);
      const models = result?.data || [];
      const allModels = [];

      for (const m of models) {
        allModels.push({ ...m, owned_by: "internal_server" });
      }

      for (const m of models) {
        allModels.push({
          ...m,
          id: `${this.type}/${m.id}`,
          owned_by: this.type,
        });
      }

      return allModels;
    }
  }

  /**
   * 取得圖片策略（宽松策略：只要有一个配接器支援 optional 就回傳 optional）
   */
  getImagePolicy(modelKey) {
    const policies = new Set();

    if (this.type === "merge") {
      if (modelKey.includes("/")) {
        const [specifiedType, actualModel] = modelKey.split("/", 2);
        if (this.mergeTypes.includes(specifiedType)) {
          return registry.getImagePolicy(specifiedType, actualModel);
        }
      }
      // 收集所有支援该模型的配接器的 imagePolicy
      for (const type of this.mergeTypes) {
        if (registry.supportsModel(type, modelKey)) {
          policies.add(registry.getImagePolicy(type, modelKey));
        }
      }
    } else {
      return registry.getImagePolicy(this.type, modelKey);
    }

    // 宽松策略：只要有一个 optional 就回傳 optional
    if (policies.has("optional")) return "optional";
    if (policies.has("required")) return "required";
    if (policies.has("forbidden")) return "forbidden";
    return "optional";
  }

  /**
   * 取得模型類型
   */
  getModelType(modelKey) {
    if (this.type === "merge") {
      if (modelKey.includes("/")) {
        const [specifiedType, actualModel] = modelKey.split("/", 2);
        if (this.mergeTypes.includes(specifiedType)) {
          return registry.getModelType(specifiedType, actualModel);
        }
      }
      for (const type of this.mergeTypes) {
        if (registry.supportsModel(type, modelKey)) {
          return registry.getModelType(type, modelKey);
        }
      }
      return "image";
    } else {
      return registry.getModelType(this.type, modelKey);
    }
  }

  /**
   * 导航到監控页面（空闲时）
   */
  async navigateToMonitor() {
    if (this.type !== "merge" || !this.mergeMonitor) return;
    if (!this.page || this.page.isClosed()) return;

    const targetUrl = registry.getTargetUrl(
      this.mergeMonitor,
      this.globalConfig,
      this.workerConfig,
    );
    if (!targetUrl) return;

    const currentUrl = this.page.url();
    try {
      if (currentUrl.includes(new URL(targetUrl).hostname)) return;
    } catch (e) {
      return;
    }

    logger.info(
      "工作池",
      `[${this.name}] 空闲，跳转監控: ${this.mergeMonitor}`,
    );
    try {
      await this.page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
    } catch (e) {
      logger.warn("工作池", `[${this.name}] 監控跳转失败: ${e.message}`);
    }
  }

  /**
   * 取得 Cookies
   */
  async getCookies(domain) {
    if (!this.page) throw new Error(`Worker [${this.name}] 未初始化`);
    const context = this.page.context();
    if (domain) {
      return await context.cookies(
        domain.startsWith("http") ? domain : `https://${domain}`,
      );
    }
    return await context.cookies();
  }
}
