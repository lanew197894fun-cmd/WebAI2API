/**
 * @fileoverview 配置載入模組
 * @description 負責讀取/解析 `config.yaml`，並提供 API Key 生成能力（供腳本使用）。
 *
 * 約定：
 * - 該模組只負責「讀取 + 校驗 + 預設值補全」，不負責建立/寫入設定檔。
 * - 初始化/複製配置請使用 `config.example.yaml` + `scripts/config-init.js`。
 */

import fs from "fs";
import path from "path";
import yaml from "yaml";

import { logger } from "../utils/logger.js";

// --- 配置檔案路徑常量 ---
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_CONFIG_PATH = path.join(DATA_DIR, "config.yaml");
const ROOT_CONFIG_PATH = path.join(process.cwd(), "config.yaml");
const EXAMPLE_CONFIG_PATH = path.join(process.cwd(), "config.example.yaml");

// 模組級快取：確保配置只從磁碟讀取一次
let cachedConfig = null;
// 實際使用的配置檔案路徑
let activeConfigPath = null;

/**
 * 解析配置檔案路徑（優先級：data/config.yaml > config.yaml > 從 config.example.yaml 複製）
 * 自動遷移：如果只有根目錄 config.yaml，會自動移動到 data/config.yaml
 * @returns {string} 配置檔案路徑
 */
function resolveConfigPath() {
  // 1. 優先使用 data/config.yaml
  if (fs.existsSync(DATA_CONFIG_PATH)) {
    return DATA_CONFIG_PATH;
  }

  // 2. 根目錄有 config.yaml，自動遷移到 data/config.yaml
  if (fs.existsSync(ROOT_CONFIG_PATH)) {
    // 確保 data 目錄存在
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    // 移動檔案到 data 目錄
    fs.renameSync(ROOT_CONFIG_PATH, DATA_CONFIG_PATH);
    logger.info(
      "配置器",
      `已將 ${ROOT_CONFIG_PATH} 遷移到 ${DATA_CONFIG_PATH}`,
    );
    return DATA_CONFIG_PATH;
  }

  // 3. 兩個都沒有，從 config.example.yaml 複製到 data/config.yaml
  if (fs.existsSync(EXAMPLE_CONFIG_PATH)) {
    // 確保 data 目錄存在
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.copyFileSync(EXAMPLE_CONFIG_PATH, DATA_CONFIG_PATH);
    logger.info(
      "配置器",
      `已從 ${EXAMPLE_CONFIG_PATH} 複製配置到 ${DATA_CONFIG_PATH}`,
    );
    return DATA_CONFIG_PATH;
  }

  // 4. 都沒有，回傳 data/config.yaml 路徑（後續會拋出錯誤）
  return DATA_CONFIG_PATH;
}

/**
 * 獲取當前使用的配置檔案路徑
 * @returns {string} 配置檔案路徑
 */
export function getConfigPath() {
  if (!activeConfigPath) {
    activeConfigPath = resolveConfigPath();
  }
  return activeConfigPath;
}

/**
 * 解析用戶數據目錄路徑
 * @param {string|undefined} userDataMark - 用戶數據標記
 * @returns {string} 完整的用戶數據目錄路徑
 */
function resolveUserDataDir(userDataMark) {
  const baseDir = path.join(process.cwd(), "data");
  if (!userDataMark) {
    return path.join(baseDir, "camoufoxUserData");
  }
  return path.join(baseDir, `camoufoxUserData_${userDataMark}`);
}

/**
 * 解析代理配置（Instance 級優先於全局）
 * @param {object|undefined} globalProxy - 全局代理配置
 * @param {object|undefined} instanceProxy - Instance 級代理配置
 * @returns {object|null} 最終代理配置，null 表示直連
 */
function resolveProxyConfig(globalProxy, instanceProxy) {
  // Instance 級顯式停用代理 -> 直連
  if (instanceProxy && instanceProxy.enable === false) {
    return null;
  }
  // Instance 級有配置且啟用 -> 使用 Instance 配置
  if (instanceProxy && instanceProxy.enable === true) {
    return instanceProxy;
  }
  // 回退到全局配置
  if (globalProxy && globalProxy.enable === true) {
    return globalProxy;
  }
  return null;
}

/**
 * 校驗 Instance 配置
 * @param {object} instance - Instance 配置
 * @param {number} index - Instance 索引
 */
function validateInstance(instance, index) {
  if (!instance.name) {
    throw new Error(`instances[${index}] 缺少必需字段: name`);
  }
  if (
    !instance.workers ||
    !Array.isArray(instance.workers) ||
    instance.workers.length === 0
  ) {
    throw new Error(
      `instances[${index}] (${instance.name}) 缺少有效的 workers 陣列`,
    );
  }
}

