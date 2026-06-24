/**
 * @fileoverview 配置校驗模塊
 * @description 對前端提交的配置進行嚴格校驗
 */

import { registry } from '../backend/registry.js';

/**
 * 校驗 Server 配置
 * @param {object} data - 伺服器配置
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateServerConfig(data) {
    const errors = [];

    // 埠號校驗
    if (data.port !== undefined) {
        if (typeof data.port !== 'number' || !Number.isInteger(data.port)) {
            errors.push('port 必須是整數');
        } else if (data.port < 1 || data.port > 65535) {
            errors.push('port 必須在 1-65535 範圍內');
        }
    }

    // Auth Token 校驗：允許留空，但非空時必須至少 10 個字元
    if (data.authToken !== undefined) {
        if (typeof data.authToken !== 'string') {
            errors.push('authToken 必須是字串');
        } else if (data.authToken.length > 0 && data.authToken.length < 10) {
            errors.push('authToken 如果設置則必須至少 10 個字元，或留空');
        }
    }

    // Keepalive Mode 校驗
    if (data.keepaliveMode !== undefined) {
        if (!['comment', 'content'].includes(data.keepaliveMode)) {
            errors.push('keepaliveMode 必須是 comment 或 content');
        }
    }

    // Log Level 校驗
    if (data.logLevel !== undefined) {
        if (!['debug', 'info', 'warn', 'error'].includes(data.logLevel)) {
            errors.push('logLevel 必須是 debug、info、warn 或 error');
        }
    }

    // Queue Buffer 校驗
    if (data.queueBuffer !== undefined) {
        if (typeof data.queueBuffer !== 'number' || !Number.isInteger(data.queueBuffer)) {
            errors.push('queueBuffer 必須是整數');
        } else if (data.queueBuffer < 0) {
            errors.push('queueBuffer 不能為負數');
        }
    }

    // Image Limit 校驗
    if (data.imageLimit !== undefined) {
        if (typeof data.imageLimit !== 'number' || !Number.isInteger(data.imageLimit)) {
            errors.push('imageLimit 必須是整數');
        } else if (data.imageLimit < 1 || data.imageLimit > 10) {
            errors.push('imageLimit 必須在 1-10 範圍內');
        }
    }

    // Image Markdown 校驗
    if (data.imageMarkdown !== undefined && typeof data.imageMarkdown !== 'boolean') {
        errors.push('imageMarkdown 必須是布爾值');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 校驗 Browser 配置
 * @param {object} data - 瀏覽器配置
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateBrowserConfig(data) {
    const errors = [];

    // Path 校驗（可選，字串）
    if (data.path !== undefined && typeof data.path !== 'string') {
        errors.push('path 必須是字串');
    }

    // Headless 校驗
    if (data.headless !== undefined && typeof data.headless !== 'boolean') {
        errors.push('headless 必須是布爾值');
    }

    // Fission 校驗
    if (data.fission !== undefined && typeof data.fission !== 'boolean') {
        errors.push('fission 必須是布爾值');
    }

    // Proxy 校驗
    if (data.proxy) {
        if (data.proxy.enable !== undefined && typeof data.proxy.enable !== 'boolean') {
            errors.push('proxy.enable 必須是布爾值');
        }
        if (data.proxy.type !== undefined && !['http', 'socks5'].includes(data.proxy.type)) {
            errors.push('proxy.type 必須是 http 或 socks5');
        }
        if (data.proxy.port !== undefined) {
            if (typeof data.proxy.port !== 'number' || !Number.isInteger(data.proxy.port)) {
                errors.push('proxy.port 必須是整數');
            } else if (data.proxy.port < 1 || data.proxy.port > 65535) {
                errors.push('proxy.port 必須在 1-65535 範圍內');
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 校驗 Instances 配置
 * @param {object[]} data - 實例配置列表
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateInstancesConfig(data) {
    const errors = [];

    if (!Array.isArray(data)) {
        return { valid: false, errors: ['instances 必須是陣列'] };
    }

    if (data.length === 0) {
        return { valid: false, errors: ['instances 不能為空陣列'] };
    }

    const instanceNames = new Set();
    const workerNames = new Set();

    // 獲取有效的適配器類型列表
    const validAdapterTypes = new Set(registry.getAdapterIds());
    validAdapterTypes.add('merge'); // merge 是特殊類型

    for (let i = 0; i < data.length; i++) {
        const inst = data[i];
        const prefix = `instances[${i}]`;

        // Instance 名稱校驗
        if (!inst.name || typeof inst.name !== 'string') {
            errors.push(`${prefix}: name 是必填字段且必須是字串`);
        } else if (inst.name.trim() === '') {
            errors.push(`${prefix}: name 不能為空`);
        } else if (instanceNames.has(inst.name)) {
            errors.push(`${prefix}: Instance 名稱 "${inst.name}" 重複`);
        } else {
            instanceNames.add(inst.name);
        }

        // userDataMark 校驗（可選，可為空）
        if (inst.userDataMark !== undefined && inst.userDataMark !== null && inst.userDataMark !== '') {
            if (typeof inst.userDataMark !== 'string') {
                errors.push(`${prefix}: userDataMark 必須是字串`);
            } else if (!/^[a-zA-Z0-9_-]+$/.test(inst.userDataMark)) {
                errors.push(`${prefix}: userDataMark 只能包含字母、數字、下劃線和連字元`);
            }
        }

        // Proxy 校驗（可選）
        if (inst.proxy) {
            if (inst.proxy.enable !== undefined && typeof inst.proxy.enable !== 'boolean') {
                errors.push(`${prefix}.proxy: enable 必須是布爾值`);
            }
            if (inst.proxy.type !== undefined && !['http', 'socks5'].includes(inst.proxy.type)) {
                errors.push(`${prefix}.proxy: type 必須是 http 或 socks5`);
            }
            if (inst.proxy.port !== undefined) {
                if (typeof inst.proxy.port !== 'number') {
                    errors.push(`${prefix}.proxy: port 必須是數字`);
                } else if (inst.proxy.port < 1 || inst.proxy.port > 65535) {
                    errors.push(`${prefix}.proxy: port 必須在 1-65535 範圍內`);
                }
            }
        }

        // Workers 校驗
        if (!inst.workers || !Array.isArray(inst.workers)) {
            errors.push(`${prefix}: workers 是必填字段且必須是陣列`);
        } else if (inst.workers.length === 0) {
            errors.push(`${prefix}: workers 不能為空陣列`);
        } else {
            for (let j = 0; j < inst.workers.length; j++) {
                const w = inst.workers[j];
                const wPrefix = `${prefix}.workers[${j}]`;

                // Worker 名稱校驗
                if (!w.name || typeof w.name !== 'string') {
                    errors.push(`${wPrefix}: name 是必填字段`);
                } else if (w.name.trim() === '') {
                    errors.push(`${wPrefix}: name 不能為空`);
                } else if (workerNames.has(w.name)) {
                    errors.push(`${wPrefix}: Worker 名稱 "${w.name}" 全域重複（Worker 名稱必須全域唯一）`);
                } else {
                    workerNames.add(w.name);
                }

                // Worker type 校驗
                if (!w.type || typeof w.type !== 'string') {
                    errors.push(`${wPrefix}: type 是必填字段`);
                } else if (!validAdapterTypes.has(w.type)) {
                    errors.push(`${wPrefix}: type "${w.type}" 不是有效的適配器類型`);
                }

                // merge 類型特殊校驗
                if (w.type === 'merge') {
                    if (!w.mergeTypes || !Array.isArray(w.mergeTypes) || w.mergeTypes.length === 0) {
                        errors.push(`${wPrefix}: merge 類型必須指定 mergeTypes 陣列`);
                    } else {
                        for (const mt of w.mergeTypes) {
                            if (!validAdapterTypes.has(mt) || mt === 'merge') {
                                errors.push(`${wPrefix}: mergeTypes 中的 "${mt}" 不是有效的適配器類型`);
                            }
                        }
                    }
                    if (w.mergeMonitor && !w.mergeTypes?.includes(w.mergeMonitor)) {
                        errors.push(`${wPrefix}: mergeMonitor "${w.mergeMonitor}" 必須是 mergeTypes 中的一個`);
                    }
                }
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 校驗 Pool 配置
 * @param {object} data - Pool 配置
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validatePoolConfig(data) {
    const errors = [];

    // Strategy 校驗
    if (data.strategy !== undefined) {
        if (!['least_busy', 'round_robin', 'random'].includes(data.strategy)) {
            errors.push('strategy 必須是 least_busy、round_robin 或 random');
        }
    }

    // Failover 校驗
    if (data.failover) {
        if (data.failover.enabled !== undefined && typeof data.failover.enabled !== 'boolean') {
            errors.push('failover.enabled 必須是布爾值');
        }
        if (data.failover.maxRetries !== undefined) {
            if (typeof data.failover.maxRetries !== 'number' || !Number.isInteger(data.failover.maxRetries)) {
                errors.push('failover.maxRetries 必須是整數');
            } else if (data.failover.maxRetries < 0) {
                errors.push('failover.maxRetries 不能為負數');
            }
        }
        if (data.failover.imgDlRetry !== undefined && typeof data.failover.imgDlRetry !== 'boolean') {
            errors.push('failover.imgDlRetry 必須是布爾值');
        }
        if (data.failover.imgDlRetryMaxRetries !== undefined) {
            if (typeof data.failover.imgDlRetryMaxRetries !== 'number' || !Number.isInteger(data.failover.imgDlRetryMaxRetries)) {
                errors.push('failover.imgDlRetryMaxRetries 必須是整數');
            } else if (data.failover.imgDlRetryMaxRetries < 1 || data.failover.imgDlRetryMaxRetries > 10) {
                errors.push('failover.imgDlRetryMaxRetries 必須在 1-10 範圍內');
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 校驗 Adapters 配置
 * @param {object} data - 適配器配置
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateAdaptersConfig(data) {
    const errors = [];

    if (typeof data !== 'object' || data === null) {
        return { valid: false, errors: ['adapters 配置必須是對象'] };
    }

    // gemini_biz 配置校驗
    if (data.gemini_biz) {
        if (data.gemini_biz.entryUrl !== undefined) {
            if (typeof data.gemini_biz.entryUrl !== 'string') {
                errors.push('gemini_biz.entryUrl 必須是字串');
            } else if (data.gemini_biz.entryUrl && !data.gemini_biz.entryUrl.startsWith('https://')) {
                errors.push('gemini_biz.entryUrl 必須以 https:// 開頭');
            }
        }
    }

    return { valid: errors.length === 0, errors };
}
