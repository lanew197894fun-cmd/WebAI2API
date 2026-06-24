<script setup>
import { onMounted, reactive } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { Modal, message } from "ant-design-vue";

const settingsStore = useSettingsStore();

// 表單資料
const formData = reactive({
  port: 5173,
  authToken: "",
  keepaliveMode: "comment",
  logLevel: "info",
  queueBuffer: 2,
  imageLimit: 5,
  imageMarkdown: false,
});

onMounted(async () => {
  await settingsStore.fetchServerConfig();
  Object.assign(formData, settingsStore.serverConfig);
});

// 實際儲存邏輯
const doSave = async () => {
  await settingsStore.saveServerConfig(formData);
};

// 儲存設定 (帶校驗和確認彈窗)
const handleSave = async () => {
  // 前端校驗：Token 長度在 1-9 之間時提示
  if (
    formData.authToken &&
    formData.authToken.length > 0 &&
    formData.authToken.length < 10
  ) {
    message.error("鑑權 Token 如果設定則必須至少 10 個字元，或留空");
    return;
  }

  // Token 留空時彈出確認框
  if (!formData.authToken) {
    Modal.confirm({
      title: "安全警告",
      content:
        "您正在將鑑權 Token 留空，這意味著 API 和 WebUI 將無需認證即可訪問。請勿在公開網路環境中使用此配置！確定要繼續嗎？",
      okText: "確定留空",
      okType: "danger",
      cancelText: "取消",
      onOk: doSave,
    });
    return;
  }

  // 正常儲存
  await doSave();
};
</script>

<template>
  <a-layout style="background: transparent">
    <a-card title="伺服器設定" :bordered="false" style="width: 100%">
      <!-- 4宮格表單佈局 -->
      <a-row :gutter="[16, 16]">
        <!-- 監聽埠號 -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">監聽埠號</div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              設定伺服器監聽的埠號，預設為 5173
            </div>
            <a-input-number
              v-model:value="formData.port"
              :min="1"
              :max="65535"
              placeholder="請輸入埠號"
              style="width: 100%"
            />
          </div>
        </a-col>

        <!-- 鑑權 Token -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">鑑權 Token</div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              用於 API 請求鑑權的密鑰，留空則不啟用鑑權
            </div>
            <a-input-password
              v-model:value="formData.authToken"
              placeholder="請輸入 Token"
              type="password"
            />
          </div>
        </a-col>

        <!-- 心跳包类型 (Keepalive Mode) -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">心跳包類型</div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              選擇 SSE 流式回應的心跳包格式
            </div>
            <a-select
              v-model:value="formData.keepaliveMode"
              style="width: 100%"
              placeholder="請選擇心跳包類型"
            >
              <a-select-option value="comment"
                >Comment - 註解格式</a-select-option
              >
              <a-select-option value="content"
                >Content - 內容格式</a-select-option
              >
            </a-select>
          </div>
        </a-col>

        <!-- 日誌等級 -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">日誌等級</div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              設定伺服器日誌輸出的詳細程度
            </div>
            <a-select
              v-model:value="formData.logLevel"
              style="width: 100%"
              placeholder="請選擇日誌等級"
            >
              <a-select-option value="debug">Debug - 調試日誌</a-select-option>
              <a-select-option value="info">Info - 普通資訊</a-select-option>
              <a-select-option value="warn">Warn - 警告資訊</a-select-option>
              <a-select-option value="error">Error - 僅錯誤</a-select-option>
            </a-select>
          </div>
        </a-col>
      </a-row>

      <!-- 儲存按鈕（右下角） -->
      <div style="display: flex; justify-content: flex-end; margin-top: 24px">
        <a-button type="primary" @click="handleSave"> 儲存設定 </a-button>
      </div>
    </a-card>

    <!-- 佇列設定 -->
    <a-card
      title="隊列設定"
      :bordered="false"
      style="width: 100%; margin-top: 10px"
    >
      <a-row :gutter="[16, 16]">
        <!-- 隊列緩衝區大小 -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              隊列緩衝區大小
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              非流式請求的額外排隊數（設為 0 則不限制非流式請求數量）<br />
              實際隊列上限 = Workers數量 + 緩衝區大小
            </div>
            <a-input-number
              v-model:value="formData.queueBuffer"
              :min="0"
              :max="100"
              placeholder="預設為 2"
              style="width: 100%"
            />
          </div>
        </a-col>

        <!-- 圖片數量上限 -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">圖片數量上限</div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              單次請求最多支援的圖片附件數量<br />
              網頁最多支援10個附件，超出會被丟棄
            </div>
            <a-input-number
              v-model:value="formData.imageLimit"
              :min="1"
              :max="10"
              placeholder="預設為 5"
              style="width: 100%"
            />
          </div>
        </a-col>

        <!-- 圖片生成結果使用 Markdown -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              圖片 Markdown 格式
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              開啟後生圖結果將使用 Markdown 語法返回圖片內容<br />
              開啟此項需要客戶端支援渲染 Markdown
            </div>
            <a-switch v-model:checked="formData.imageMarkdown" />
          </div>
        </a-col>
      </a-row>

      <!-- 儲存按鈕（右下角） -->
      <div style="display: flex; justify-content: flex-end; margin-top: 24px">
        <a-button type="primary" @click="handleSave"> 儲存設定 </a-button>
      </div>
    </a-card>
  </a-layout>
</template>

<style scoped>
/* 確保在手機端也能正常顯示 */
.ant-input-number {
  width: 100%;
}
</style>
