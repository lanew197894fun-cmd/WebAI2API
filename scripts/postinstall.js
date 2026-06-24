/**
 * @fileoverview npm postinstall 鉤子腳本
 * @description 在 `npm install` 後自動應用 camoufox-js 補丁。
 *
 * 用法：在 package.json scripts 中配置 "postinstall": "node scripts/postinstall.js"
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, "..");

// 簡易日誌
const log = (msg) => console.log(`[postinstall] ${msg}`);
const warn = (msg) => console.warn(`[postinstall] ⚠️ ${msg}`);
const error = (msg) => console.error(`[postinstall] ❌ ${msg}`);

/**
 * 補丁檔案映射: 來源檔案名 -> 目標檔案名
 * 供 preflight.js 自檢系統複用
 */
export const CAMOUFOX_PATCHES = {
  "camoufox-js@0.8.3.locale.patched.js": "locale.js",
  "camoufox-js@0.8.3.pkgman.patched.js": "pkgman.js",
  "camoufox-js@0.8.3.utils.patched.js": "utils.js", // SOCKS5 代理修復
};

/**
 * 複製 camoufox-js 補丁檔案到 node_modules
 */
function patchCamoufoxJs() {
  log("正在應用 camoufox-js 補丁...");

  const patchDir = path.join(PROJECT_ROOT, "patches");
  const targetDir = path.join(
    PROJECT_ROOT,
    "node_modules",
    "camoufox-js",
    "dist",
  );

  // 檢查目標目錄是否存在
  if (!fs.existsSync(targetDir)) {
    warn(`目標目錄不存在: ${targetDir}`);
    warn("camoufox-js 可能未安裝，跳過補丁。");
    return;
  }

  for (const [srcName, destName] of Object.entries(CAMOUFOX_PATCHES)) {
    const srcPath = path.join(patchDir, srcName);
    const destPath = path.join(targetDir, destName);

    if (!fs.existsSync(srcPath)) {
      warn(`補丁檔案不存在: ${srcPath}`);
      continue;
    }

    try {
      fs.copyFileSync(srcPath, destPath);
      log(`已應用補丁: ${srcName} -> ${destName}`);
    } catch (e) {
      error(`應用補丁失敗: ${e.message}`);
    }
  }

  log("補丁應用完成。");
}

import { fileURLToPath as _fileURLToPath } from "url";
const isMainModule = process.argv[1] === _fileURLToPath(import.meta.url);
if (isMainModule) {
  patchCamoufoxJs();
}
