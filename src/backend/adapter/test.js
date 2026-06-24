/**
 * @fileoverview 瀏覽器测试配接器
 * 提供多种瀏覽器测试功能，包括 Cloudflare Turnstile 验证、指纹偵測等
 * 
 * 模型類型:
 * - cloudflare-turnstile: 點擊验证后截屏
 * - 其他 image 類型: 載入页面后截屏
 * - text 類型: 回傳页面文本内容
 */

import { sleep } from '../engine/utils.js';
import {
    gotoWithCheck,
    normalizePageError
} from '../utils/index.js';
import { clickTurnstile } from '../utils/CloudflareBypass.js';
import { logger } from '../../utils/logger.js';

/**
 * 執行 Turnstile 验证并截屏
 */
async function handleTurnstile(page, meta) {
    const TARGET_URL = 'https://nopecha.com/captcha/turnstile';
    const HOST_SELECTOR = '#example-container5';

    logger.info('配接器', '开启 Turnstile 测试...', meta);
    await gotoWithCheck(page, TARGET_URL);

    // 等待页面載入
    await sleep(3000, 4000);

    // 使用通用 Cloudflare 验证码點擊器
    const result = await clickTurnstile(page, HOST_SELECTOR, {
        timeout: 10000,
        waitAfterClick: 3000,
        meta
    });

    if (!result.success) {
        return { error: result.error };
    }

    // 截屏并回傳
    logger.info('配接器', '正在截屏...', meta);
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    const base64 = screenshot.toString('base64');

    return { image: `data:image/png;base64,${base64}` };
}

/**
 * 处理普通 image 類型：載入页面后截屏
 */
async function handleImagePage(page, url, meta) {
    logger.info('配接器', `正在載入页面: ${url}`, meta);
    await gotoWithCheck(page, url);

    // 等待页面載入完成
    await sleep(3000, 5000);

    // 截屏并回傳
    logger.info('配接器', '正在截屏...', meta);
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    const base64 = screenshot.toString('base64');

    return { image: `data:image/png;base64,${base64}` };
}

/**
 * 处理 ping0.cc：偵測并处理 Cloudflare 验证后截屏
 */
async function handlePing0(page, url, meta) {
    logger.info('配接器', `正在載入页面: ${url}`, meta);
    await gotoWithCheck(page, url);

    // 等待页面載入
    await sleep(2000, 3000);

    // 偵測是否有 Cloudflare 验证码
    const cfElement = await page.$('#captcha-element');
    if (cfElement) {
        logger.info('配接器', '偵測到 Cloudflare 验证码，正在处理...', meta);

        const result = await clickTurnstile(page, '#captcha-element', {
            timeout: 10000,
            waitAfterClick: 5000,
            meta
        });

        if (!result.success) {
            logger.warn('配接器', `Cloudflare 验证失败: ${result.error}`, meta);
            // 继续截屏，可能验证页面也有价值
        }

        // 等待页面跳转或刷新
        await sleep(3000, 5000);
    }

    // 截屏并回傳
    logger.info('配接器', '正在截屏...', meta);
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    const base64 = screenshot.toString('base64');

    return { image: `data:image/png;base64,${base64}` };
}

/**
 * 处理 text 類型：回傳页面文本内容
 */
async function handleTextPage(page, url, meta) {
    logger.info('配接器', `正在載入页面: ${url}`, meta);
    await gotoWithCheck(page, url);

    // 等待页面載入完成
    await sleep(1000, 2000);

    // 取得页面文本内容
    const textContent = await page.evaluate(() => document.body.innerText);
    logger.info('配接器', `取得文本内容，长度: ${textContent.length}`, meta);

    return { text: textContent.trim() };
}

/**
 * 主生成函式
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;

    try {
        // 查找模型配置
        const modelConfig = manifest.models.find(m => m.id === modelId);
        if (!modelConfig) {
            return { error: `未找到模型配置: ${modelId}` };
        }

        const { url, type } = modelConfig;

        // 根据模型 ID 和類型分发处理
        switch (modelId) {
            case 'cloudflare-turnstile':
                return await handleTurnstile(page, meta);
            case 'ping0':
                return await handlePing0(page, url, meta);
            default:
                // 根据類型分发
                return type === 'text'
                    ? await handleTextPage(page, url, meta)
                    : await handleImagePage(page, url, meta);
        }

    } catch (err) {
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('配接器', '任务失败', { ...meta, error: err.message });
        return { error: `任务失败: ${err.message}` };
    } finally { }
}

/**
 * 配接器 manifest
 */
export const manifest = {
    id: 'test',
    displayName: '瀏覽器偵測，仅供调试使用',
    description: '包含 Cloudflare Turnstile 验证测试、瀏覽器指纹偵測、IP 纯净度查询等功能，仅供调试使用。',

    getTargetUrl(config, workerConfig) {
        return 'https://abrahamjuliot.github.io/creepjs/';
    },

    models: [
        { id: 'cloudflare-turnstile', imagePolicy: 'forbidden', type: 'image', url: 'https://nopecha.com/captcha/turnstile' },
        { id: 'creepjs', imagePolicy: 'forbidden', type: 'image', url: 'https://abrahamjuliot.github.io/creepjs/' },
        { id: 'antibot', imagePolicy: 'forbidden', type: 'image', url: 'https://bot.sannysoft.com/' },
        { id: 'browserleaks-js', imagePolicy: 'forbidden', type: 'image', url: 'https://browserleaks.com/javascript' },
        { id: 'browserleaks-ip', imagePolicy: 'forbidden', type: 'image', url: 'https://browserleaks.com/ip' },
        { id: 'ip', imagePolicy: 'forbidden', type: 'text', url: 'https://api.ip.sb/ip' },
        { id: 'webgl', imagePolicy: 'forbidden', type: 'image', url: 'https://get.webgl.org/' },
        { id: 'ping0', imagePolicy: 'forbidden', type: 'image', url: 'https://ping0.cc/' },
    ],

    navigationHandlers: [],
    generate
};
