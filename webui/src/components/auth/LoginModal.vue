<script setup>
import { ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { message } from "ant-design-vue";
import { LockOutlined } from "@ant-design/icons-vue";

const props = defineProps({
  visible: {
    type: Boolean,
    required: true,
  },
});

const emit = defineEmits(["update:visible", "success"]);

const settingsStore = useSettingsStore();
const token = ref(settingsStore.token);
const loading = ref(false);

const handleLogin = async () => {
  if (!token.value) {
    message.warning("請輸入 Token");
    return;
  }

  loading.value = true;
  try {
    const originalToken = settingsStore.token;
    settingsStore.setToken(token.value);

    const success = await settingsStore.checkAuth();
    if (success) {
      message.success("驗證成功");
      emit("success");
      emit("update:visible", false);
    } else {
      message.error("Token 驗證失敗，請檢查是否正確");
      settingsStore.setToken(originalToken);
    }
  } catch (e) {
    message.error("驗證過程發生錯誤");
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <a-modal
    :open="visible"
    title="需要身份驗證"
    :closable="false"
    :maskClosable="false"
    :footer="null"
    width="400px"
    centered
  >
    <div style="padding: 20px 0">
      <div style="text-align: center; margin-bottom: 24px">
        <a-avatar :size="64" style="background-color: #1890ff">
          <template #icon>
            <LockOutlined />
          </template>
        </a-avatar>
        <div style="margin-top: 16px; font-size: 16px; font-weight: 500">
          WebAI2API 管理面板
        </div>
        <div style="color: #8c8c8c; margin-top: 8px">
          請輸入訪問 API Token 以繼續
        </div>
      </div>

      <a-form layout="vertical">
        <a-form-item label="API Token">
          <a-input-password
            v-model:value="token"
            placeholder="請輸入 API Token"
            size="large"
            @pressEnter="handleLogin"
          >
            <template #prefix>
              <LockOutlined style="color: rgba(0, 0, 0, 0.25)" />
            </template>
          </a-input-password>
        </a-form-item>

        <a-button
          type="primary"
          block
          size="large"
          :loading="loading"
          @click="handleLogin"
        >
          驗證並登入
        </a-button>
      </a-form>
    </div>
  </a-modal>
</template>
