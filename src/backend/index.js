/**
 * @fileoverview 后端配接器入口
 * @description 基於 Pool 架构统一管理多瀏覽器实例，提供统一的对外介面。
 *
 * 对外统一能力：
 * - `initBrowser(cfg)` → 初始化 Pool
 * - `generate(ctx, prompt, imagePaths, modelId, meta)`
 * - `getModels()` / `getImagePolicy(modelKey)` / `getModelType(modelKey)`
 * - `getCookies(workerName, domain)` - 取得指定 Worker 的 Cookies
 */

import fs from 'fs';
import path from 'path';
import { loadConfig } from '../config/index.js';
import { PoolManager } from './pool/index.js';
import { logger } from '../utils/logger.js';

// --- 集中管理的路徑常量 ---
const TEMP_DIR = path.join(process.cwd(), 'data', 'temp');

// 确保临时目錄存在
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// 全局 PoolManager 实例
let poolManager = null;

/**
 * 取得后端介面
 * @returns {object} 后端统一介面
 */
export function getBackend() {
    const config = loadConfig();

    // 将临时目錄路徑注入 config 物件
    config.paths = {
        tempDir: TEMP_DIR
    };

    return {
        name: 'pool',
        config,
        TEMP_DIR,

        /**
         * 初始化 Pool
         * @param {object} cfg - 配置物件
         * @returns {Promise<{poolManager: PoolManager, config: object}>}
         */
        initBrowser: async (cfg) => {
            if (poolManager && poolManager.initialized) {
                return { poolManager, config: cfg };
            }

            poolManager = new PoolManager(cfg);
            await poolManager.initAll();

            return { poolManager, config: cfg };
        },

        /**
         * 生成圖片
         * @param {object} ctx - 瀏覽器上下文 (来自 initBrowser 回傳)
         * @param {string} prompt - 提示詞
         * @param {string[]} paths - 圖片路徑
         * @param {string} modelId - 模型 ID
         * @param {object} meta - 元資訊
         */
        generate: async (ctx, prompt, paths, modelId, meta) => {
            if (!poolManager) {
                return { error: 'Pool 未初始化' };
            }
            return await poolManager.generate(ctx, prompt, paths, modelId, meta);
        },

        /**
         * 取得模型列表
         * @returns {object}
         */
        getModels: () => {
            if (!poolManager) {
                return { object: 'list', data: [] };
            }
            return poolManager.getModels();
        },

        /**
         * 取得圖片策略
         * @param {string} modelKey - 模型 key
         * @returns {string}
         */
        getImagePolicy: (modelKey) => {
            if (!poolManager) {
                return 'optional';
            }
            return poolManager.getImagePolicy(modelKey);
        },

        /**
         * 取得模型類型
         * @param {string} modelKey - 模型 key
         * @returns {string} 'text' | 'image'
         */
        getModelType: (modelKey) => {
            if (!poolManager) {
                return 'image';
            }
            return poolManager.getModelType(modelKey);
        },

        /**
         * 取得 Cookies
         * @param {string} [workerName] - Worker 名称
         * @param {string} [domain] - 域名
         * @returns {Promise<{worker: string, cookies: object[]}>}
         */
        getCookies: async (workerName, domain) => {
            if (!poolManager) {
                throw new Error('Pool 未初始化');
            }
            return await poolManager.getCookies(workerName, domain);
        },

        /**
         * 触发監控导航（空闲时）
         */
        navigateToMonitor: async () => {
            if (poolManager) {
                await poolManager.navigateToMonitor();
            }
        },

        /**
         * 取得 PoolManager 实例
         * @returns {PoolManager|null}
         */
        getPoolManager: () => poolManager
    };
}
