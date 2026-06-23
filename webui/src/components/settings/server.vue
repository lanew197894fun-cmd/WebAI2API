<script setup>
import { onMounted, reactive } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { Modal, message } from "ant-design-vue";

const settingsStore = useSettingsStore();

// 表单数据
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

// 实际保存逻辑
const doSave = async () => {
  await settingsStore.saveServerConfig(formData);
};

// 保存设置 (带校验和确认弹窗)
const handleSave = async () => {
  // 前端校验：Token 长度在 1-9 之间时提示
  if (
    formData.authToken &&
    formData.authToken.length > 0 &&
    formData.authToken.length < 10
  ) {
    message.error("鉴权 Token 如果设置则必须至少 10 个字符，或留空");
    return;
  }

  // Token 留空时弹出确认框
  if (!formData.authToken) {
    Modal.confirm({
      title: "安全警告",
      content:
        "您正在将鉴权 Token 留空，这意味着 API 和 WebUI 将无需认证即可访问。请勿在公网环境中使用此配置！确定要继续吗？",
      okText: "确定留空",
      okType: "danger",
      cancelText: "取消",
      onOk: doSave,
    });
    return;
  }

  // 正常保存
  await doSave();
};
</script>

<template>
  <a-layout style="background: transparent">
    <a-card title="服务器设置" :bordered="false" style="width: 100%">
      <!-- 4宫格表单布局 -->
      <a-row :gutter="[16, 16]">
        <!-- 监听端口 -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">监听端口</div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              設定伺服器監聽的埠號，預設為 5173
            </div>
            <a-input-number
              v-model:value="formData.port"
              :min="1"
              :max="65535"
              placeholder="请输入端口号"
              style="width: 100%"
            />
          </div>
        </a-col>

        <!-- 鉴权 Token -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">鉴权 Token</div>
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

      <!-- 保存按鈕（右下角） -->
      <div style="display: flex; justify-content: flex-end; margin-top: 24px">
        <a-button type="primary" @click="handleSave"> 保存設定 </a-button>
      </div>
    </a-card>

    <!-- 隊列設定 -->
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

      <!-- 保存按鈕（右下角） -->
      <div style="display: flex; justify-content: flex-end; margin-top: 24px">
        <a-button type="primary" @click="handleSave"> 保存設定 </a-button>
      </div>
    </a-card>
  </a-layout>
</template>

<style scoped>
/* 确保在手机端也能正常显示 */
.ant-input-number {
  width: 100%;
}
</style>
