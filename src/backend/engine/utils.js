/**
 * @fileoverview 瀏覽器自动化工具函式
 * @description 封装 Playwright 页面常用操作，供后端配接器复用。
 *
 * 职责边界：
 * - 瀏覽器原子操作（點擊、輸入、上傳等）
 * - 页面状态偵測（isPageValid、createPageCloseWatcher）
 * - 拟人化交互（humanType、safeClick、safeScroll）
 * - 工具函式（random、sleep、getMimeType）
 *
 * 注意：业务逻辑应放在 backend/utils.js
 *
 * 主要函式：
 * - `random` / `sleep`：随机与延迟工具
 * - `getMimeType`：根据檔案扩展名推断 MIME
 * - `getRealViewport` / `clamp`：视口与坐标工具（防止越界）
 * - `queryDeep`：深层查询（包含 Shadow DOM / iframe）
 * - `safeClick` / `humanType`：拟人化點擊与輸入
 * - `pasteImages` / `uploadFilesViaChooser`：圖片粘贴/上傳辅助
 * - `isPageValid` / `createPageCloseWatcher`：页面有效性与關閉/崩溃监听
 */

import path from "path";
import { logger } from "../../utils/logger.js";
import { TIMEOUTS } from "../../utils/constants.js";

/**
 * 生成指定範圍内的随机数
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 随机数
 */