/**
 * 校驗 Worker 配置
 * @param {object} worker - Worker 配置
 * @param {string} instanceName - 所屬 Instance 名稱
 * @param {number} index - Worker 索引
 */
function validateWorker(worker, instanceName, index) {
  if (!worker.name) {
    throw new Error(
      `instances[${instanceName}].workers[${index}] 缺少必需字段: name`,
    );
  }
  if (!worker.type) {
    throw new Error(
      `instances[${instanceName}].workers[${index}] (${worker.name}) 缺少必需字段: type`,
    );
  }
  // 移除對 type 的硬編碼校驗，允許動態載入新適配器
  // if (!VALID_ADAPTER_TYPES.includes(worker.type)) { ... }

  if (worker.type === "merge") {
    if (
      !worker.mergeTypes ||
      !Array.isArray(worker.mergeTypes) ||
      worker.mergeTypes.length === 0
    ) {
      throw new Error(
        `Worker "${worker.name}" 類型為 merge，但缺少有效的 mergeTypes 陣列`,
      );
    }
  }
}

/**
 * 展開 instances 配置為扁平化的 workers 陣列
 * @param {object[]} instances - instances 配置陣列
 * @param {object} globalProxy - 全局代理配置
 * @returns {object[]} 扁平化的 worker 配置陣列
 */
function flattenInstancesToWorkers(instances, globalProxy) {
  const workers = [];
  const workerNames = new Set();

  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i];
    validateInstance(instance, i);

    // 解析 Instance 級配置
    const userDataDir = resolveUserDataDir(instance.userDataMark);
    const resolvedProxy = resolveProxyConfig(globalProxy, instance.proxy);

    for (let j = 0; j < instance.workers.length; j++) {
      const worker = instance.workers[j];
      validateWorker(worker, instance.name, j);

      // 檢查 Worker 名稱全局唯一性
      if (workerNames.has(worker.name)) {
        throw new Error(
          `Worker 名稱 "${worker.name}" 重複。Worker 名稱必須全局唯一。`,
        );
      }
      workerNames.add(worker.name);

      // 構建扁平化的 Worker 配置
      workers.push({
        // Worker 自身屬性
        name: worker.name,
        type: worker.type,
        mergeTypes: worker.mergeTypes || [],
        mergeMonitor: worker.mergeMonitor || null,

        // 從 Instance 繼承的屬性
        instanceName: instance.name,
        userDataMark: instance.userDataMark || null,
        userDataDir,
        resolvedProxy,
      });
    }
  }

  return workers;
}

/**
 * 載入並校驗配置（唯讀）
 * @returns {object} 配置物件
 */
