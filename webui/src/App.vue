<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { Modal, message } from "ant-design-vue";
import { useI18n } from "vue-i18n";
import {
  DashboardOutlined,
  SettingOutlined,
  ToolOutlined,
  PoweroffOutlined,
  GithubOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  InboxOutlined,
  PictureOutlined,
  HistoryOutlined,
  RocketOutlined,
  MenuOutlined,
  GlobalOutlined,
} from "@ant-design/icons-vue";
import { useSettingsStore } from "@/stores/settings";
import LoginModal from "@/components/auth/LoginModal.vue";

const router = useRouter();
const settingsStore = useSettingsStore();
const { t, locale } = useI18n();

const selectedKeys = ref(["dash"]);
const collapsed = ref(false);
const isMobile = ref(false);
const loginVisible = ref(false);

const iconLoading = ref(false);
const enterIconLoading = () => {
  iconLoading.value = true;
  settingsStore.setToken("");
  setTimeout(() => {
    iconLoading.value = false;
    loginVisible.value = true;
  }, 500);
};

// 介面測試抽屜
const apiTestDrawer = ref(false);
const apiTestResults = ref({
  models: { status: "pending", data: null, error: null },
  cookies: { status: "pending", data: null, error: null },
  chat: { status: "pending", data: null, error: null },
});
const chatTestPrompt = ref("Say hello in one word");
const chatTestModel = ref("");
const chatModelList = ref([]);
const chatImageList = ref([]);
const chatStreamMode = ref(false);
const chatStreamContent = ref("");

// 取得模型列表
const fetchModelList = async () => {
  try {
    const res = await fetch("/v1/models", {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      chatModelList.value = data.data || [];
      if (chatModelList.value.length > 0 && !chatTestModel.value) {
        chatTestModel.value = chatModelList.value[0].id;
      }
    }
  } catch (e) {
    console.error("取得模型列表失敗", e);
  }
};

// 圖片轉 base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });
};

// 圖片上傳前檢查
const beforeUpload = (file) => {
  const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    message.error(t("request.imageFormatErrorCN"));
    return false;
  }
  if (chatImageList.value.length >= 10) {
    message.error(t("request.maxImagesErrorCN"));
    return false;
  }
  return false; // 阻止自動上傳，手動處理
};

// 處理圖片選擇
const handleImageChange = async (info) => {
  const file = info.file;
  if (file.status === "removed") {
    chatImageList.value = chatImageList.value.filter((f) => f.uid !== file.uid);
    return;
  }
  try {
    const base64 = await fileToBase64(file.originFileObj || file);
    chatImageList.value.push({
      uid: file.uid,
      name: file.name,
      base64,
    });
  } catch (e) {
    message.error(t("request.imageReadErrorCN"));
  }
};

// 將 base64 轉換為 blob URL
const base64ToBlob = (dataUri) => {
  const arr = dataUri.split(",");
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return URL.createObjectURL(new Blob([u8arr], { type: mime }));
};

// 解析內容中的 Markdown 圖片和直接的影片 data URI
const parseMarkdownImages = (content) => {
  if (!content) return { text: "", images: [], videos: [] };

  // 偵測是否是直接的 data:video/ 內容（非 markdown 格式）
  if (content.trim().startsWith("data:video/")) {
    try {
      const blobUrl = base64ToBlob(content.trim());
      return {
        text: "",
        images: [],
        videos: [{ src: blobUrl, type: "video/mp4" }],
      };
    } catch (e) {
      console.error("影片轉換失敗", e);
      return { text: content, images: [], videos: [] };
    }
  }

  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images = [];
  let match;
  let lastIndex = 0;
  let textParts = [];

  while ((match = imageRegex.exec(content)) !== null) {
    // 添加圖片之前的文本
    if (match.index > lastIndex) {
      textParts.push(content.substring(lastIndex, match.index));
    }

    // 添加圖片
    images.push({
      alt: match[1] || "圖片",
      src: match[2],
      type: "image",
    });

    lastIndex = imageRegex.lastIndex;
  }

  // 添加剩餘文本
  if (lastIndex < content.length) {
    textParts.push(content.substring(lastIndex));
  }

  return {
    text: textParts.join("").trim(),
    images,
    videos: [],
  };
};

