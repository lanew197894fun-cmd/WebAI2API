/**
 * @fileoverview 運行環境初始化腳本（CLI）
 * @description 用於下載/準備運行所需依賴（如 Camoufox、better-sqlite3 等）。
 *
 * 用法：
 *   npm run init                     # 自動初始化（無代理）
 *   npm run init -- -proxy           # 自動初始化（互動式輸入代理）
 *   npm run init -- -proxy=http://127.0.0.1:7890
 *   npm run init -- -proxy=socks5://user:pass@127.0.0.1:1080
 *   npm run init -- -custom          # 自定義模式
 */

import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import http from "http";
import { fileURLToPath } from "url";
import compressing from "compressing";
import { logger } from "../src/utils/logger.js";
import { select, input } from "@inquirer/prompts";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");
const TEMP_DIR = path.join(PROJECT_ROOT, "data", "temp");

/**
 * 解析命令列代理參數
 * @returns {Promise<string|null>} 代理 URL
 */
async function parseProxyArg() {
  // 搜尋 -proxy 或 -proxy=xxx 參數
  const proxyArg = process.argv.find((arg) => arg.startsWith("-proxy"));

  if (!proxyArg) {
    return null;
  }

  // -proxy=http://... 格式
  if (proxyArg.includes("=")) {
    const proxyUrl = proxyArg.split("=")[1];
    if (proxyUrl) {
      logger.info("初始化", `使用代理: ${proxyUrl}`);
      return proxyUrl;
    }
  }

  // -proxy 不帶參數，互動式輸入
  logger.info("初始化", "請輸入代理配置...");

  const proxyType = await select({
    message: "代理類型",
    choices: [
      { name: "HTTP", value: "http" },
      { name: "SOCKS5", value: "socks5" },
    ],
  });

  const host = await input({
    message: "代理伺服器地址",
    default: "127.0.0.1",
    validate: (val) => val.trim().length > 0 || "地址不能為空",
  });

  const port = await input({
    message: "代理埠號",
    default: "7890",
    validate: (val) => {
      const num = parseInt(val, 10);
      return (num > 0 && num <= 65535) || "埠號必須是 1-65535 的數字";
    },
  });

  const username = await input({
    message: "用戶名 (可選，回車跳過)",
  });

  const password = await input({
    message: "密碼 (可選，回車跳過)",
  });

  // 構建代理 URL
  let proxyUrl = `${proxyType}://`;
  if (username && password) {
    proxyUrl += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  } else if (username) {
    proxyUrl += `${encodeURIComponent(username)}@`;
  }
  proxyUrl += `${host}:${port}`;

  logger.info("初始化", `使用代理: ${proxyUrl}`);
  return proxyUrl;
}

// 確保臨時目錄存在
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * 獲取 Node.js ABI 版本
 */
function getNodeABI() {
  return process.versions.modules;
}

/**
 * 獲取平台資訊
 */
function getPlatformInfo() {
  const platform = os.platform();
  const arch = os.arch();
  const nodeVersion = process.version;
  const abi = getNodeABI();

  return { platform, arch, nodeVersion, abi };
}

/**
 * 驗證平台支援
 */
function validatePlatform(platform, arch) {
  const supported = {
    win32: ["x64"],
    darwin: ["x64", "arm64"],
    linux: ["x64", "arm64"],
  };

  if (!supported[platform] || !supported[platform].includes(arch)) {
    return false;
  }

  return true;
}

/**
 * 驗證 Node.js ABI 版本支援
 */
function validateABI(abi) {
  const supportedABIs = [
    115, 121, 123, 125, 127, 128, 130, 131, 132, 133, 135, 136, 137, 139, 140,
    141,
  ];
  return supportedABIs.includes(parseInt(abi, 10));
}

/**
 * 下載檔案（帶進度，流式，支援重試）
 * @param {string} url - 下載地址
 * @param {string} destPath - 目標檔案路徑
 * @param {string|null} proxyUrl - 代理 URL（支援 http:// 和 socks5://）
 * @param {number} maxRetries - 最大重試次數
 */