export function random(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * 随机休眠一段时间
 * @param {number} min - 最小毫秒数
 * @param {number} max - 最大毫秒数
 * @returns {Promise<void>}
 */
export function sleep(min, max) {
  return new Promise((r) => setTimeout(r, Math.floor(random(min, max))));
}

/**
 * 根据檔案扩展名取得 MIME 類型
 * @param {string} filePath - 檔案路徑
 * @returns {string} MIME 類型
 */
export function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

/**
 * 无痕取得当前页面实时视口
 * 使用纯净的匿名函式執行，不污染 Global Scope
 * @param {import('playwright-core').Page} page - Playwright 页面实例
 * @returns {Promise<{width: number, height: number, safeWidth: number, safeHeight: number}>} 视口尺寸及安全区域
 */
export async function getRealViewport(page) {
  try {
    return await page.evaluate(() => {
      // 仅讀取标准属性，不进行任何寫入操作
      const w = window.innerWidth;
      const h = window.innerHeight;
      return {
        width: w,
        height: h,
        // 预留 20px 缓冲，防止滑鼠移到滾動条上或贴边触发瀏覽器原生手势
        safeWidth: w - 20,
        safeHeight: h,
      };
    });
  } catch (e) {
    // Fallback: 如果上下文丢失，回傳安全保守值
    return { width: 1280, height: 720, safeWidth: 1260, safeHeight: 720 };
  }
}

/**
 * 坐标钳位函式
 * 强制将坐标限制在合法视口範圍内，防止 "Node is not visible" 报错
 * @param {number} value - 原始坐标值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 修正后的坐标值
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 深度查找 Shadow DOM 中的元素
 * @param {import('playwright-core').Page} page - Playwright 页面实例
 * @param {string} selector - CSS 选择器
 * @param {import('playwright-core').ElementHandle} [rootHandle=null] - 可选的根节点句柄
 * @returns {Promise<import('playwright-core').ElementHandle|null>} 找到的元素句柄或 null
 */
export async function queryDeep(page, selector, rootHandle = null) {
  // Playwright evaluateHandle 只接受一个参数，包装成陣列传递
  return await page.evaluateHandle(
    ([sel, root]) => {
      function find(node, s) {
        if (!node) return null;
        if (node instanceof Element && node.matches(s)) return node;
        let found = node.querySelector(s);
        if (found) return found;
        if (node.shadowRoot) {
          found = find(node.shadowRoot, s);
          if (found) return found;
        }
        const walker = document.createTreeWalker(
          node,
          NodeFilter.SHOW_ELEMENT,
          null,
          false,
        );
        while (walker.nextNode()) {
          const child = walker.currentNode;
          if (child.shadowRoot) {
            found = find(child.shadowRoot, s);
            if (found) return found;
          }
        }
        return null;
      }
      return find(root || document.body, sel);
    },
    [selector, rootHandle],
  );
}

/**
 * 计算拟人化的随机點擊坐标
 * @param {object} box - 元素边界框 {x, y, width, height}
 * @param {string} [type='random'] - 點擊類型:
 *   - 'input': 偏左偏底部 (5%-40% x, 60%-90% y)
 *   - 'center': 中心区域 (40%-60% x, 40%-60% y)
 *   - 'top-left': 偏左偏上 (10%-30% x, 10%-30% y)
 *   - 'top-right': 偏右偏上 (70%-90% x, 10%-30% y)
 *   - 'bottom-right': 偏右偏下 (70%-90% x, 70%-90% y)
 *   - 'random'/'button': 中心附近随机 (20%-80% x, 20%-80% y)
 * @returns {{x: number, y: number}} 计算出的坐标
 */
export function getHumanClickPoint(box, type = "random") {
  // 确保 box 有有效的尺寸
  if (!box || box.width <= 0 || box.height <= 0) {
    return { x: box?.x || 0, y: box?.y || 0 };
  }

  let xRatio, yRatio;
  switch (type) {
    case "input":
      // 輸入框: 偏左 (5% - 40% 宽度), 偏底部 (60% - 90% 高度)
      xRatio = random(0.05, 0.4);
      yRatio = random(0.6, 0.9);
      break;
    case "center":
      // 中心区域
      xRatio = random(0.4, 0.6);
      yRatio = random(0.4, 0.6);
      break;
    case "top-left":
      // 偏左偏上
      xRatio = random(0.1, 0.3);
      yRatio = random(0.1, 0.3);
      break;
    case "top-right":
      // 偏右偏上
      xRatio = random(0.7, 0.9);
      yRatio = random(0.1, 0.3);
      break;
    case "bottom-right":
      // 偏右偏下
      xRatio = random(0.7, 0.9);
      yRatio = random(0.7, 0.9);
      break;
    default:
      // 按钮/其他: 中心附近随机 (20% - 80% 宽度/高度)
      xRatio = random(0.2, 0.8);
      yRatio = random(0.2, 0.8);
  }

  // 边界检查：确保點擊位置在元素範圍内（留 1px 边距）
  let x = box.x + box.width * xRatio;
  let y = box.y + box.height * yRatio;

  // 限制在元素边界内（左右各留 1px）
  x = Math.max(box.x + 1, Math.min(box.x + box.width - 1, x));
  // 限制在元素边界内（上下各留 1px）
  y = Math.max(box.y + 1, Math.min(box.y + box.height - 1, y));

  return { x, y };
}

/**
 * 等待元素布局稳定（基於 requestAnimationFrame）
 * @param {import('playwright-core').ElementHandle} element - 元素句柄
 * @param {number} stableFrames - 需要连续稳定的帧数，建议提高到 10 (约160ms)
 * @param {number} timeout - 总逾時时间 (ms)
 */
async function waitForElementStable(
  element,
  stableFrames = 20,
  timeout = 2000,
) {
  if (!element) return;

  try {
    await element.evaluate(
      (targetEl, { stableFrames, timeout }) => {
        return new Promise((resolve) => {
          let lastRect = targetEl.getBoundingClientRect();
          let consecutiveStable = 0;
          const startTime = performance.now();

          function check() {
            // 1. 逾時检查：如果超过总时间，不再等待直接回傳，防止死循环
            if (performance.now() - startTime > timeout) {
              resolve();
              return;
            }

            const rect = targetEl.getBoundingClientRect();

            // 检查位置和大小是否变化 (容差 1px)
            const isSame =
              Math.abs(rect.x - lastRect.x) < 1 &&
              Math.abs(rect.y - lastRect.y) < 1 &&
              Math.abs(rect.width - lastRect.width) < 1 &&
              Math.abs(rect.height - lastRect.height) < 1;

            if (isSame) {
              consecutiveStable++;
              // 2. 只有连续 N 帧都不动才确定
              if (consecutiveStable >= stableFrames) {
                resolve();
                return;
              }
            } else {
              // 只要动了一次，计数器归零，重新开始计数
              consecutiveStable = 0;
              lastRect = rect;
            }

            requestAnimationFrame(check);
          }

          // 3. 稍微延迟啟動偵測，给回應式框架留啟動时间
          setTimeout(() => {
            requestAnimationFrame(check);
          }, 50);
        });
      },
      { stableFrames, timeout },
    );
  } catch (e) {
    // 忽略錯誤，继续執行
  }
}

/**
 * 安全點擊元素 (包含滾動、拟人化移动和點擊)
 * 支援 CSS selector、ElementHandle 和 Locator 三种輸入
 * @param {import('playwright-core').Page} page - Playwright 页面物件
 * @param {string|import('playwright-core').ElementHandle|import('playwright-core').Locator} target - CSS 选择器、元素句柄或 Locator
 * @param {object} [options] - 點擊选项
 * @param {string} [options.bias='random'] - 偏移偏好: 'input' 或 'random'
 * @param {number} [options.clickCount=1] - 點擊次数: 1=单击, 2=双击
 * @param {number} [options.timeout=15000] - 逾時时间 (毫秒)
 * @param {boolean} [options.waitStable=false] - 是否等待元素布局稳定后再點擊
 * @returns {Promise<void>}
 */
export async function safeClick(page, target, options = {}) {
  const clickCount = options.clickCount || 1;
  const waitStable = options.waitStable !== false; // 預設 true
  const selector = typeof target === "string" ? target : "元素";
  // humanizeCursorMode: false=停用, true=ghost-cursor, "camou"=Camoufox内置
  // 只有 true 时才使用 ghost-cursor，其他情况都使用原生點擊
  const useGhostCursor = page?._humanizeCursorMode === true && page?.cursor;
  const cursorSpeed = options.cursorSpeed ?? 40;

  // 动态计算逾時时间：使用 ghost-cursor 时，速度越慢逾時越长
  // 公式：基础逾時 + 额外时间(50000ms / 速度)
  // 速度40时额外1.25s，速度10时额外5s，速度5时额外10s
  const baseTimeout = options.timeout || TIMEOUTS.ELEMENT_CLICK;
  const timeout = useGhostCursor
    ? baseTimeout + Math.ceil(50000 / cursorSpeed)
    : baseTimeout;

  // 元素定位函式（可重复调用以取得新鲜的 ElementHandle）
  const resolveElement = async () => {
    if (typeof target === "string") {
      // CSS selector
      const el = await page.$(target);
      if (!el) throw new Error(`未找到: ${target}`);
      return el;
    } else if (typeof target.elementHandle === "function") {
      // Locator (来自 page.getByRole, page.getByText 等)
      const el = await target.elementHandle();
      if (!el) throw new Error(`Locator 未匹配到元素`);
      return el;
    } else {
      // ElementHandle
      if (!target || !target.asElement())
        throw new Error(`Element handle invalid`);
      return target;
    }
  };

  let aborted = false;

  const doClick = async () => {
    // 1. 首次取得元素（用于滾動和等待稳定）
    const logKey = `${selector} ${target} ${options.bias || "random"}`;
    logger.debug("瀏覽器", `[safeClick] 开始查找: ${logKey}`);
    let el = await resolveElement();
    logger.debug("瀏覽器", `[safeClick] 已找到 ${logKey}`);

    // 2. 确保元素在可视区域内
    logger.debug("瀏覽器", `[safeClick] 滾動到可视区域...`);
    if (aborted) return;
    await el.scrollIntoViewIfNeeded().catch(() => {});
    if (aborted) return;

    // 3. 如果开启了布局稳定等待，等待元素位置稳定
    if (waitStable) {
      logger.debug("瀏覽器", `[safeClick] 等待元素稳定...`);
      await waitForElementStable(el);
      if (aborted) return;
      logger.debug("瀏覽器", `[safeClick] 元素已稳定`);

      // 4. 重新取得元素引用（防止等待期间 DOM 变化导致 detached 錯誤）
      // 仅对 Locator 類型重新取得，ElementHandle 无法刷新
      if (typeof target.elementHandle === "function") {
        logger.debug("瀏覽器", `[safeClick] 重新取得元素引用...`);
        el = await resolveElement();
      }
    }

    if (aborted) return;
    // 5. 使用自维护 ghost-cursor 拟人滑鼠轨迹 (仅当 humanizeCursor=true)
    if (useGhostCursor) {
      const box = await el.boundingBox();
      if (aborted) return;
      logger.debug("瀏覽器", `[safeClick] boundingBox: ${JSON.stringify(box)}`);
      if (box) {
        const { x, y } = getHumanClickPoint(box, options.bias || "random");
        logger.debug(
          "瀏覽器",
          `[safeClick] 移动滑鼠到 (${x.toFixed(0)}, ${y.toFixed(0)})...`,
        );
        await page.cursor.moveTo({ x, y }, { moveSpeed: cursorSpeed });
        if (aborted) return;
        logger.debug("瀏覽器", `[safeClick] 執行點擊...`);
        await page.mouse.click(x, y, { clickCount });
        return;
      }
      // 如果无法取得 box，降级到預設點擊
      logger.debug(
        "瀏覽器",
        `[safeClick] boundingBox 为 null，降级到 cursor.click`,
      );
      await page.cursor.click(el);
      return;
    }

    // 6. 使用原生點擊 (humanizeCursor=false 或 "camou")
    const mode = page?._humanizeCursorMode;
    logger.debug("瀏覽器", `[safeClick] humanizeCursor=${mode} 使用原生點擊`);
    // force: true 跳過可操作性检查（遮挡偵測等），避免在复杂页面卡住
    await el.click({ clickCount, force: true });
  };

  // 带逾時的執行（移除了重試机制）
  let timeoutId;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        aborted = true;
        reject(new Error("CLICK_TIMEOUT"));
      }, timeout);
    });

    await Promise.race([
      doClick().finally(() => clearTimeout(timeoutId)),
      timeoutPromise,
    ]);
  } catch (err) {
    clearTimeout(timeoutId);
    throw new Error(`點擊操作失败 (${selector}): ${err.message}`);
  }
}