const testApi = async (type) => {
  apiTestResults.value[type].status = "loading";
  apiTestResults.value[type].error = null;
  apiTestResults.value[type].data = null;
  chatStreamContent.value = "";

  try {
    let url, options;
    if (type === "models") {
      url = "/v1/models";
      options = { headers: settingsStore.getHeaders() };
    } else if (type === "cookies") {
      url = "/v1/cookies";
      options = { headers: settingsStore.getHeaders() };
    } else if (type === "chat") {
      url = "/v1/chat/completions";

      // 構建訊息內容
      let content;
      if (chatImageList.value.length > 0) {
        // 多模态请求
        content = [{ type: "text", text: chatTestPrompt.value }];
        for (const img of chatImageList.value) {
          content.push({
            type: "image_url",
            image_url: { url: img.base64 },
          });
        }
      } else {
        content = chatTestPrompt.value;
      }

      options = {
        method: "POST",
        headers: {
          ...settingsStore.getHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: chatTestModel.value,
          messages: [{ role: "user", content }],
          stream: chatStreamMode.value,
        }),
      };

      // 流式請求處理
      if (chatStreamMode.value) {
        const res = await fetch(url, options);
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error?.message || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const json = JSON.parse(data);
                const delta = json.choices?.[0]?.delta?.content || "";
                chatStreamContent.value += delta;
              } catch {
                /* 忽略解析错误 */
              }
            }
          }
        }

        apiTestResults.value[type].status = "success";
        apiTestResults.value[type].data = { content: chatStreamContent.value };
        return;
      }
    }

    const res = await fetch(url, options);
    const data = await res.json();

    if (res.ok) {
      apiTestResults.value[type].status = "success";
      // Chat 接口：提取 content
      if (type === "chat" && data.choices?.[0]?.message?.content) {
        apiTestResults.value[type].data = {
          content: data.choices[0].message.content,
        };
      } else {
        apiTestResults.value[type].data = data;
      }
    } else {
      apiTestResults.value[type].status = "error";
      apiTestResults.value[type].error =
        data.error?.message || `HTTP ${res.status}`;
    }
  } catch (e) {
    apiTestResults.value[type].status = "error";
    apiTestResults.value[type].error = e.message;
  }
};

const openApiTestDrawer = () => {
  apiTestDrawer.value = true;
  // 重置狀態
  Object.keys(apiTestResults.value).forEach((key) => {
    apiTestResults.value[key] = { status: "pending", data: null, error: null };
  });
  chatImageList.value = [];
  // 取得模型列表
  fetchModelList();
};

// 選單 key 到路由路徑的對應
const menuRoutes = {
  dash: "/",
  history: "/tools/request",
  "settings-server": "/settings/server",
  "settings-workers": "/settings/workers",
  "settings-browser": "/settings/browser",
  "settings-adapters": "/settings/adapters",
  "tools-display": "/tools/display",
  "tools-cache": "/tools/cache",
  "tools-logs": "/tools/logs",
};

// 處理選單點擊
const handleMenuClick = ({ key }) => {
  const route = menuRoutes[key];
  if (route) {
    router.push(route);
    if (isMobile.value) collapsed.value = true;
  }
};

const isInitializing = ref(true);

// 後端連線偵測
let connectionCheckInterval = null;
let disconnectModalShown = false;

