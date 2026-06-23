/**
 * @fileoverview 生成 API Key（CLI）
 * @description 輸出一個新的 `server.auth` Key，供寫入 `config.yaml` 使用。
 *
 * 用法：`npm run genkey`
 */

import crypto from 'crypto';

/**
 * 生成隨機 API Key（用於 `config.yaml` 的 `server.auth`）
 * 格式：sk-{48位十六進制字元}
 * @returns {string} API Key
 */
function generateApiKey() {
    return 'sk-' + crypto.randomBytes(24).toString('hex');
}

console.log('>>> [GenAPIKey] 生成新的 API Key:');
console.log(generateApiKey());
console.log('\n>>> 請將此 Key 複製到 config.yaml 文件的 server.auth 欄位中。');