/**
 * 安全滾動 (包含拟人化移动和滚轮滾動)
 * 支援 CSS selector、ElementHandle 和 Locator 三种輸入
 * @param {import('playwright-core').Page} page - Playwright 页面物件
 * @param {string|import('playwright-core').ElementHandle|import('playwright-core').Locator} target - CSS 选择器、元素句柄或 Locator
 * @param {object} [options] - 滾動选项
 * @param {number} [options.deltaX=0] - 水平滾動距离 (正值向右)
 * @param {number} [options.deltaY=0] - 垂直滾動距离 (正值向下)
 * @param {string} [options.bias='random'] - 偏移偏好: 'input' 或 'random'
 * @returns {Promise<void>}
 */
export async function safeScroll(page, target, options = {}) {
  try {
    let el;

    // 判断輸入類型
    if (typeof target === "string") {
      // CSS selector
      el = await page.$(target);
      if (!el) throw new Error(`未找到: ${target}`);
    } else if (typeof target.elementHandle === "function") {
      // Locator (来自 page.getByRole, page.getByText 等)
      el = await target.elementHandle();
      if (!el) throw new Error(`Locator 未匹配到元素`);
    } else {
      // ElementHandle
      el = target;
      if (!el || !el.asElement()) throw new Error(`Element handle invalid`);
    }

    const deltaX = options.deltaX || 0;
    const deltaY = options.deltaY || 0;

    // 使用 ghost-cursor hover 后滾動
    if (page.cursor) {
      const box = await el.boundingBox();
      if (box) {
        const { x, y } = getHumanClickPoint(box, options.bias || "random");
        await page.cursor.moveTo({ x, y });
        await page.mouse.wheel(deltaX, deltaY);
        return;
      }
      // 如果无法取得 box，降级到元素中心点滾動
      await page.cursor.move(el);
      await page.mouse.wheel(deltaX, deltaY);
      return;
    }

    // 降级逻辑: 直接在元素上 hover 并滾動
    await el.hover();
    await page.mouse.wheel(deltaX, deltaY);
  } catch (err) {
    throw err;
  }
}

