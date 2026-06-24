<script setup>
import { onMounted, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@/stores/settings";
import { Modal, message } from "ant-design-vue";

const settingsStore = useSettingsStore();
const { t } = useI18n();

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
    message.error(t("server.tokenLengthError"));
    return;
  }

  // Token 留空時彈出確認框
  if (!formData.authToken) {
    Modal.confirm({
      title: t("server.securityWarn"),
      content: t("server.securityWarnContent"),
      okText: t("server.confirmEmpty"),
      okType: "danger",
      cancelText: t("common.cancel"),
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
    <a-card :title="$t('server.title')" :bordered="false" style="width: 100%">
      <!-- 4宮格表單佈局 -->
      <a-row :gutter="[16, 16]">
        <!-- 監聽埠號 -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              {{ $t("server.port") }}
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              {{ $t("server.portDesc") }}
            </div>
            <a-input-number
              v-model:value="formData.port"
              :min="1"
              :max="65535"
              :placeholder="$t('server.portPlaceholder')"
              style="width: 100%"
            />
          </div>
        </a-col>

        <!-- 鑑權 Token -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              {{ $t("server.authToken") }}
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              {{ $t("server.authTokenDesc") }}
            </div>
            <a-input-password
              v-model:value="formData.authToken"
              :placeholder="$t('server.authTokenPlaceholder')"
              type="password"
            />
          </div>
        </a-col>

        <!-- 心跳包类型 (Keepalive Mode) -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              {{ $t("server.keepalive") }}
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              {{ $t("server.keepaliveDesc") }}
            </div>
            <a-select
              v-model:value="formData.keepaliveMode"
              style="width: 100%"
              :placeholder="$t('server.keepalive')"
            >
              <a-select-option value="comment">{{
                $t("server.keepaliveComment")
              }}</a-select-option>
              <a-select-option value="content">{{
                $t("server.keepaliveContent")
              }}</a-select-option>
            </a-select>
          </div>
        </a-col>

        <!-- 日誌等級 -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              {{ $t("server.logLevel") }}
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              {{ $t("server.logLevelDesc") }}
            </div>
            <a-select
              v-model:value="formData.logLevel"
              style="width: 100%"
              :placeholder="$t('server.logLevel')"
            >
              <a-select-option value="debug">{{
                $t("server.logDebug")
              }}</a-select-option>
              <a-select-option value="info">{{
                $t("server.logInfo")
              }}</a-select-option>
              <a-select-option value="warn">{{
                $t("server.logWarn")
              }}</a-select-option>
              <a-select-option value="error">{{
                $t("server.logError")
              }}</a-select-option>
            </a-select>
          </div>
        </a-col>
      </a-row>

      <!-- 儲存按鈕（右下角） -->
      <div style="display: flex; justify-content: flex-end; margin-top: 24px">
        <a-button type="primary" @click="handleSave">
          {{ $t("common.saveSettings") }}
        </a-button>
      </div>
    </a-card>

    <!-- 佇列設定 -->
    <a-card
      :title="$t('server.queueTitle')"
      :bordered="false"
      style="width: 100%; margin-top: 10px"
    >
      <a-row :gutter="[16, 16]">
        <!-- 隊列緩衝區大小 -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              {{ $t("server.queueBuffer") }}
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              {{ $t("server.queueBufferDesc") }}
            </div>
            <a-input-number
              v-model:value="formData.queueBuffer"
              :min="0"
              :max="100"
              :placeholder="$t('server.queueBuffer')"
              style="width: 100%"
            />
          </div>
        </a-col>

        <!-- 圖片數量上限 -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              {{ $t("server.imageLimit") }}
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              {{ $t("server.imageLimitDesc") }}
            </div>
            <a-input-number
              v-model:value="formData.imageLimit"
              :min="1"
              :max="10"
              :placeholder="$t('server.imageLimit')"
              style="width: 100%"
            />
          </div>
        </a-col>

        <!-- 圖片生成結果使用 Markdown -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              {{ $t("server.imageMarkdown") }}
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              {{ $t("server.imageMarkdownDesc") }}
            </div>
            <a-switch v-model:checked="formData.imageMarkdown" />
          </div>
        </a-col>
      </a-row>

      <!-- 儲存按鈕（右下角） -->
      <div style="display: flex; justify-content: flex-end; margin-top: 24px">
        <a-button type="primary" @click="handleSave">
          {{ $t("common.saveSettings") }}
        </a-button>
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
