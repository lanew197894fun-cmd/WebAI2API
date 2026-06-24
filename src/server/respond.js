/**
 * @fileoverview 统一回應写出模組
 * @description 封装 JSON、SSE 回應和錯誤回應的统一处理函式
 */

import { getErrorDetails } from './errors.js';

/**
 * 发送 JSON 回應
 * @param {import('http').ServerResponse} res - HTTP 回應物件
 * @param {number} status - HTTP 状态码
 * @param {object} payload - 回應数据
 */
export function sendJson(res, status, payload) {
    if (res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

/**
 * 发送 SSE 事件
 * @param {import('http').ServerResponse} res - HTTP 回應物件
 * @param {object} payload - 事件数据
 */
export function sendSse(res, payload) {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * 发送 SSE 结束标记
 * @param {import('http').ServerResponse} res - HTTP 回應物件
 */
export function sendSseDone(res) {
    if (res.writableEnded) return;
    res.write(`data: [DONE]\n\n`);
    res.end();
}

/**
 * 发送 SSE 心跳包
 * @param {import('http').ServerResponse} res - HTTP 回應物件
 * @param {string} mode - 心跳模式 ('comment' | 'content')
 * @param {string} [modelName] - 模型名称（content 模式需要）
 */
export function sendHeartbeat(res, mode, modelName) {
    if (res.writableEnded) return;

    if (mode === 'comment') {
        res.write(`:keepalive\n\n`);
    } else {
        // content 模式：发送空 delta
        const chunk = {
            id: 'chatcmpl-' + Date.now(),
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelName || 'default-model',
            choices: [{
                index: 0,
                delta: { content: '' },
                finish_reason: null
            }]
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
}

/**
 * 发送统一 API 錯誤回應 (OpenAI 标准格式)
 * @param {import('http').ServerResponse} res - HTTP 回應物件
 * @param {object} options - 錯誤选项
 * @param {string} [options.code] - 錯誤码（使用 ERROR_CODES 枚举）
 * @param {string} [options.message] - 自定义錯誤消息（如提供则覆盖 code 对应的消息）
 * @param {number} [options.status] - 自定义 HTTP 状态码
 * @param {boolean} [options.isStreaming=false] - 是否为流式回應
 */
export function sendApiError(res, options) {
    const { code, message, status, isStreaming = false } = options;

    // 取得錯誤详情
    const details = code ? getErrorDetails(code) : null;
    const errorMessage = message || (details ? details.message : '未知錯誤');
    const errorType = details?.type || 'server_error';
    const httpStatus = status || (details ? details.status : 500);

    // 构造 OpenAI 标准錯誤回應体
    const payload = {
        error: {
            message: errorMessage,
            type: errorType,
            code: code || 'INTERNAL_ERROR'
        }
    };

    if (isStreaming) {
        // 流式回應：发送錯誤事件然后结束
        sendSse(res, payload);
        sendSseDone(res);
    } else {
        // 非流式回應
        sendJson(res, httpStatus, payload);
    }
}

/**
 * 构造 OpenAI 格式的聊天完成回應（非流式）
 * @param {string} content - 回應内容
 * @param {string} [modelName] - 模型名称
 * @param {string} [reasoningContent] - 思考/推理过程内容 (OpenAI o1 格式)
 * @returns {object} OpenAI 格式的回應物件
 */
export function buildChatCompletion(content, modelName, reasoningContent) {
    const message = {
        role: 'assistant',
        content: content
    };
    if (reasoningContent) {
        message.reasoning_content = reasoningContent;
    }

    return {
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelName || 'default-model',
        choices: [{
            index: 0,
            message,
            finish_reason: 'stop'
        }]
    };
}

/**
 * 构造 OpenAI 格式的流式聊天完成回應块
 * @param {string} content - 回應内容
 * @param {string} [modelName] - 模型名称
 * @param {string|null} [finishReason='stop'] - 完成原因
 * @param {string} [reasoningContent] - 思考/推理过程内容 (OpenAI o1 格式)
 * @returns {object} OpenAI 格式的流式回應块
 */
export function buildChatCompletionChunk(content, modelName, finishReason = 'stop', reasoningContent) {
    const delta = { content };
    if (reasoningContent) {
        delta.reasoning_content = reasoningContent;
    }

    return {
        id: 'chatcmpl-' + Date.now(),
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName || 'default-model',
        choices: [{
            index: 0,
            delta,
            finish_reason: finishReason
        }]
    };
}