/**
 * 模擬人类键盘輸入
 * 支援 CSS selector 和 ElementHandle 两种輸入
 * @param {import('playwright-core').Page} page - Playwright 页面物件
 * @param {string|import('playwright-core').ElementHandle|null} target - CSS 选择器、元素句柄，或 null（需配合 skipFocus 使用）
 * @param {string} text - 要輸入的文本
 * @param {object} [options] - 可选配置
 * @param {boolean} [options.skipFocus=false] - 跳過元素定位和 focus，直接輸入（适用于已获得焦点的场景）
 * @returns {Promise<void>}
 */
export async function humanType(page, target, text, options = {}) {
  const { skipFocus = false } = options;

  // 如果不跳過 focus，需要定位并聚焦元素
  if (!skipFocus) {
    let el;

    // 判断是 selector 还是 ElementHandle
    if (typeof target === "string") {
      el = await page.$(target);
      if (!el) throw new Error(`Element not found: ${target}`);
    } else {
      el = target;
      if (!el) throw new Error(`Element handle invalid`);
    }

    await el.focus();
  }

  // 智能輸入策略
  if (text.length < 50) {
    // 短文本: 保持拟人化逐字輸入
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      // 处理换行符 (避免触发发送)
      if (char === "\r" && nextChar === "\n") {
        // Windows 换行符 (\r\n)
        await page.keyboard.down("Shift");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Shift");
        i++; // 跳過 \n
        await sleep(30, 100);
        continue;
      } else if (char === "\n" || char === "\r") {
        // Unix/Mac 换行符 (\n 或 \r)
        await page.keyboard.down("Shift");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Shift");
        await sleep(30, 100);
        continue;
      }

      // 模擬错字 (5% 概率)
      if (Math.random() < 0.05) {
        await page.keyboard.type("x", { delay: random(50, 150) });
        await sleep(100, 300);
        await page.keyboard.press("Backspace", { delay: random(50, 100) });
      }
      await page.keyboard.type(char, { delay: random(30, 100) });
      // 随机击键間隔
      await sleep(30, 100);
    }
  } else {
    // 长文本: 假装打字 -> 停顿 -> 粘贴
    const fakeCount = Math.floor(random(3, 8));
    const fakeText = text.substring(0, fakeCount);

    // 1. 假装打字几个字元 (需要处理换行符，避免触发发送)
    for (let i = 0; i < fakeText.length; i++) {
      const char = fakeText[i];
      const nextChar = fakeText[i + 1];

      // 处理换行符 (避免触发发送)
      if (char === "\r" && nextChar === "\n") {
        await page.keyboard.down("Shift");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Shift");
        i++; // 跳過 \n
        await sleep(30, 100);
        continue;
      } else if (char === "\n" || char === "\r") {
        await page.keyboard.down("Shift");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Shift");
        await sleep(30, 100);
        continue;
      }

      await page.keyboard.type(char, { delay: random(30, 100) });
    }

    // 2. 停顿思考
    await sleep(500, 1000);

    // 3. 全选刪除 (macOS 使用 Meta/Command, Windows/Linux 使用 Control)
    const modifierKey = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(modifierKey);
    await page.keyboard.press("A");
    await page.keyboard.up(modifierKey);
    await sleep(100, 300);
    await page.keyboard.press("Backspace");
    await sleep(100, 300);

    // 4. 瞬间粘贴全部文本 (始终使用已取得的 ElementHandle，支援 Shadow DOM)
    await page.evaluate((content) => {
      document.execCommand("insertText", false, content);
    }, text);
  }
}

