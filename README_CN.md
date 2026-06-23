# WebAI2API

[簡體中文](README_CN.md) | [繁體中文](README.md) | [English](README_EN.md)

<p align="center">
  <img src="https://github.com/user-attachments/assets/296a518e-c42b-4e39-8ff6-9b4381ed4f6e" width="49%" />
  <img src="https://github.com/user-attachments/assets/bfa30ece-6947-4f18-b2c9-ccc8087b7e89" width="49%" />
</p>
<p align="center">
  <img src="https://github.com/user-attachments/assets/5b15ebd2-7593-4f0e-8561-83d6ba5d88ab" width="49%" />
  <img src="https://github.com/user-attachments/assets/53deea29-4071-4a07-8a61-211761c5f2f7" width="49%" />
</p>

## 📑 目錄

- [快速部署](#-快速部署)
- [快速開始](#-快速開始)
- [使用方法](#-使用方法)
- [API 接口](#-api-接口)
- [設備配置參考](#-設備配置參考)

---

## 📝 項目簡介

**WebAI2API** 是一個基於 **Camoufox (Playwright)** 的網頁版 AI 服務轉通用 API 的工具。通過模擬人類操作與 LMArena、Gemini 等網站互動, 提供兼容 **OpenAI 格式** 的接口服務, 同時支持 **多窗口併發** 與 **多帳號管理**(瀏覽器實例數據隔離)。

### ✨ 主要特性

- 🤖 **擬人互動**: 模擬人類打字與滑鼠軌跡, 通過特徵偽裝規避自動化檢測
- 🔄 **接口相容**: 提供標準 OpenAI 格式接口, 支持流式響應與心跳保活
- 🚀 **併發隔離**: 支持多窗口併發執行, 可配置獨立代理, 實現多帳號瀏覽器實例級數據隔離
- 🛡️ **穩定防護**: 內置任務隊列、負載均衡、故障轉移、錯誤重試等基礎功能
- 🎨 **網頁管理**: 提供可視化管理介面, 支持實時日誌查看、VNC 連接、適配器管理等

### 📋 支持列表

| 網站名稱 | 文本生成 | 圖片生成 | 視頻生成 |
| :--- | :---: | :---: | :---: | 
| [**LMArena**](https://lmarena.ai/) | ✅ | ✅ | 🚫 |
| [**Gemini Enterprise Business**](https://business.gemini.google/) | ✅ | ✅ | ✅ |
| [**Nano Banana Free**](https://nanobananafree.ai/) | 🚫 | ✅ | 🚫 |
| [**zAI**](https://zai.is/) | ✅ | ✅ | 🚫 |
| [**Google Gemini**](https://gemini.google.com/) | ✅ | ✅💧 | ✅💧 | 
| [**ZenMux**](https://zenmux.ai/) | ✅ | ❌ | 🚫 | 
| [**ChatGPT**](https://chatgpt.com/) | ✅ | ✅ | 🚫 | 
| [**DeepSeek**](https://chat.deepseek.com/) | ✅ | 🚫 | 🚫 | 
| [**Sora**](https://sora.chatgpt.com/) | 🚫 | 🚫 | ✅💧 | 
| [**Google Flow**](https://labs.google/fx/zh/tools/flow) | 🚫 | ✅ | ❌ | 
| [**豆包**](https://www.doubao.com/) | ✅ | ✅ | ❌ | 
| 待續... | - | - | - | 

> [!NOTE]
> **獲取完整模型列表**: 通過 `GET /v1/models` 介面查看當前配置下所有可用模型及其詳細資訊。
> 
> ✅目前支持；❌目前不支持，但未來可能會支持；🚫網站不支持, 未來是否在支持看網站具體情況；💧結果帶水印且無法去除；

---

## 🚀 快速部署

本項目支援 **原始碼直接運行** 和 **Docker 容器化部署** 兩種方式。

### 📋 環境要求

- **Node.js**: v20.0.0+ (ABI 115+)
- **作業系統**: Windows / Linux / macOS
- **核心依賴**: Camoufox (安裝過程中自動獲取)

### 🛠️ 方式一:手動部署

1. **安裝與配置**
   ```bash
   # 1. 安裝 NPM 依賴
   pnpm install

   # 2. 安裝瀏覽器等預編譯依賴
   # ⚠️ 該腳本需連接 GitHub 下載資源。若網路受限，請使用代理
   npm run init 
   # 使用代理
   # 直接使用 -proxy 可互動式輸入代理配置
   npm run init -- -proxy=http://username:passwd@host:port

   # 3. Linux 依賴安裝
   # 其他發行版請前往文件中心查找或者自行搜索
   apt install -y xvfb x11vnc libgtk-3-0 libx11-xcb1 libasound2
   
   ```

2. **啟動服務**
   ```bash
   # 標準啟動
   npm start

   # Linux 系統 - 虛擬顯示啟動
   npm start -- -xvfb -vnc

   # 登入模式 (會臨時強行禁用無頭模式和自動化)
   npm start -- -login (-xvfb -vnc)
   ```

### 🐳 方式二:Docker 部署

> [!WARNING]
> **安全提醒**: 
> - Docker 鏡像預設開啟虛擬顯示器 (Xvfb) 和 VNC 服務
> - 可通過 WebUI 的虛擬顯示器版塊連接
> - **WebUI 傳輸過程未加密, 公網環境請使用 SSH 隧道或 HTTPS**

**Docker CLI 啟動**
```bash
docker run -d --name webai-2api \
  -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  --shm-size=2gb \
  foxhui/webai-2api:latest
```

**Docker Compose 啟動**
```bash
docker-compose up -d
```

---

## ⚡ 快速开始

### 1. 调整配置文件

程序初次运行会从`config.example.yaml`复制配置文件到`data/config.yaml`

**配置文件的生效需要重启程序！**

```yaml
server:
  # 监听端口
  port: 3000
  # 鉴权 API Token (可使用 npm run genkey 生成)
  # 该配置会对 API 接口和 WebUI 生效
  auth: sk-change-me-to-your-secure-key
```

> [!TIP]
> **完整配置说明**: 请参考 [config.example.yaml](config.example.yaml) 文件中的详细注释,或访问 [WebAI2API 文档中心](https://foxhui.github.io/WebAI2API/) 查看完整配置指南。

### 2. 访问 Web 管理界面

服务启动后, 打开浏览器访问:
```
http://localhost:3000
```

> [!TIP]
> **远程访问**: 将 `localhost` 替换为服务器 IP 地址即可远程访问。
> **API Token**: 配置文件中的`auth`所配置的鉴权密钥。
> **安全建议**: 公网环境建议使用 Nginx/Caddy 配置 HTTPS 或通过 SSH 隧道访问。

### 3. 初始化账号登录

> [!IMPORTANT]
> **首次使用必须完成以下初始化步骤**:

1. **连接虚拟显示器**:
   - Linux/Docker: 在 WebUI 的"虚拟显示器"板块连接
   - Windows: 直接在弹出的浏览器窗口中操作

2. **完成账号登录**:
   - 手动登录所需的 AI 网站账号 (账号要求可进入 WebUI 的适配器管理中查看)
   - 在输入框发送任意消息, 触发并完成人机验证 (如需要)
   - 同意服务条款或者新手指引 (如需要)
   - 确保不再有初次使用相关内容的阻拦

3. **SSH 隧道连接示例**(公网服务器推荐):
   ```bash
   # 在本地终端运行,将服务器的 WebUI 映射到本地
   ssh -L 3000:127.0.0.1:3000 root@服务器IP
   
   # 然后在本地访问
   # WebUI: http://localhost:3000
   ```

---

## 📖 使用方法

### 運行模式說明

> [!NOTE]
> **關於有頭/無頭模式**:
> - **有頭模式**(預設): 顯示瀏覽器視窗, 便於調試和人工干預
> - **無頭模式**: 背景運行, 節省資源但無法查看瀏覽器介面, 且可能會被網站檢測
> 
> **建議**: 為降低風控, **強烈建議長期保持非無頭模式運行**(或使用虛擬顯示器 Xvfb)。

---

## 🔌 API 介面

> [!TIP]
> **詳細文件**: 請訪問 [WebAI2API 文件中心](https://foxhui.github.io/WebAI2API/) 獲取更全面的配置指南與介面說明。

### 1. OpenAI 兼容介面

> [!WARNING]
> **併發限制與流式保活建議**
> 
> 本項目通過模擬真實瀏覽器操作實現, 處理過程根據實際情況時間可能有所變化, 當積壓的任務超過設定的數量時會直接拒絕非流式模式的請求。
> 
> **💡 強烈建議開啟流式模式**: 伺服器將發送保活心跳包, 可無限排隊避免超時。

#### 文本對話

**端點**: `POST /v1/chat/completions`

**請求示例**:
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gemini-3-pro",
    "messages": [
      {"role": "user", "content": "你好,請介紹一下你自己"}
    ],
    "stream": true
  }'
```

#### 多模態請求(文生圖/圖生圖)

**支援的圖片格式**:
- **格式**: PNG, JPEG, GIF, WebP
- **數量**: 最大 10 張(具體限制因網站而異)
- **數據格式**: 必須使用 Base64 Data URL 格式
- **自動轉換**: 伺服器會自動將所有圖片轉換為 JPG 格式以保證相容性

#### 參數說明

| 參數 | 類型 | 必填 | 說明 |
| :--- | :--- | :---: | :--- |
| `model` | string | ✅ | 模型名稱, 可通過 `/v1/models` 獲取可用列表 |
| `stream` | boolean | 推薦 | 是否開啟流式響應, 包含心跳保活機制 |

> [!NOTE]
> **關於流式保活 (Heartbeat)**
> 
> 為防止長連接超時, 系統提供兩種保活模式 (可在配置中切換):
> 1. **Comment 模式 (預設/推薦)**: 發送 `:keepalive` 註解, 符合 SSE 標準,相容性最好
> 2. **Content 模式**: 發送空內容的 data 包, 僅用於必須收到 JSON 數據才重置超時的特殊客戶端

### 2. 獲取模型列表

**端點**: `GET /v1/models`

**請求示例**:
```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 3. 獲取 Cookies

**功能說明**: 利用本項目的自動續登功能獲取最新 Cookie 供其他工具使用。

**端點**: `GET /v1/cookies`

**參數**:
- `name` (可選): 瀏覽器實例名稱,預設為 `default`
- `domain` (可選): 過濾指定域名的 Cookie

**請求示例**:
```bash
# 獲取指定實例和域名的 Cookie
curl "http://localhost:3000/v1/cookies?name=browser_default&domain=lmarena.ai" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## 📊 設備配置參考

| 資源 | 最低配置 | 推薦配置 (單實例) | 推薦配置 (多實例) |
| :--- | :--- | :--- | :--- |
| **CPU** | 1 核 | 2 核及以上 | 2 核及以上 |
| **內存** | 1 GB | 2 GB 及以上 | 4 GB 及以上 |
| **磁盤** | 2 GB 可用空間 | 5 GB 及以上 | 7 GB 及以上 |

**實測環境表現** (均為單瀏覽器實例):
- **Oracle 免費機** (1C1G, Debian 12): 資源緊張, 比較卡頓, 僅供嘗鮮或輕度使用
- **阿里雲輕量雲** (2C2G, Debian 11): 運行流暢但實例也會卡頓, 項目開發測試所用機型

---

## 📄 許可證和免責聲明

本項目採用 [MIT License](LICENSE) 開源。

> [!CAUTION]
> **免責聲明**
> 
> 本項目僅供學習交流使用。如果因使用本項目造成的任何後果 (包括但不限於帳號被禁用),作者和項目均不承擔任何責任。請遵守相關網站和服務的使用條款 (ToS),並做好相關數據的備份工作。

---

## 📋 更新日誌

查看完整的版本歷史和更新內容, 請訪問 [CHANGELOG.md](CHANGELOG.md)。

### 🕰️ 歷史版本說明

本項目已從 Puppeteer 遷移至 Camoufox, 以應對日益複雜的反機器人檢測機制。基於 Puppeteer 的舊版本代碼已歸檔至 `puppeteer-edition` 分支, 僅作留存, **不再提供更新與維護**。

---

**感謝 LMArena、Gemini 等網站提供 AI 服務!** 🎉