export function loadConfig() {
  // 如果已有快取，直接回傳
  if (cachedConfig) return cachedConfig;

  // 解析配置檔案路徑（帶優先級和自動複製邏輯）
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `未找到配置檔案: ${configPath}。請確保 data/config.yaml、config.yaml 或 config.example.yaml 存在。`,
    );
  }

  const configFile = fs.readFileSync(configPath, "utf8");
  let config = yaml.parse(configFile);
  if (!config || typeof config !== "object") {
    throw new Error(`配置檔案解析失敗: ${configPath}`);
  }

  // Docker 路徑相容處理
  if (
    (!config.browser?.path || !fs.existsSync(config.browser.path)) &&
    fs.existsSync("/app/camoufox/camoufox")
  ) {
    logger.info(
      "配置器",
      "偵測到容器環境，自動修正瀏覽器路徑為 /app/camoufox/camoufox",
    );
    if (!config.browser) config.browser = {};
    config.browser.path = "/app/camoufox/camoufox";
  }

  // 基礎配置校驗
  if (!config.server || !config.server.port) {
    throw new Error("配置檔案缺少必需字段: server.port");
  }
  // 埠類型與範圍校驗
  const port = config.server.port;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(`server.port 必須是 1-65535 範圍內的整數，目前值: ${port}`);
  }
  // Auth Token 校驗：允許留空，但輸出安全警告
  if (!config.server.auth) {
    logger.warn(
      "配置器",
      "server.auth 未配置！API 和 WebUI 將無需認證即可存取！",
    );
    logger.warn(
      "配置器",
      "請勿在公網環境中留空 auth，建議使用 npm run genkey 生成金鑰",
    );
  } else if (config.server.auth === "sk-change-me-to-your-secure-key") {
    logger.warn("配置器", "偵測到預設金鑰！請勿在公網環境中使用預設金鑰");
  } else if (
    typeof config.server.auth !== "string" ||
    config.server.auth.length < 10
  ) {
    logger.warn(
      "配置器",
      "server.auth 長度少於 10 個字元，安全性較低，建議使用 npm run genkey 生成金鑰",
    );
  }

  // 設定 keepalive 配置預設值
  if (!config.server.keepalive) {
    config.server.keepalive = { mode: "comment" };
  } else {
    if (config.server.keepalive.mode === undefined)
      config.server.keepalive.mode = "comment";
    if (!["comment", "content"].includes(config.server.keepalive.mode)) {
      logger.warn(
        "配置器",
        `無效的 keepalive.mode: ${config.server.keepalive.mode}，使用預設值 comment`,
      );
      config.server.keepalive.mode = "comment";
    }
  }

  // 設定 browser 配置預設值
  if (!config.browser) config.browser = {};
  if (config.browser.humanizeCursor === undefined) {
    config.browser.humanizeCursor = true;
  }

  // 設定 Pool 配置預設值
  if (!config.backend) config.backend = {};
  if (!config.backend.pool) config.backend.pool = {};

  if (!config.backend.pool.strategy) {
    config.backend.pool.strategy = "least_busy";
  }
  if (
    !["least_busy", "round_robin", "random"].includes(
      config.backend.pool.strategy,
    )
  ) {
    logger.warn(
      "配置器",
      `無效的 pool.strategy: ${config.backend.pool.strategy}，使用預設值 least_busy`,
    );
    config.backend.pool.strategy = "least_busy";
  }

  // 故障轉移配置預設值
  if (!config.backend.pool.failover) {
    config.backend.pool.failover = {};
  }
  if (config.backend.pool.failover.enabled === undefined) {
    config.backend.pool.failover.enabled = true;
  }
  if (config.backend.pool.failover.maxRetries === undefined) {
    config.backend.pool.failover.maxRetries = 2;
  }
  if (config.backend.pool.failover.imgDlRetry === undefined) {
    config.backend.pool.failover.imgDlRetry = false;
  }
  if (config.backend.pool.failover.imgDlRetryMaxRetries === undefined) {
    config.backend.pool.failover.imgDlRetryMaxRetries = 2;
  }

  // 校驗 instances 配置
  if (
    !config.backend.pool.instances ||
    !Array.isArray(config.backend.pool.instances)
  ) {
    throw new Error("配置檔案缺少必需字段: backend.pool.instances");
  }
  if (config.backend.pool.instances.length === 0) {
    throw new Error("backend.pool.instances 不能為空陣列");
  }

  // 展開 instances 為扁平化的 workers 陣列
  config.backend.pool.workers = flattenInstancesToWorkers(
    config.backend.pool.instances,
    config.browser?.proxy,
  );

  // 設定佇列配置預設值
  if (!config.queue) {
    config.queue = {
      queueBuffer: 2,
      imageLimit: 5,
    };
  } else {
    if (config.queue.queueBuffer === undefined) config.queue.queueBuffer = 2;
    if (config.queue.imageLimit === undefined) config.queue.imageLimit = 5;
  }

  // maxConcurrent 动态计算：等于 Workers 数量
  config.queue.maxConcurrent = config.backend.pool.workers.length;

  // 初始化 adapter 配置容器
  if (!config.backend.adapter) {
    config.backend.adapter = {};
  }

  // 校驗 gemini_biz 配置（如果有 Worker 使用）
  const hasGeminiBizWorker = config.backend.pool.workers.some(
    (w) =>
      w.type === "gemini_biz" ||
      (w.type === "merge" && w.mergeTypes?.includes("gemini_biz")),
  );
  if (hasGeminiBizWorker && !config.backend.adapter.gemini_biz?.entryUrl) {
    throw new Error(
      "存在 gemini_biz 類型的 Worker，但 backend.adapter.gemini_biz.entryUrl 未配置",
    );
  }

  // 設定日誌級別
  if (config.logLevel) {
    logger.setLevel(config.logLevel);
  }

  // 日誌輸出
  logger.debug("配置器", `已載入配置檔案: ${configPath}`);
  logger.debug(
    "配置器",
    `Instances: ${config.backend.pool.instances.length}, Workers: ${config.backend.pool.workers.length}`,
  );
  logger.debug("配置器", `調度策略: ${config.backend.pool.strategy}`);
  logger.debug("配置器", `流式心跳模式: ${config.server.keepalive.mode}`);

  // 快取配置
  cachedConfig = config;
  return config;
}

// 匯出輔助函式供其他模組使用
export { resolveUserDataDir, resolveProxyConfig };

// 默認匯出為函式
export default loadConfig;