/**
 * 查找页面上所有的檔案輸入框 (包括 Shadow DOM)
 * @private
 * @param {import('playwright-core').Page} page - Playwright 页面物件
 * @returns {Promise<import('playwright-core').ElementHandle[]>} 檔案輸入框 ElementHandle 陣列
 */
async function findAllFileInputs(page) {
  // 使用 Playwright 的 evaluateHandle 在瀏覽器上下文中深度遍历
  const inputsHandle = await page.evaluateHandle(() => {
    const inputs = [];

    function traverse(root) {
      if (!root) return;

      // 1. 检查当前节点下的 input
      const nodes = root.querySelectorAll('input[type="file"]');
      nodes.forEach((n) => inputs.push(n));

      // 2. 遍历 Shadow DOM
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT,
        null,
        false,
      );
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.shadowRoot) {
          traverse(node.shadowRoot);
        }
      }
    }

    traverse(document.body);
    return inputs;
  });

  const properties = await inputsHandle.getProperties();
  const handles = [];
  for (const prop of properties.values()) {
    const elementHandle = prop.asElement();
    if (elementHandle) handles.push(elementHandle);
  }
  return handles;
}

/**
 * 统一圖片上傳入口 (Camoufox/Playwright 专用稳定版)
 * 策略: 深度搜索原生 input[type="file"] -> setInputFiles
 * @param {import('playwright-core').Page} page - Playwright 页面物件
 * @param {string|import('playwright-core').ElementHandle} target - CSS 选择器或元素句柄 (用于聚焦)
 * @param {string[]} filePaths - 圖片檔案路徑陣列
 * @param {Object} [options] - 可选配置
 * @param {Function} [options.uploadValidator] - 自定义上傳确认回调函式, 接收 response 参数
 * @param {Object} [meta] - 元数据 (用于日誌)
 * @returns {Promise<void>}
 */
