/**
 * @fileoverview 代理配接模組
 * @description 将配置中的 HTTP/SOCKS5 代理转换为 Playwright 可用的代理配置，并在需要时通过 proxy-chain 搭建本地 HTTP 代理桥接。
 */

import { anonymizeProxy, closeAnonymizedProxy } from "proxy-chain";
import { logger } from "./logger.js";

// 全局代理状态：用于清理 proxy-chain 建立的本地代理資源
const proxyState = {
  anonymizedProxyUrl: null, // 转换后的 HTTP 代理地址
  originalProxyUrl: null, // 原始代理地址
};

/**
 * 构建代理 URL
 * @param {object} proxyConfig - 代理配置物件
 * @param {string} proxyConfig.type - 代理類型 ('http' 或 'socks5')
 * @param {string} proxyConfig.host - 代理主机地址
 * @param {number} proxyConfig.port - 代理端口
 * @param {string} [proxyConfig.user] - 可选的用戶名
 * @param {string} [proxyConfig.passwd] - 可选的密码
 * @returns {string} - 代理 URL
 */
export function buildProxyUrl(proxyConfig) {
  const { type, host, port, user, passwd } = proxyConfig;

  // 构建带认证的代理 URL
  if (user && passwd) {
    return `${type}://${user}:${passwd}@${host}:${port}`;
  }

  // 构建不带认证的代理 URL
  if (type === "socks5") {
    return `socks5://${host}:${port}`;
  }

  return `http://${host}:${port}`;
}

/**
 * 将代理转换为 HTTP 代理
 * - HTTP 代理：直接回傳
 * - SOCKS5 代理：使用 proxy-chain 转换为本地 HTTP 代理
 * @param {object} proxyConfig - 代理配置物件
 * @returns {Promise<string|null>} - 转换后的 HTTP 代理 URL，如果无需代理则回傳 null
 */
export async function getHttpProxy(proxyConfig) {
  if (!proxyConfig || !proxyConfig.enable) {
    return null;
  }

  const { type, host, port } = proxyConfig;
  const originalUrl = buildProxyUrl(proxyConfig);

  // 如果是 HTTP 代理，直接回傳
  if (type === "http") {
    logger.debug("代理器", `使用 HTTP 代理: ${host}:${port}`);
    return originalUrl;
  }

  // 如果是 SOCKS5 代理，需要转换为 HTTP 代理
  if (type === "socks5") {
    try {
      logger.info(
        "代理器",
        `偵測到 SOCKS5 代理，正在转换为 HTTP 代理: ${host}:${port}`,
      );
      const httpProxyUrl = await anonymizeProxy(originalUrl);

      // 儲存状态用于后续清理
      proxyState.anonymizedProxyUrl = httpProxyUrl;
      proxyState.originalProxyUrl = originalUrl;

      logger.info("代理器", `SOCKS5 代理已转换为 HTTP 代理: ${httpProxyUrl}`);
      return httpProxyUrl;
    } catch (error) {
      logger.error("代理器", `SOCKS5 代理转换失败: ${error.message}`);
      throw error;
    }
  }

  logger.warn("代理器", `不支援的代理類型: ${type}`);
  return null;
}

/**
 * 取得用于瀏覽器的代理配置
 * 回傳 Playwright 可以使用的代理物件
 * @param {object} proxyConfig - 代理配置物件
 * @returns {Promise<object|null>} - Playwright 代理配置物件
 */
export async function getBrowserProxy(proxyConfig) {
  if (!proxyConfig || !proxyConfig.enable) {
    return null;
  }

  const { type, host, port, user, passwd } = proxyConfig;

  // 构建代理 URL 字串
  // 注意：Camoufox 对 socks5:// 协议使用 new URL().origin 会回傳 null
  // 因此我们直接回傳完整的 URL 字串，让 Camoufox 使用 new URL().href
  let proxyUrl;
  if (user && passwd) {
    // 带认证的代理格式: protocol://user:passwd@host:port
    const protocol = type === "socks5" ? "socks5" : "http";
    proxyUrl = `${protocol}://${encodeURIComponent(user)}:${encodeURIComponent(passwd)}@${host}:${port}`;
  } else {
    // 不带认证的代理格式: protocol://host:port
    if (type === "socks5") {
      proxyUrl = `socks5://${host}:${port}`;
    } else {
      proxyUrl = `http://${host}:${port}`;
    }
  }

  logger.info(
    "代理器",
    `代理配置: ${type}://${host}:${port}${user ? " (带认证)" : ""}`,
  );

  // 直接回傳字串格式，Camoufox 会正确解析
  return proxyUrl;
}

/**
 * 清理代理資源
 * 關閉由 proxy-chain 建立的本地代理服务器
 */
export async function cleanupProxy() {
  if (proxyState.anonymizedProxyUrl) {
    try {
      logger.debug("代理器", "正在關閉本地代理桥接...");
      await closeAnonymizedProxy(proxyState.anonymizedProxyUrl, true);
      logger.debug("代理器", "本地代理桥接已關閉");

      // 清理状态
      proxyState.anonymizedProxyUrl = null;
      proxyState.originalProxyUrl = null;
    } catch (error) {
      logger.error("代理器", `關閉本地代理桥接失败: ${error.message}`);
    }
  }
}

/**
 * 从配置檔案讀取代理配置
 * @param {object} config - 配置物件
 * @returns {object|null} - 代理配置物件或 null
 */
export function getProxyConfig(config) {
  if (config?.browser?.proxy?.enable) {
    return config.browser.proxy;
  }
  return null;
}