async function downloadFile(url, destPath, proxyUrl = null, maxRetries = 3) {
  if (proxyUrl) {
    const proxyType = proxyUrl.startsWith("socks") ? "SOCKS5" : "HTTP";
    logger.info("初始化", `使用 ${proxyType} 代理: ${proxyUrl}`);
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        logger.info("初始化", `第 ${attempt}/${maxRetries} 次嘗試下載...`);
        // 刪除之前失敗的檔案
        try {
          if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
          }
        } catch (e) {}
      } else {
        logger.info("初始化", `開始下載: ${url}`);
      }

      await downloadFileOnce(url, destPath, proxyUrl);
      return destPath;
    } catch (error) {
      logger.error(
        "初始化",
        `下載失敗 (嘗試 ${attempt}/${maxRetries}): ${error.message}`,
      );

      if (attempt === maxRetries) {
        throw error;
      }

      // 等待後重試（遞增延遲）
      const delay = attempt * 2000;
      logger.info("初始化", `${delay / 1000} 秒後重試...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * 單次下載嘗試（內部函數）
 * 使用 Node.js 原生 http/https 模組，支援 SOCKS5 和 HTTP 代理
 */
async function downloadFileOnce(url, destPath, proxyUrl = null) {
  const IDLE_TIMEOUT = 180000; // 3 分鐘無數據傳輸才超時

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === "https:";

    let requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        "User-Agent": "Wget/1.21.4 (linux-gnu)",
        Accept: "*/*",
        "Accept-Encoding": "identity",
        Connection: "keep-alive",
      },
    };

    // 創建代理 agent
    let httpModule = isHttps ? https : http;
    let agent = null;

    if (proxyUrl) {
      if (proxyUrl.startsWith("socks")) {
        // SOCKS5 代理，使用 socks-proxy-agent
        logger.debug("初始化", `使用 SOCKS5 代理: ${proxyUrl}`);
        agent = new SocksProxyAgent(proxyUrl);
      } else if (proxyUrl.startsWith("http")) {
        // HTTP 代理，使用 https-proxy-agent
        logger.debug("初始化", `使用 HTTP 代理: ${proxyUrl}`);
        agent = new HttpsProxyAgent(proxyUrl);
      }
    }

    // 添加 agent 到請求選項
    if (agent) {
      requestOptions.agent = agent;
    }

    const fileStream = fs.createWriteStream(destPath);
    let downloadedSize = 0;
    let totalSize = 0;
    let lastLogTime = Date.now();
    let finished = false;
    let idleTimer = null;
    let req = null;

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!finished) {
          const error = new Error(
            `下載逾時: ${IDLE_TIMEOUT / 1000} 秒內沒有收到任何資料`,
          );
          cleanup();
          reject(error);
        }
      }, IDLE_TIMEOUT);
    };

    const cleanup = () => {
      finished = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (req) {
        try {
          req.destroy();
        } catch (e) {}
      }
      fileStream.close();
    };

    const handleResponse = (res) => {
      resetIdleTimer();

      // 處理重定向
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        cleanup();
        try {
          fs.unlinkSync(destPath);
        } catch (e) {}
        logger.info("初始化", `重定向到: ${res.headers.location}`);
        // 遞歸調用處理重定向
        downloadFileOnce(res.headers.location, destPath, proxyUrl)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        cleanup();
        try {
          fs.unlinkSync(destPath);
        } catch (e) {}
        reject(new Error(`HTTP 錯誤: ${res.statusCode}`));
        return;
      }

      totalSize = parseInt(res.headers["content-length"] || "0", 10);
      if (totalSize > 0) {
        logger.info(
          "初始化",
          `檔案大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`,
        );
      }

      res.on("data", (chunk) => {
        resetIdleTimer();
        downloadedSize += chunk.length;

        const now = Date.now();
        if (totalSize > 0 && now - lastLogTime > 100) {
          // 100ms 更新一次，更流暢
          const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
          const downloadedMB = (downloadedSize / 1024 / 1024).toFixed(2);
          const totalMB = (totalSize / 1024 / 1024).toFixed(2);
          // 使用 \r 回到行首，實現單行重新整理
          process.stdout.write(
            `\r下載進度: ${percent}% (${downloadedMB}MB / ${totalMB}MB)    `,
          );
          lastLogTime = now;
        }
      });

      res.on("error", (error) => {
        if (finished) return;
        cleanup();
        try {
          fs.unlinkSync(destPath);
        } catch (e) {}
        reject(error);
      });

      res.pipe(fileStream);

      fileStream.on("error", (error) => {
        if (finished) return;
        cleanup();
        reject(error);
      });

      fileStream.on("finish", () => {
        if (finished) return;
        finished = true;
        if (idleTimer) clearTimeout(idleTimer);

        const finalSize = (downloadedSize / 1024 / 1024).toFixed(2);

        if (totalSize > 0 && downloadedSize !== totalSize) {
          process.stdout.write("\n"); // 換行，避免與進度條混在一起
          const errorMsg = `下載不完整: 預期 ${(totalSize / 1024 / 1024).toFixed(2)} MB, 實際 ${finalSize} MB`;
          logger.error("初始化", errorMsg);
          try {
            fs.unlinkSync(destPath);
          } catch (e) {}
          reject(new Error(errorMsg));
          return;
        }

        process.stdout.write("\n"); // 換行，結束進度條
        logger.info("初始化", `下載完成: ${finalSize} MB`);
        resolve(destPath);
      });
    };

    resetIdleTimer();

    // 統一使用 httpModule.request 發起請求（agent 會自動處理代理）
    req = httpModule.request(requestOptions, handleResponse);
    req.on("error", (error) => {
      if (finished) return;
      cleanup();
      try {
        fs.unlinkSync(destPath);
      } catch (e) {}
      reject(error);
    });
    req.end();
  });
}

/**
 * 建構 better-sqlite3 下載 URL
 */
function getBetterSqlite3Url(platform, arch, abi) {
  const version = "12.5.0";
  const platformMap = {
    win32: "win32",
    darwin: "darwin",
    linux: "linux",
  };

  const platformName = platformMap[platform];
  const archName = arch; // x64 或 arm64

  return `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/better-sqlite3-v${version}-node-v${abi}-${platformName}-${archName}.tar.gz`;
}

/**
 * 下載並安裝 better-sqlite3
 */
async function installBetterSqlite3(platform, arch, abi, proxyUrl) {
  logger.info("初始化", "開始安裝 better-sqlite3...");

  const url = getBetterSqlite3Url(platform, arch, abi);
  const downloadPath = path.join(TEMP_DIR, "better-sqlite3.tar.gz");

  // 下載
  await downloadFile(url, downloadPath, proxyUrl);

  // 解壓 .tar.gz 檔案
  logger.info("初始化", "正在解壓 better-sqlite3...");
  await compressing.tgz.uncompress(downloadPath, TEMP_DIR);

  // 搜尋 better_sqlite3.node
  const files = fs.readdirSync(TEMP_DIR, { recursive: true });
  const nodeFile = files.find((f) => f.endsWith("better_sqlite3.node"));
  if (!nodeFile) {
    throw new Error("未找到 better_sqlite3.node 檔案");
  }

  // 複製到 node_modules
  const buildDir = path.join(
    PROJECT_ROOT,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
  );
  if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir, { recursive: true });
  }

  const sourcePath = path.join(TEMP_DIR, nodeFile);
  const destPath = path.join(buildDir, "better_sqlite3.node");
  fs.copyFileSync(sourcePath, destPath);

  logger.info("初始化", `better-sqlite3 安裝成功: ${destPath}`);

  // 清理
  fs.unlinkSync(downloadPath);
  // 清理解壓後的所有檔案
  files.forEach((f) => {
    const filePath = path.join(TEMP_DIR, f);
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
      }
    } catch (e) {}
  });
}

/**
 * 建構 Camoufox 下載 URL
 */
function getCamoufoxUrl(platform, arch) {
  const version = "135.0.1-beta.24";
  const platformMap = {
    win32: "win",
    darwin: "mac",
    linux: "lin",
  };

  const archMap = {
    x64: "x86_64",
    arm64: "arm64",
  };

  const platformName = platformMap[platform];
  const archName = archMap[arch];

  return `https://github.com/daijro/camoufox/releases/download/v${version}/camoufox-${version}-${platformName}.${archName}.zip`;
}

/**
 * 下載並安裝 Camoufox
 */
async function installCamoufox(platform, arch, proxyUrl) {
  logger.info("初始化", "開始安裝 Camoufox 瀏覽器...");

  const url = getCamoufoxUrl(platform, arch);
  const downloadPath = path.join(TEMP_DIR, "camoufox.zip");

  // 下載
  await downloadFile(url, downloadPath, proxyUrl);

  // 解壓 .zip 檔案到 camoufox 目錄
  logger.info("初始化", "正在解壓 Camoufox...");
  const camoufoxDir = path.join(PROJECT_ROOT, "camoufox");
  if (!fs.existsSync(camoufoxDir)) {
    fs.mkdirSync(camoufoxDir, { recursive: true });
  }

  await compressing.zip.uncompress(downloadPath, camoufoxDir);

  // macOS 專用：複製 properties.json 到 MacOS 目錄
  if (platform === "darwin") {
    const resourcesPath = path.join(
      camoufoxDir,
      "Camoufox.app",
      "Contents",
      "Resources",
      "properties.json",
    );
    const macOSDir = path.join(
      camoufoxDir,
      "Camoufox.app",
      "Contents",
      "MacOS",
    );
    const macOSPath = path.join(macOSDir, "properties.json");

    if (fs.existsSync(resourcesPath)) {
      // 確保目標目錄存在
      if (!fs.existsSync(macOSDir)) {
        fs.mkdirSync(macOSDir, { recursive: true });
      }
      fs.copyFileSync(resourcesPath, macOSPath);
      logger.info("初始化", `已複製 properties.json 到 MacOS 目錄`);
    } else {
      logger.warn("初始化", `未找到 properties.json: ${resourcesPath}`);
    }
  }

  logger.info("初始化", `Camoufox 安裝成功: ${camoufoxDir}`);

  // 建立 version.json
  const versionJsonPath = path.join(camoufoxDir, "version.json");
  const versionData = {
    version: "135.0",
    release: "beta.24",
  };
  fs.writeFileSync(
    versionJsonPath,
    JSON.stringify(versionData, null, 2),
    "utf8",
  );
  logger.info("初始化", `已生成 version.json: ${versionJsonPath}`);

  // 清理
  fs.unlinkSync(downloadPath);
}

/**
 * 主流程
 */
(async () => {
  try {
    logger.info("初始化", "========================================");
    logger.info("初始化", "依賴初始化腳本啟動");
    logger.info("初始化", "========================================");

    // 代理使用提示
    if (!process.argv.some((arg) => arg.startsWith("-proxy"))) {
      logger.warn(
        "初始化",
        "該腳本需連接 GitHub 下載資源。若網路受限，請使用代理：",
      );
      logger.warn(
        "初始化",
        " - 用法: npm run init -- -proxy 可互動式填寫代理資訊",
      );
      logger.warn(
        "初始化",
        " - 同時支援直接傳入參數或者使用帶鑑權的代理 (支援HTTP和SOCKS5)",
      );
      logger.warn(
        "初始化",
        " - 範例: npm run init -- -proxy=http://username:passwd@127.0.0.1:7890",
      );
    }

    // 顯示系統資訊
    const { platform, arch, nodeVersion, abi } = getPlatformInfo();
    logger.info("初始化", `操作系统: ${platform}`);
    logger.info("初始化", `芯片架构: ${arch}`);
    logger.info("初始化", `Node.js 版本: ${nodeVersion}`);
    logger.info("初始化", `Node.js ABI 版本: ${abi}`);

    // 驗證平台支援
    if (!validatePlatform(platform, arch)) {
      logger.error("初始化", "不支援的平台！");
      logger.error(
        "初始化",
        `因此專案使用了 Camoufox 瀏覽器，沒有您裝置可用的預編譯版本`,
      );
      logger.error(
        "初始化",
        `支援的平台: Windows x64, macOS x64/arm64, Linux x64/arm64`,
      );
      process.exit(1);
    }

    logger.info("初始化", "平台支援檢查通過");

    // 驗證 ABI 版本支援
    if (!validateABI(abi)) {
      logger.error("初始化", "不支援的 Node.js ABI 版本！");
      logger.error("初始化", `當前 ABI 版本: ${abi}`);
      logger.error(
        "初始化",
        `支援的 ABI 版本: 115, 121, 123, 125, 127, 128, 130, 131, 132, 133, 135, 136, 137, 139, 140, 141`,
      );
      logger.error("初始化", `建議使用 Node.js 20.10.0 或更高版本`);
      process.exit(1);
    }

    logger.info("初始化", "ABI 版本檢查通過");

    // 解析代理参数
    const proxyUrl = await parseProxyArg();

    // 檢查是否為自定義模式
    const isCustomMode = process.argv.includes("-custom");

    if (isCustomMode) {
      // 自定义模式：交互式选择步骤
      const action = await select({
        message: "請選擇要執行的操作:",
        choices: [
          { name: "安裝 better-sqlite3 預編譯檔案", value: "sqlite" },
          { name: "安裝 Camoufox 瀏覽器", value: "camoufox" },
          { name: "安裝 GeoLite2-City.mmdb 資料庫", value: "geolite" },
          { name: "修復 macOS 環境下的 properties.json", value: "macos_fix" },
          { name: "修復 version.json 缺失", value: "version_fix" },
          { name: "退出", value: "exit" },
        ],
      });

      switch (action) {
        case "sqlite":
          await installBetterSqlite3(platform, arch, abi, proxyUrl);
          break;
        case "camoufox":
          await installCamoufox(platform, arch, proxyUrl);
          break;
        case "geolite":
          await downloadGeoLiteDb(proxyUrl, true); // 強制下載
          break;
        case "macos_fix":
          fixMacOSProperties();
          break;
        case "version_fix":
          fixVersionJson();
          break;
        case "exit":
          logger.info("初始化", "已退出");
          break;
      }
    } else {
      // 正常模式：執行所有步驟
      await installBetterSqlite3(platform, arch, abi, proxyUrl);
      await installCamoufox(platform, arch, proxyUrl);
      await downloadGeoLiteDb(proxyUrl);
    }

    logger.info("初始化", "========================================");
    logger.info("初始化", "操作完成！");
    logger.info("初始化", "========================================");
    process.exit(0);
  } catch (err) {
    logger.error("初始化", "初始化失敗", { error: err.message });
    process.exit(1);
  }
})();

/**
 * 下載 GeoLite2-City.mmdb 到 camoufox 目錄
 * @param {string|null} proxyUrl - 代理 URL
 * @param {boolean} [force=false] - 是否強制下載（忽略已存在檢查）
 */
async function downloadGeoLiteDb(proxyUrl, force = false) {
  const camoufoxDir = path.join(PROJECT_ROOT, "camoufox");
  const destPath = path.join(camoufoxDir, "GeoLite2-City.mmdb");

  // 確保目錄存在
  if (!fs.existsSync(camoufoxDir)) {
    fs.mkdirSync(camoufoxDir, { recursive: true });
  }

  // 如果已存在且非強制模式，跳過下載
  if (!force && fs.existsSync(destPath)) {
    logger.info("初始化", "GeoLite2-City.mmdb 已存在，跳過下載");
    return;
  }

  logger.info("初始化", "開始下載 GeoLite2-City.mmdb...");
  const url =
    "https://github.com/P3TERX/GeoLite.mmdb/releases/latest/download/GeoLite2-City.mmdb";
  await downloadFile(url, destPath, proxyUrl);
  logger.info("初始化", `GeoLite2-City.mmdb 下載完成: ${destPath}`);
}

/**
 * 修復 macOS 環境下的 properties.json
 */
function fixMacOSProperties() {
  const platform = os.platform();
  if (platform !== "darwin") {
    logger.warn("初始化", "此操作僅適用於 macOS 系統");
    return;
  }

  const camoufoxDir = path.join(PROJECT_ROOT, "camoufox");
  const resourcesPath = path.join(
    camoufoxDir,
    "Camoufox.app",
    "Contents",
    "Resources",
    "properties.json",
  );
  const macOSDir = path.join(camoufoxDir, "Camoufox.app", "Contents", "MacOS");
  const macOSPath = path.join(macOSDir, "properties.json");

  if (!fs.existsSync(resourcesPath)) {
    logger.error("初始化", `源檔案不存在: ${resourcesPath}`);
    logger.error("初始化", "請先安裝 Camoufox 瀏覽器");
    return;
  }

  if (!fs.existsSync(macOSDir)) {
    fs.mkdirSync(macOSDir, { recursive: true });
  }

  fs.copyFileSync(resourcesPath, macOSPath);
  logger.info("初始化", `已複製 properties.json 到 MacOS 目錄: ${macOSPath}`);
}

/**
 * 修復 version.json 缺失
 */
function fixVersionJson() {
  const camoufoxDir = path.join(PROJECT_ROOT, "camoufox");
  const versionJsonPath = path.join(camoufoxDir, "version.json");

  if (!fs.existsSync(camoufoxDir)) {
    logger.error("初始化", `camoufox 目錄不存在: ${camoufoxDir}`);
    logger.error("初始化", "請先安裝 Camoufox 瀏覽器");
    return;
  }

  const versionData = {
    version: "135.0",
    release: "beta.24",
  };

  fs.writeFileSync(
    versionJsonPath,
    JSON.stringify(versionData, null, 2),
    "utf8",
  );
  logger.info("初始化", `已生成 version.json: ${versionJsonPath}`);
}
