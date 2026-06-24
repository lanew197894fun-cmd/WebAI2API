# WebAI2API

繁體中文 | [简体中文](README_CN.md) | [English](README_EN.md)

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
- [API 介面](#-api-介面)
- [裝置配置參考](#-裝置配置參考)

---

## 📝 專案簡介

**WebAI2API** 是一個基於 **Camoufox (Playwright)** 的網頁版 AI 服務轉通用 API 的工具。透過模擬人類操作與 LMArena、Gemini 等網站互動，提供相容 **OpenAI 格式** 的介面服務，同時支援 **多視窗並發** 與 **多帳號管理**（瀏覽器實例資料隔離）。

### ✨ 主要特性

- 🤖 **擬人互動**: 模擬人類打字與滑鼠軌跡，透過特徵偽裝規避自動化偵測
- 🔄 **介面相容**: 提供標準 OpenAI 格式介面，支援串流回應與心跳保活
- 🚀 **並發隔離**: 支援多視窗並發執行，可配置獨立代理，實現多帳號瀏覽器實例級資料隔離
- 🛡️ **穩定防護**: 內建任務佇列、負載均衡、故障轉移、錯誤重試等基礎功能
- 🎨 **網頁管理**: 提供可視化管理介面，支援即時日誌檢視、VNC 連接、配接器管理等

### 📋 支援列表

| 網站名稱                                                          | 文字生成 | 圖片生成 | 影片生成 |
| :---------------------------------------------------------------- | :------: | :------: | :------: |
| [**LMArena**](https://lmarena.ai/)                                |    ✅    |    ✅    |    🚫    |
| [**Gemini Enterprise Business**](https://business.gemini.google/) |    ✅    |    ✅    |    ✅    |
| [**Nano Banana Free**](https://nanobananafree.ai/)                |    🚫    |    ✅    |    🚫    |
| [**zAI**](https://zai.is/)                                        |    ✅    |    ✅    |    🚫    |
| [**Google Gemini**](https://gemini.google.com/)                   |    ✅    |   ✅💧   |   ✅💧   |
| [**ZenMux**](https://zenmux.ai/)                                  |    ✅    |    ❌    |    🚫    |
| [**ChatGPT**](https://chatgpt.com/)                               |    ✅    |    ✅    |    🚫    |
| [**DeepSeek**](https://chat.deepseek.com/)                        |    ✅    |    🚫    |    🚫    |
| [**Sora**](https://sora.chatgpt.com/)                             |    🚫    |    🚫    |   ✅💧   |
| [**Google Flow**](https://labs.google/fx/zh/tools/flow)           |    🚫    |    ✅    |    ❌    |
| [**豆包**](https://www.doubao.com/)                               |    ✅    |    ✅    |    ❌    |
| 待續...                                                           |    -     |    -     |    -     |

> [!NOTE]
> **取得完整模型列表**: 透過 `GET /v1/models` 介面檢視當前配置下所有可用模型及其詳細資訊。
>
> ✅ 目前支援；❌ 目前不支援，但未來可能會支援；🚫 網站不支援，未來是否支援看網站具體情況；💧 結果帶浮水印且無法移除；

---

## 🚀 快速部署

本專案支援 **原始碼直接執行** 和 **Docker 容器化部署** 兩種方式。

### 📋 環境要求

- **Node.js**: v20.0.0+ (ABI 115+)
- **作業系統**: Windows / Linux / macOS
- **核心依賴**: Camoufox（安裝過程中自動取得）

### 🛠️ 方式一：手動部署

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
   # 其他發行版請前往文件中心查詢或自行搜尋
   apt install -y xvfb x11vnc libgtk-3-0 libx11-xcb1 libasound2

   ```

2. **啟動服務**

   ```bash
   # 標準啟動
   npm start

   # Linux 系統 - 虛擬顯示啟動
   npm start -- -xvfb -vnc

   # 登入模式（會暫時強制停用無頭模式和自動化）
   npm start -- -login (-xvfb -vnc)
   ```

### 🐳 方式二：Docker 部署

> [!WARNING]
> **安全提醒**:
>
> - Docker 映像檔預設開啟虛擬顯示器 (Xvfb) 和 VNC 服務
> - 可透過 WebUI 的虛擬顯示器區塊連接
> - **WebUI 傳輸過程未加密，公網環境請使用 SSH 隧道或 HTTPS**

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

## ⚡ 快速開始

### 1. 調整配置檔案

程式初次執行會從 `config.example.yaml` 複製配置檔案到 `data/config.yaml`

**配置檔案的生效需要重新啟動程式！**

```yaml
server:
  # 監聽連接埠
  port: 3000
  # 鑑權 API Token（可使用 npm run genkey 生成）
  # 該配置會對 API 介面和 WebUI 生效
  auth: sk-change-me-to-your-secure-key
```

> [!TIP]
> **完整配置說明**: 請參考 [config.example.yaml](config.example.yaml) 檔案中的詳細註解，或訪問 [WebAI2API 文件中心](https://foxhui.github.io/WebAI2API/) 檢視完整配置指南。

### 2. 訪問 Web 管理介面

服務啟動後，開啟瀏覽器訪問：

```
http://localhost:3000
```

> [!TIP]
> **遠端訪問**: 將 `localhost` 替換為伺服器 IP 位址即可遠端訪問。
> **API Token**: 配置檔案中的 `auth` 所配置的鑑權金鑰。
> **安全建議**: 公網環境建議使用 Nginx/Caddy 配置 HTTPS 或透過 SSH 隧道訪問。

### 3. 初始化帳號登入

> [!IMPORTANT]
> **首次使用必須完成以下初始化步驟**:

1. **連接虛擬顯示器**:
   - Linux/Docker: 在 WebUI 的「虛擬顯示器」區塊連接
   - Windows: 直接在彈出的瀏覽器視窗中操作

2. **完成帳號登入**:
   - 手動登入所需的 AI 網站帳號（帳號要求可進入 WebUI 的配接器管理中檢視）
   - 在輸入框傳送任意訊息，觸發並完成人機驗證（如需要）
   - 同意服務條款或新手指引（如需要）
   - 確保不再有初次使用相關內容的阻擋

3. **SSH 隧道連接範例**（公網伺服器推薦）:

   ```bash
   # 在本機終端執行，將伺服器的 WebUI 映射到本機
   ssh -L 3000:127.0.0.1:3000 root@伺服器IP

   # 然後在本機訪問
   # WebUI: http://localhost:3000
   ```

---

## 📖 使用方法

### 執行模式說明

> [!NOTE]
> **關於有頭/無頭模式**:
>
> - **有頭模式**（預設）: 顯示瀏覽器視窗，便於除錯和人工干預
> - **無頭模式**: 背景執行，節省資源但無法檢視瀏覽器介面，且可能會被網站偵測
>
> **建議**: 為降低風控，**強烈建議長期保持非無頭模式執行**（或使用虛擬顯示器 Xvfb）。

---

## 🔌 API 介面

> [!TIP]
> **詳細文件**: 請訪問 [WebAI2API 文件中心](https://foxhui.github.io/WebAI2API/) 取得更全面的配置指南與介面說明。

### 1. OpenAI 相容介面

> [!WARNING]
> **並發限制與串流保活建議**
>
> 本專案透過模擬真實瀏覽器操作實現，處理過程根據實際情況時間可能有所變化，當積壓的任務超過設定的數量時會直接拒絕非串流模式的請求。
>
> **💡 強烈建議開啟串流模式**: 伺服器將傳送保活心跳封包，可無限排隊避免逾時。

#### 文字對話

**端點**: `POST /v1/chat/completions`

**請求範例**:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "gemini-3-pro",
    "messages": [
      {"role": "user", "content": "你好，請介紹一下你自己"}
    ],
    "stream": true
  }'
```

#### 多模態請求（文生圖/圖生圖）

**支援的圖片格式**:

- **格式**: PNG, JPEG, GIF, WebP
- **數量**: 最大 10 張（具體限制因網站而異）
- **資料格式**: 必須使用 Base64 Data URL 格式
- **自動轉換**: 伺服器會自動將所有圖片轉換為 JPG 格式以保證相容性

#### 參數說明

| 參數     | 類型    | 必填 | 說明                                       |
| :------- | :------ | :--: | :----------------------------------------- |
| `model`  | string  |  ✅  | 模型名稱，可透過 `/v1/models` 取得可用列表 |
| `stream` | boolean | 推薦 | 是否開啟串流回應，包含心跳保活機制         |

> [!NOTE]
> **關於串流保活 (Heartbeat)**
>
> 為防止長連線逾時，系統提供兩種保活模式（可在配置中切換）:
>
> 1. **Comment 模式（預設/推薦）**: 傳送 `:keepalive` 註解，符合 SSE 標準，相容性最好
> 2. **Content 模式**: 傳送空內容的 data 封包，僅用於必須收到 JSON 資料才重置逾時的特殊用戶端

### 2. 取得模型列表

**端點**: `GET /v1/models`

**請求範例**:

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### 3. 取得 Cookies

**功能說明**: 利用本專案的自動續登功能取得最新 Cookie 供其他工具使用。

**端點**: `GET /v1/cookies`

**參數**:

- `name`（可選）: 瀏覽器實例名稱，預設為 `default`
- `domain`（可選）: 過濾指定網域的 Cookie

**請求範例**:

```bash
# 取得指定實例和網域的 Cookie
curl "http://localhost:3000/v1/cookies?name=browser_default&domain=lmarena.ai" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## 📊 裝置配置參考

| 資源       | 最低配置      | 推薦配置（單實例） | 推薦配置（多實例） |
| :--------- | :------------ | :----------------- | :----------------- |
| **CPU**    | 1 核心        | 2 核心及以上       | 2 核心及以上       |
| **記憶體** | 1 GB          | 2 GB 及以上        | 4 GB 及以上        |
| **磁碟**   | 2 GB 可用空間 | 5 GB 及以上        | 7 GB 及以上        |

**實測環境表現**（均為單瀏覽器實例）:

- **Oracle 免費機**（1C1G, Debian 12）: 資源緊繃，比較卡頓，僅供嘗鮮或輕度使用
- **阿里雲輕量雲**（2C2G, Debian 11）: 執行流暢但實例也會卡頓，專案開發測試所用機型

---

## 📄 授權條款與免責聲明

本專案採用 [MIT License](LICENSE) 開源。

> [!CAUTION]
> **免責聲明**
>
> 本專案僅供學習交流使用。如果因使用該專案造成的任何後果（包括但不限於帳號被停用），作者和專案均不承擔任何責任。請遵守相關網站和服務的使用條款 (ToS)，並做好相關資料的備份工作。

---

## 📋 更新日誌

檢視完整的版本歷史和更新內容，請訪問 [CHANGELOG.md](CHANGELOG.md)。

### 🕰️ 歷史版本說明

本專案已從 Puppeteer 遷移至 Camoufox，以應對日益複雜的反機器人偵測機制。基於 Puppeteer 的舊版本程式碼已歸檔至 `puppeteer-edition` 分支，僅作留存，**不再提供更新與維護**。

---

**感謝 LMArena、Gemini 等網站提供 AI 服務！** 🎉