export async function pasteImages(
  page,
  target,
  filePaths,
  options = {},
  meta = {},
) {
  if (!filePaths || filePaths.length === 0) return;
  logger.info("瀏覽器", `正在处理 ${filePaths.length} 张圖片...`, meta);

  // 1. 拟人化: 先點擊一下目标区域 (让后台看起来像是用戶聚焦了輸入框)
  await safeClick(page, target, { bias: "input" });
  await sleep(300, 500);

  try {
    logger.debug("瀏覽器", "正在深度掃描檔案上傳控件...");
    const fileInputs = await findAllFileInputs(page);

    if (fileInputs.length === 0) {
      throw new Error('未找到任何 input[type="file"] 控件,无法上傳');
    }

    logger.info(
      "瀏覽器",
      `找到 ${fileInputs.length} 个檔案輸入框,尝试上傳...`,
      meta,
    );

    // LMArena 通常只有一个用于聊天的上傳控件，或者我们尝试第一个可用的
    // 如果有多个，通常最后一个是当前对话框的，或者我们可以尝试全部 (比较暴力但有效)
    let uploaded = false;

    for (const handle of fileInputs) {
      try {
        // 检查元素是否連接在 DOM 上
        const isConnected = await handle.evaluate((el) => el.isConnected);
        if (!isConnected) continue;

        // 使用 Playwright 原生上傳 (绕过所有事件拦截)
        await handle.setInputFiles(filePaths);
        uploaded = true;
        logger.debug("瀏覽器", "已通过原生控件提交圖片");
        break; // 只要有一个成功就停止
      } catch (e) {
        // 忽略不可操作的 input (比如被停用的)
        logger.debug("瀏覽器", `跳過不可用的檔案輸入框: ${e.message}`);
      }
    }

    if (!uploaded) {
      throw new Error("所有檔案控件均无法接受輸入");
    }

    // 如果提供了自定义的上傳确认函式，使用它
    if (
      options.uploadValidator &&
      typeof options.uploadValidator === "function"
    ) {
      const expectedUploads = filePaths.length;
      let validatedCount = 0;

      const uploadPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => {
          cleanup();
          logger.warn(
            "瀏覽器",
            `圖片上傳等待逾時 (已确认: ${validatedCount}/${expectedUploads})`,
            meta,
          );
          resolve();
        }, 60000); // 60s 逾時

        const onResponse = (response) => {
          if (options.uploadValidator(response)) {
            validatedCount++;
            logger.info(
              "瀏覽器",
              `圖片上傳进度: ${validatedCount}/${expectedUploads}`,
              meta,
            );
            if (validatedCount >= expectedUploads) {
              cleanup();
              resolve();
            }
          }
        };

        const cleanup = () => {
          clearTimeout(timeout);
          page.off("response", onResponse);
        };

        page.on("response", onResponse);
      });

      logger.info("瀏覽器", `已提交圖片, 正在等待上傳确认...`, meta);
      await uploadPromise;
      logger.info("瀏覽器", `所有圖片上傳完成`, meta);
    } else {
      // 預設行为: 等待上傳预览出现
      logger.info("瀏覽器", `已提交圖片, 等待预览生成...`, meta);
      await sleep(500, 1000);
    }
  } catch (e) {
    logger.error("瀏覽器", `上傳失败: ${e.message}`);
    throw e;
  }
}