async function checkConnection() {
  try {
    const res = await fetch("/admin/status", {
      headers: settingsStore.getHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok && disconnectModalShown) {
      // 連線恢復，重新整理頁面
      disconnectModalShown = false;
      Modal.destroyAll();
      window.location.reload();
    }
  } catch (e) {
    if (!disconnectModalShown && !isInitializing.value) {
      disconnectModalShown = true;
      Modal.warning({
        title: t("connection.disconnectedCN"),
        content: t("connection.disconnectMsgCN"),
        okText: t("connection.gotItCN"),
        centered: true,
      });
    }
  }
}

// 掛載時檢查身分驗證
onMounted(async () => {
  // 響應式側邊欄
  const checkScreenSize = () => {
    isMobile.value = window.innerWidth <= 768;
    if (isMobile.value) {
      collapsed.value = true;
    }
  };
  checkScreenSize();
  window.addEventListener("resize", checkScreenSize);

  // 身分驗證
  try {
    if (!settingsStore.token) {
      loginVisible.value = true;
    } else {
      // 使用真實 API 驗證
      const isValid = await settingsStore.checkAuth();
      if (!isValid) {
        settingsStore.setToken(""); // 清除無效 token
        loginVisible.value = true;
      }
    }
  } catch (e) {
    console.error("Auth check failed", e);
    loginVisible.value = true;
  } finally {
    // 隱藏載入狀態
    isInitializing.value = false;
  }

  // 啟動後端連線偵測（每 5 秒偵測一次）
  connectionCheckInterval = setInterval(checkConnection, 5000);

  // 清理監聽器
  onUnmounted(() => {
    window.removeEventListener("resize", checkScreenSize);
    if (connectionCheckInterval) {
      clearInterval(connectionCheckInterval);
    }
  });
});
</script>

<template>
  <a-spin
    :spinning="isInitializing"
    :tip="$t('header.verifying')"
    size="large"
    style="
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    "
    v-if="isInitializing"
  />
  <div v-else>
    <LoginModal v-model:visible="loginVisible" />
    <a-layout style="min-height: 100vh" theme="light">
      <a-layout-header
        class="header"
        :style="{
          background: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1.5px solid rgba(0, 0, 0, 0.05)',
          display: 'flex',
          alignItems: 'center',
          padding: isMobile ? '0 12px' : '0 24px',
          position: 'fixed',
          width: '100%',
          top: 0,
          zIndex: 1000,
        }"
      >
        <a-button
          v-if="isMobile"
          type="text"
          @click="collapsed = !collapsed"
          style="margin-right: 8px; font-size: 18px"
        >
          <template #icon><MenuOutlined /></template>
        </a-button>
        <div
          class="logo"
          :style="{
            fontSize: '1.25rem',
            fontWeight: 'bold',
            color: '#1890ff',
            marginRight: isMobile ? '8px' : '24px',
          }"
        >
          WebAI2API
        </div>
        <a-flex justify="end" align="center" style="flex: 1" :gap="8">
          <a-select
            v-model:value="locale"
            size="small"
            style="width: 100px"
            @change="
              (val) => {
                locale = val;
                localStorage.setItem('webui_locale', val);
              }
            "
          >
            <a-select-option value="en">English</a-select-option>
            <a-select-option value="zh-CN">简体中文</a-select-option>
            <a-select-option value="zh-TW">繁體中文</a-select-option>
          </a-select>
          <a-button
            @click="openApiTestDrawer"
            :size="isMobile ? 'small' : 'middle'"
          >
            <template #icon>
              <ApiOutlined />
            </template>
            <span v-if="!isMobile">{{ $t("header.apiTest") }}</span>
          </a-button>
          <a-button
            danger
            :loading="iconLoading"
            @click="enterIconLoading"
            :size="isMobile ? 'small' : 'middle'"
          >
            <template #icon>
              <PoweroffOutlined />
            </template>
            <span v-if="!isMobile">{{ $t("header.logout") }}</span>
          </a-button>
        </a-flex>
      </a-layout-header>
      <a-layout style="margin-top: 64px">
        <div
          v-if="isMobile && !collapsed"
          class="sider-mask"
          @click="collapsed = true"
        ></div>
        <a-layout-sider
          v-model:collapsed="collapsed"
          collapsible
          theme="light"
          :collapsed-width="isMobile ? 0 : 80"
          :trigger="isMobile ? null : undefined"
          :style="{
            position: 'fixed',
            left: 0,
            top: '64px',
            height: 'calc(100vh - 64px)',
            overflowY: 'auto',
            zIndex: isMobile ? 200 : 100,
          }"
        >
          <a-menu
            v-model:selectedKeys="selectedKeys"
            mode="inline"
            @click="handleMenuClick"
          >
            <a-menu-item key="dash">
              <DashboardOutlined />
              <span>{{ $t("menu.dash") }}</span>
            </a-menu-item>
            <a-menu-item key="history">
              <RocketOutlined />
              <span>{{ $t("menu.history") }}</span>
            </a-menu-item>
            <a-sub-menu key="settings">
              <template #title>
                <span>
                  <SettingOutlined />
                  <span>{{ $t("menu.settings") }}</span>
                </span>
              </template>
              <a-menu-item key="settings-server">{{
                $t("menu.server")
              }}</a-menu-item>
              <a-menu-item key="settings-workers">{{
                $t("menu.workers")
              }}</a-menu-item>
              <a-menu-item key="settings-browser">{{
                $t("menu.browser")
              }}</a-menu-item>
              <a-menu-item key="settings-adapters">{{
                $t("menu.adapters")
              }}</a-menu-item>
            </a-sub-menu>
            <a-sub-menu key="tools">
              <template #title>
                <span>
                  <ToolOutlined />
                  <span>{{ $t("menu.tools") }}</span>
                </span>
              </template>
              <a-menu-item key="tools-display">{{
                $t("menu.display")
              }}</a-menu-item>
              <a-menu-item key="tools-cache">{{
                $t("menu.cache")
              }}</a-menu-item>
              <a-menu-item key="tools-logs">{{ $t("menu.logs") }}</a-menu-item>
            </a-sub-menu>
          </a-menu>
        </a-layout-sider>
        <a-layout
          :style="{
            marginLeft: isMobile ? '0' : collapsed ? '80px' : '200px',
            padding: isMobile ? '12px' : '16px',
            transition: 'margin-left 0.2s',
          }"
        >
          <a-layout-content style="min-height: 280px">
            <router-view />
          </a-layout-content>
          <a-layout-footer
            class="footer"
            style="padding: 0px; margin-top: 10px"
          >
            <a-card
              :bordered="false"
              :bodyStyle="{
                padding: '16px 24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }"
            >
              <div>
                <a
                  href="https://github.com/foxhui/WebAI2API"
                  target="_blank"
                  style="color: #8c8c8c; font-size: 20px"
                >
                  <GithubOutlined />
                </a>
              </div>
            </a-card>
          </a-layout-footer>
        </a-layout>
      </a-layout>
    </a-layout>

    <!-- 介面測試抽屜 -->
    <a-drawer
      v-model:open="apiTestDrawer"
      :title="$t('apiTest.title')"
      placement="right"
      :width="isMobile ? '100%' : 500"
    >
      <a-space direction="vertical" style="width: 100%" size="large">
        <!-- Models 接口 -->
        <a-card title="GET /v1/models" size="small">
          <template #extra>
            <a-button
              size="small"
              type="primary"
              @click="testApi('models')"
              :loading="apiTestResults.models.status === 'loading'"
            >
              {{ $t("apiTest.test") }}
            </a-button>
          </template>
          <div v-if="apiTestResults.models.status === 'success'">
            <a-tag color="success">
              <CheckCircleOutlined /> {{ $t("apiTest.success") }}
            </a-tag>
            <div style="margin-top: 8px; font-size: 12px; color: #8c8c8c">
              {{
                $t("apiTest.returnedModels", {
                  n: apiTestResults.models.data?.data?.length || 0,
                })
              }}
            </div>
          </div>
          <div v-else-if="apiTestResults.models.status === 'error'">
            <a-tag color="error">
              <CloseCircleOutlined /> {{ $t("apiTest.failed") }}
            </a-tag>
            <div style="margin-top: 8px; font-size: 12px; color: #ff4d4f">
              {{ apiTestResults.models.error }}
            </div>
          </div>
          <div v-else style="color: #8c8c8c; font-size: 12px">
            {{ $t("apiTest.clickToTest") }}
          </div>
        </a-card>

        <!-- Cookies 接口 -->
        <a-card title="GET /v1/cookies" size="small">
          <template #extra>
            <a-button
              size="small"
              type="primary"
              @click="testApi('cookies')"
              :loading="apiTestResults.cookies.status === 'loading'"
            >
              {{ $t("apiTest.test") }}
            </a-button>
          </template>
          <div v-if="apiTestResults.cookies.status === 'success'">
            <a-tag color="success">
              <CheckCircleOutlined /> {{ $t("apiTest.success") }}
            </a-tag>
            <div style="margin-top: 8px; font-size: 12px; color: #8c8c8c">
              {{
                $t("apiTest.returnedCookies", {
                  n: apiTestResults.cookies.data?.cookies?.length || 0,
                })
              }}
            </div>
          </div>
          <div v-else-if="apiTestResults.cookies.status === 'error'">
            <a-tag color="error">
              <CloseCircleOutlined /> {{ $t("apiTest.failed") }}
            </a-tag>
            <div style="margin-top: 8px; font-size: 12px; color: #ff4d4f">
              {{ apiTestResults.cookies.error }}
            </div>
          </div>
          <div v-else style="color: #8c8c8c; font-size: 12px">
            {{ $t("apiTest.clickToTest") }}
          </div>
        </a-card>

        <!-- Chat 接口 -->
        <a-card title="POST /v1/chat/completions" size="small">
          <template #extra>
            <a-button
              size="small"
              type="primary"
              @click="testApi('chat')"
              :loading="apiTestResults.chat.status === 'loading'"
              :disabled="!chatTestModel"
            >
              {{ $t("apiTest.test") }}
            </a-button>
          </template>

          <!-- 模型选择 -->
          <div style="margin-bottom: 12px">
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px">
              {{ $t("request.model") }}
            </div>
            <a-select
              v-model:value="chatTestModel"
              style="width: 100%"
              size="small"
              :placeholder="$t('request.selectModel')"
              show-search
            >
              <a-select-option
                v-for="model in chatModelList"
                :key="model.id"
                :value="model.id"
              >
                {{ model.id }}
              </a-select-option>
            </a-select>
          </div>

          <!-- 提示詞 -->
          <div style="margin-bottom: 12px">
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px">
              {{ $t("request.prompt") }}
            </div>
            <a-textarea
              v-model:value="chatTestPrompt"
              :placeholder="$t('request.enterPrompt')"
              :rows="2"
              size="small"
            />
          </div>

          <!-- 圖片上傳 -->
          <div style="margin-bottom: 12px">
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px">
              {{ $t("request.attachedImagesCN", { n: chatImageList.length }) }}
            </div>
            <a-upload-dragger
              :file-list="[]"
              :multiple="true"
              :before-upload="beforeUpload"
              @change="handleImageChange"
              accept=".png,.jpg,.jpeg,.gif,.webp"
              :show-upload-list="false"
              style="padding: 8px"
            >
              <p style="margin: 0">
                <InboxOutlined style="font-size: 24px; color: #1890ff" />
              </p>
              <p style="font-size: 12px; margin: 4px 0 0 0; color: #8c8c8c">
                {{ $t("request.clickUploadCN") }}
              </p>
            </a-upload-dragger>
            <div
              v-if="chatImageList.length > 0"
              style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px"
            >
              <a-tag
                v-for="img in chatImageList"
                :key="img.uid"
                closable
                @close="
                  chatImageList = chatImageList.filter((i) => i.uid !== img.uid)
                "
              >
                <PictureOutlined /> {{ img.name.slice(0, 15)
                }}{{ img.name.length > 15 ? "..." : "" }}
              </a-tag>
            </div>
          </div>

          <!-- 流式选项 -->
          <div style="margin-bottom: 12px">
            <a-checkbox v-model:checked="chatStreamMode">{{
              $t("apiTest.streamingResponse")
            }}</a-checkbox>
          </div>

          <!-- 测试结果 -->
          <!-- 載入中或成功：統一顯示內容 -->
          <div
            v-if="
              apiTestResults.chat.status === 'loading' ||
              apiTestResults.chat.status === 'success'
            "
          >
            <!-- 狀態標籤 -->
            <div style="margin-bottom: 8px">
              <a-tag
                v-if="apiTestResults.chat.status === 'loading'"
                color="processing"
              >
                <LoadingOutlined />
                {{
                  chatStreamMode
                    ? $t("apiTest.streamingResponse")
                    : $t("apiTest.requesting")
                }}
              </a-tag>
              <a-tag v-else color="success">
                <CheckCircleOutlined /> {{ $t("apiTest.success") }}
              </a-tag>
            </div>

            <!-- 内容显示容器（流式用 chatStreamContent，成功后用 data.content） -->
            <div
              v-if="
                chatStreamMode
                  ? chatStreamContent
                  : apiTestResults.chat.data?.content
              "
              style="
                font-size: 12px;
                max-height: 400px;
                overflow-y: auto;
                background: #fafafa;
                padding: 8px;
                border-radius: 4px;
              "
            >
              <!-- 文本内容 -->
              <pre
                v-if="
                  parseMarkdownImages(
                    chatStreamMode
                      ? chatStreamContent
                      : apiTestResults.chat.data?.content,
                  ).text
                "
                style="
                  white-space: pre-wrap;
                  word-break: break-all;
                  margin: 0 0 8px 0;
                "
                >{{
                  parseMarkdownImages(
                    chatStreamMode
                      ? chatStreamContent
                      : apiTestResults.chat.data?.content,
                  ).text
                }}</pre
              >

              <!-- 圖片展示 -->
              <div
                v-if="
                  parseMarkdownImages(
                    chatStreamMode
                      ? chatStreamContent
                      : apiTestResults.chat.data?.content,
                  ).images.length > 0
                "
                style="display: flex; flex-direction: column; gap: 8px"
              >
                <div
                  v-for="(img, index) in parseMarkdownImages(
                    chatStreamMode
                      ? chatStreamContent
                      : apiTestResults.chat.data?.content,
                  ).images"
                  :key="index"
                  style="
                    border: 1px solid #d9d9d9;
                    border-radius: 4px;
                    padding: 4px;
                    background: white;
                  "
                >
                  <div
                    style="font-size: 11px; color: #8c8c8c; margin-bottom: 4px"
                  >
                    {{ img.alt }}
                  </div>
                  <img
                    :src="img.src"
                    :alt="img.alt"
                    style="
                      max-width: 100%;
                      height: auto;
                      display: block;
                      border-radius: 2px;
                    "
                  />
                </div>
              </div>

              <!-- 视频展示 -->
              <div
                v-if="
                  parseMarkdownImages(
                    chatStreamMode
                      ? chatStreamContent
                      : apiTestResults.chat.data?.content,
                  ).videos.length > 0
                "
                style="display: flex; flex-direction: column; gap: 8px"
              >
                <div
                  v-for="(video, index) in parseMarkdownImages(
                    chatStreamMode
                      ? chatStreamContent
                      : apiTestResults.chat.data?.content,
                  ).videos"
                  :key="'video-' + index"
                  style="
                    border: 1px solid #d9d9d9;
                    border-radius: 4px;
                    padding: 4px;
                    background: white;
                  "
                >
                  <div
                    style="font-size: 11px; color: #8c8c8c; margin-bottom: 4px"
                  >
                    {{ $t("request.detail.generatedVideo") }}
                  </div>
                  <video
                    :src="video.src"
                    controls
                    style="
                      max-width: 100%;
                      height: auto;
                      display: block;
                      border-radius: 2px;
                    "
                  >
                    {{ $t("request.detail.videoNotSupportedCN") }}
                  </video>
                </div>
              </div>
            </div>
          </div>

          <!-- 錯誤狀態 -->
          <div v-else-if="apiTestResults.chat.status === 'error'">
            <a-tag color="error">
              <CloseCircleOutlined /> {{ $t("apiTest.failed") }}
            </a-tag>
            <div style="margin-top: 8px; font-size: 12px; color: #ff4d4f">
              {{ apiTestResults.chat.error }}
            </div>
          </div>
        </a-card>
      </a-space>
    </a-drawer>
  </div>
</template>

<style scoped>
/* 捲軸美化 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-thumb {
  background: #ccc;
  border-radius: 3px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
}

.sider-mask {
  position: fixed;
  top: 64px;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 199;
}
</style>
