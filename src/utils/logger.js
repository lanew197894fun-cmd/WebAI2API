/**
 * @fileoverview 控制台日誌模塊
 * @description 提供帶時間戳/級別/模塊名的彩色日誌輸出，並支援通過環境變數控制日誌級別。
 *
 * - 環境變數：LOG_LEVEL=debug|info|warn|error
 * - 輸出格式：YYYY-MM-DD HH:mm:ss.SSS [LEVEL] [模塊] 消息 | k=v ...
 * - 日誌檔案：data/logs/system.log（超過 5MB 自動輪轉）
 */

import process from 'process';
import fs from 'fs';
import path from 'path';

const LEVELS = ['debug', 'info', 'warn', 'error'];

// ANSI 顏色代碼
const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    white: '\x1b[37m'
};

// 日誌檔案配置
const LOG_DIR = path.join(process.cwd(), 'data', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'system.log');
const LOG_FILE_OLD = path.join(LOG_DIR, 'system.log.old');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

// 確保日誌目錄存在
function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

// 日誌輪轉：超過 5MB 時重命名為 .old
function rotateLogIfNeeded() {
    try {
        if (fs.existsSync(LOG_FILE)) {
            const stats = fs.statSync(LOG_FILE);
            if (stats.size >= MAX_LOG_SIZE) {
                // 刪除舊的 .old 檔案
                if (fs.existsSync(LOG_FILE_OLD)) {
                    fs.unlinkSync(LOG_FILE_OLD);
                }
                // 重命名當前日誌
                fs.renameSync(LOG_FILE, LOG_FILE_OLD);
            }
        }
    } catch (e) {
        // 忽略輪轉錯誤
    }
}

// 寫入日誌檔案
function writeToFile(line) {
    try {
        ensureLogDir();
        rotateLogIfNeeded();
        fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
    } catch (e) {
        // 忽略寫入錯誤
    }
}

// 根據日誌級別獲取顏色
function getColor(level) {
    switch (level.toLowerCase()) {
        case 'error':
            return COLORS.red;
        case 'warn':
            return COLORS.yellow;
        case 'info':
            return COLORS.white;
        case 'debug':
            return COLORS.blue;
        default:
            return COLORS.reset;
    }
}

function formatTime(date = new Date()) {
    const pad = (n, len = 2) => n.toString().padStart(len, '0');
    const yyyy = date.getFullYear();
    const MM = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const HH = pad(date.getHours());
    const mm = pad(date.getMinutes());
    const ss = pad(date.getSeconds());
    const SSS = pad(date.getMilliseconds(), 3);
    return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}.${SSS}`;
}

let currentLogLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();

export function setLogLevel(level) {
    if (level && LEVELS.includes(level.toLowerCase())) {
        currentLogLevel = level.toLowerCase();
    }
}

function shouldLog(level) {
    const targetLevel = level.toLowerCase();
    const envIndex = LEVELS.indexOf(currentLogLevel);
    const targetIndex = LEVELS.indexOf(targetLevel);

    // 如果環境級別無效，預設為 info (index 1)
    const effectiveEnvIndex = envIndex === -1 ? 1 : envIndex;

    return targetIndex >= effectiveEnvIndex;
}

// 需要提取到前面用方括號顯示的 meta 字段
const FRONT_META_KEYS = ['id', 'adapter', 'model'];

export function log(level, mod, msg, meta = {}) {
    if (!shouldLog(level)) return;

    const ts = formatTime();
    const levelMap = { debug: 'DBUG', info: 'INFO', warn: 'WARN', error: 'ERRO' };
    const levelTag = levelMap[level.toLowerCase()] || level.toUpperCase().slice(0, 4);

    // 將消息中的換行符替換為 ↵ 符號，保持日誌為單行
    const sanitizedMsg = msg.replace(/\r?\n/g, ' ↵ ');

    // 提取關鍵字段放在前面用方括號顯示
    const frontParts = [];
    const remainingMeta = {};
    for (const [k, v] of Object.entries(meta)) {
        if (FRONT_META_KEYS.includes(k) && v !== undefined && v !== null) {
            frontParts.push(`[${v}]`);
        } else {
            remainingMeta[k] = v;
        }
    }
    const frontStr = frontParts.length ? ' ' + frontParts.join(' ') : '';

    const base = `${ts} [${levelTag}] [${mod}]${frontStr} ${sanitizedMsg}`;

    const metaStr = Object.keys(remainingMeta).length
        ? ' | ' + Object.entries(remainingMeta).map(([k, v]) => {
            if (v instanceof Error) {
                return `${k}=${v.message}`;
            }
            if (typeof v === 'object' && v !== null) {
                try {
                    return `${k}=${JSON.stringify(v)}`;
                } catch (e) {
                    return `${k}=[Circular]`;
                }
            }
            return `${k}=${v}`;
        }).join(' ')
        : '';

    const line = base + metaStr;
    const color = getColor(level);
    const coloredLine = `${color}${line}${COLORS.reset}`;

    // 輸出到控制台
    if (level === 'error') {
        console.error(coloredLine);
    } else if (level === 'warn') {
        console.warn(coloredLine);
    } else {
        console.log(coloredLine);
    }

    // 寫入日誌檔案（不帶顏色）
    writeToFile(line);
}

/**
 * 取得日誌檔案路徑
 */
export function getLogPath() {
    return LOG_FILE;
}

/**
 * 取得旧日誌檔案路徑
 */
export function getOldLogPath() {
    return LOG_FILE_OLD;
}

/**
 * 清除日誌檔案
 */
export function clearLogs() {
    try {
        if (fs.existsSync(LOG_FILE)) {
            fs.unlinkSync(LOG_FILE);
        }
        if (fs.existsSync(LOG_FILE_OLD)) {
            fs.unlinkSync(LOG_FILE_OLD);
        }
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * 讀取日誌檔案（回傳最后 N 行）
 * @param {number} lines - 讀取行数
 * @returns {{logs: string[], total: number, file: string}}
 */
export function readLogs(lines = 200) {
    const result = { logs: [], total: 0, file: LOG_FILE };

    try {
        if (!fs.existsSync(LOG_FILE)) {
            return result;
        }

        const content = fs.readFileSync(LOG_FILE, 'utf8');
        const allLines = content.split('\n').filter(line => line.trim());
        result.total = allLines.length;

        // 回傳最后 N 行
        result.logs = allLines.slice(-lines);
    } catch (e) {
        // 忽略讀取錯誤
    }

    return result;
}

export const logger = {
    debug: (mod, msg, meta) => log('debug', mod, msg, meta),
    info: (mod, msg, meta) => log('info', mod, msg, meta),
    warn: (mod, msg, meta) => log('warn', mod, msg, meta),
    error: (mod, msg, meta) => log('error', mod, msg, meta),
    setLevel: setLogLevel,
    getLogPath,
    getOldLogPath,
    clearLogs,
    readLogs
};