/**
 * 通过 filechooser 事件上傳檔案 (适用于无 DOM input 元素的场景，如 Firefox)
 * @param {import('playwright-core').Page} page - Playwright 页面物件
 * @param {string|import('playwright-core').ElementHandle|import('playwright-core').Locator} triggerTarget - 触发檔案选择的按钮
 * @param {string[]} filePaths - 檔案路徑陣列
 * @param {Object} [options] - 可选配置
 * @param {Function} [options.uploadValidator] - 自定义上傳确认回调函式, 接收 response 参数，回傳 true 表示该回應代表一次成功上傳
 * @param {number} [options.timeout=60000] - 上傳逾時时间 (毫秒)
 * @param {string} [options.clickAction='click'] - 點擊动作: 'click' 或 'dblclick'
 * @param {Object} [meta] - 元数据 (用于日誌)
 * @returns {Promise<void>}
 */
export async function uploadFilesViaChooser(
  page,
  triggerTarget,
  filePaths,
  options = {},
  meta = {},
) {
  if (!filePaths || filePaths.length === 0) return;

  const timeout = options.timeout || 60000;
  const clickAction = options.clickAction || "click";
  const expectedUploads = filePaths.length;
  let uploadedCount = 0;

  logger.info(
    "瀏覽器",
    `正在处理 ${filePaths.length} 张圖片 (filechooser 模式)...`,
    meta,
  );

  // 設定上傳确认监听
  const uploadPromise = new Promise((resolve) => {
    if (!options.uploadValidator) {
      // 无验证器，直接 resolve
      resolve();
      return;
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      logger.warn(
        "瀏覽器",
        `圖片上傳等待逾時 (已确认: ${uploadedCount}/${expectedUploads})`,
        meta,
      );
      resolve();
    }, timeout);

    const onResponse = (response) => {
      if (options.uploadValidator(response)) {
        uploadedCount++;
        logger.info(
          "瀏覽器",
          `圖片上傳进度: ${uploadedCount}/${expectedUploads}`,
          meta,
        );
        if (uploadedCount >= expectedUploads) {
          cleanup();
          resolve();
        }
      }
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      page.off("response", onResponse);
    };

    page.on("response", onResponse);
  });

  // 設定等待 filechooser 事件（在點擊之前，带逾時保护）
  const fileChooserPromise = page.waitForEvent("filechooser", {
    timeout: 30000,
  });

  // 點擊触发按钮（支援单击或双击）
  const clickCount = clickAction === "dblclick" ? 2 : 1;
  await safeClick(page, triggerTarget, { bias: "button", clickCount });

  // 等待 filechooser 事件并設定檔案（带异常保护）
  let fileChooser;
  try {
    fileChooser = await fileChooserPromise;
  } catch (e) {
    // filechooser 逾時通常意味着點擊没有触发檔案选择器
    // 抛出可识别的錯誤让上层决定是否重試
    const error = new Error(`檔案选择器等待逾時: ${e.message}`);
    error.code = "UPLOAD_FILECHOOSER_TIMEOUT";
    throw error;
  }

  await fileChooser.setFiles(filePaths);
  logger.debug("瀏覽器", "已通过 filechooser 提交檔案");

  // 等待上傳完成（如果有验证器）
  if (options.uploadValidator) {
    await uploadPromise;
    logger.info("瀏覽器", "所有圖片上傳完成", meta);
  }
}

/**
 * 检查页面是否有效
 * @param {import('playwright-core').Page} page
 * @returns {boolean}
 */
export function isPageValid(page) {
  try {
    return page && !page.isClosed();
  } catch {
    return false;
  }
}

/**
 * 建立页面關閉/崩溃监听Promise
 * @param {import('playwright-core').Page} page
 * @returns {{promise: Promise, cleanup: Function}}
 */
export function createPageCloseWatcher(page) {
  let closeHandler, crashHandler;

  const promise = new Promise((_, reject) => {
    closeHandler = () => reject(new Error("PAGE_CLOSED"));
    crashHandler = () => reject(new Error("PAGE_CRASHED"));

    page.once("close", closeHandler);
    page.once("crash", crashHandler);
  });

  const cleanup = () => {
    if (closeHandler) page.off("close", closeHandler);
    if (crashHandler) page.off("crash", crashHandler);
  };

  return { promise, cleanup };
}

/**
 * 取得当前页面的所有 Cookies (实时从瀏覽器取得)
 * @param {import('playwright-core').Page} page - Playwright 页面实例
 * @returns {Promise<object[]>} Cookies 陣列 (JSON 格式)
 */
export async function getCookies(page) {
  const context = page.context();
  return await context.cookies();
}
