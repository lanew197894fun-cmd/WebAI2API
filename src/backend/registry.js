/**
 * @fileoverview 適配器註冊表
 * @description 自動掃描 adapter/ 目錄，載入所有適配器的 manifest，提供統一查詢介面。
 *
 * 設計目標：
 * - 新增適配器只需在 adapter/ 目錄添加文件，無需修改框架代碼
 * - 提供模型查詢、策略查詢、導航處理器聚合等統一介面
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

// 获取当前目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADAPTER_DIR = path.join(__dirname, 'adapter');

/**
     * 圖片輸入策略列舉
     */
    export const IMAGE_POLICY = {
        OPTIONAL: 'optional',
        REQUIRED: 'required',
        FORBIDDEN: 'forbidden'
    };

/**
     * 適配器註冊表類
     */
    class AdapterRegistry {
        constructor() {
            /** @type {Map<string, object>} */
            this.adapters = new Map();
            /** @type {object} 適配器配置（來自 config.yaml） */
            this.adapterConfig = {};
            this.loaded = false;
        }

    /**
     * 設定適配器配置
     * @param {object} config - 適配器配置對象
     */
    setAdapterConfig(config) {
        this.adapterConfig = config || {};
    }

    /**
     * 檢查模型是否啟用
     * @param {string} adapterId - 適配器 ID
     * @param {string} modelId - 模型 ID
     * @returns {boolean}
     */
    isModelEnabled(adapterId, modelId) {
        const adapterCfg = this.adapterConfig[adapterId];
        if (!adapterCfg?.modelFilter) return true;

        const { mode, list } = adapterCfg.modelFilter;
        if (!list || !Array.isArray(list)) return true;

        const inList = list.includes(modelId);

        if (mode === 'whitelist') {
            // 白名單模式：只有在列表中的才啟用
            return inList;
        } else {
            // 黑名單模式（預設）：在列表中的被禁用
            return !inList;
        }
    }

    /**
     * 掃描並載入所有適配器
     */
    async loadAll() {
        if (this.loaded) return;

        //logger.info('註冊表', `正在掃描適配器目錄: ${ADAPTER_DIR}`);
        logger.info('註冊表', `正在掃描適配器目錄...`);

        const files = fs.readdirSync(ADAPTER_DIR).filter(f => f.endsWith('.js'));

        for (const file of files) {
            const filePath = path.join(ADAPTER_DIR, file);
            try {
                const module = await import(`file://${filePath}`);

                if (!module.manifest) {
                    logger.warn('註冊表', `跳過 ${file}: 未導出 manifest`);
                    continue;
                }

                const manifest = module.manifest;

                // 校驗必需字段
                if (!this.validateManifest(manifest, file)) {
                    continue;
                }

                this.adapters.set(manifest.id, manifest);
                logger.debug('註冊表', `已載入適配器: ${manifest.id} (${manifest.displayName || file})`);

            } catch (err) {
                logger.error('註冊表', `載入 ${file} 失敗: ${err.message}`);
            }
        }

        this.loaded = true;
        logger.info('註冊表', `適配器載入完成，共 ${this.adapters.size} 個可用`);
    }

    /**
     * 校驗 manifest 必需字段
     * @param {object} manifest
     * @param {string} fileName
     * @returns {boolean}
     */
    validateManifest(manifest, fileName) {
        const errors = [];

        if (!manifest.id || typeof manifest.id !== 'string') {
            errors.push('缺少 id 或類型不正確');
        }

        if (!manifest.generate || typeof manifest.generate !== 'function') {
            errors.push('缺少 generate 函數');
        }

        if (!manifest.models || !Array.isArray(manifest.models)) {
            errors.push('缺少 models 陣列');
        } else {
            for (let i = 0; i < manifest.models.length; i++) {
                const m = manifest.models[i];
                if (!m.id) {
                    errors.push(`models[${i}] 缺少 id`);
                }
                if (!m.imagePolicy || !Object.values(IMAGE_POLICY).includes(m.imagePolicy)) {
                    errors.push(`models[${i}] imagePolicy 無效`);
                }
            }
        }

        if (errors.length > 0) {
            logger.error('註冊表', `${fileName} manifest 校驗失敗: ${errors.join('; ')}`);
            return false;
        }

        return true;
    }

    /**
     * 獲取適配器
     * @param {string} id - 適配器 ID
     * @returns {object|null}
     */
    getAdapter(id) {
        return this.adapters.get(id) || null;
    }

    /**
     * 獲取所有已註冊的適配器 ID
     * @returns {string[]}
     */
    getAdapterIds() {
        return Array.from(this.adapters.keys());
    }

    /**
     * 檢查適配器是否存在
     * @param {string} id
     * @returns {boolean}
     */
    hasAdapter(id) {
        return this.adapters.has(id);
    }

    /**
     * 獲取適配器的目標 URL
     * @param {string} id - 適配器 ID
     * @param {object} config - 全局配置
     * @param {object} workerConfig - Worker 配置
     * @returns {string}
     */
    getTargetUrl(id, config, workerConfig) {
        const adapter = this.getAdapter(id);
        if (!adapter) return 'about:blank';

        if (typeof adapter.getTargetUrl === 'function') {
            return adapter.getTargetUrl(config, workerConfig) || 'about:blank';
        }

        return adapter.targetUrl || 'about:blank';
    }

    /**
     * 獲取適配器的導航處理器
     * @param {string} id - 適配器 ID
     * @returns {Function[]}
     */
    getNavigationHandlers(id) {
        const adapter = this.getAdapter(id);
        if (!adapter) return [];
        return adapter.navigationHandlers || [];
    }

    /**
     * 獲取適配器的輸入框就緒校驗函數
     * @param {string} id - 適配器 ID
     * @returns {Function|null}
     */
    getWaitInput(id) {
        const adapter = this.getAdapter(id);
        if (!adapter) return null;
        return adapter.waitInput || null;
    }

    /**
     * 獲取指定適配器的模型列表 (OpenAI 格式)
     * @param {string} id - 適配器 ID
     * @returns {object}
     */
    getModelsForAdapter(id) {
        const adapter = this.getAdapter(id);
        if (!adapter || !adapter.models) {
            return { object: 'list', data: [] };
        }

        const data = adapter.models
            .filter(m => this.isModelEnabled(id, m.id))
            .map(m => ({
                id: m.id,
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: id,
                image_policy: m.imagePolicy,
                type: m.type || 'image'
            }));

        return { object: 'list', data };
    }

    /**
     * 檢查適配器是否支援指定模型
     * @param {string} adapterId - 適配器 ID
     * @param {string} modelId - 模型 ID
     * @returns {boolean}
     */
    supportsModel(adapterId, modelId) {
        const adapter = this.getAdapter(adapterId);
        if (!adapter?.models) return false;
        // 檢查模型是否存在且未被禁用
        const modelExists = adapter.models.some(m => m.id === modelId);
        return modelExists && this.isModelEnabled(adapterId, modelId);
    }

    /**
     * 解析模型 ID（保留用於向後相容）
     * @param {string} adapterId - 適配器 ID
     * @param {string} modelKey - 模型 key
     * @returns {string|null} codeName，或 null
     * @deprecated 新架構下適配器自己解析，此方法主要用於向後相容
     */
    resolveModelId(adapterId, modelKey) {
        const adapter = this.getAdapter(adapterId);
        if (!adapter) return null;

        // 如果適配器還提供了 resolveModelId 函數，調用它
        if (typeof adapter.resolveModelId === 'function') {
            return adapter.resolveModelId(modelKey);
        }

        // 預設行為：查找模型並返回 codeName
        const model = adapter.models.find(m => m.id === modelKey);
        if (model) {
            return model.codeName || model.id;
        }

        return null;
    }

    /**
     * 獲取模型的圖片策略
     * @param {string} adapterId - 適配器 ID
     * @param {string} modelKey - 模型 key
     * @returns {string}
     */
    getImagePolicy(adapterId, modelKey) {
        const adapter = this.getAdapter(adapterId);
        if (!adapter || !adapter.models) {
            return IMAGE_POLICY.OPTIONAL;
        }

        const model = adapter.models.find(m => m.id === modelKey);
        return model?.imagePolicy || IMAGE_POLICY.OPTIONAL;
    }

    /**
     * 獲取模型的類型
     * @param {string} adapterId - 適配器 ID
     * @param {string} modelKey - 模型 key
     * @returns {string} 'text' | 'image'
     */
    getModelType(adapterId, modelKey) {
        const adapter = this.getAdapter(adapterId);
        if (!adapter || !adapter.models) {
            return 'image';
        }

        const model = adapter.models.find(m => m.id === modelKey);
        return model?.type || 'image';
    }

    /**
     * 聚合所有適配器的模型列表
     * @returns {object}
     */
    getAllModels() {
        const allModels = [];

        for (const [id, adapter] of this.adapters) {
            if (adapter.models) {
                for (const m of adapter.models) {
                    allModels.push({
                        id: m.id,
                        object: 'model',
                        created: Math.floor(Date.now() / 1000),
                        owned_by: id,
                        image_policy: m.imagePolicy,
                        type: m.type || 'image'
                    });
                }
            }
        }

        return { object: 'list', data: allModels };
    }
}

// 导出单例
const registry = new AdapterRegistry();

export { AdapterRegistry, registry };
