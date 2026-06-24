<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useSettingsStore } from "@/stores/settings";
import {
  DesktopOutlined,
  DisconnectOutlined,
  ExpandOutlined,
  CompressOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";

const settingsStore = useSettingsStore();

// 狀態
const loading = ref(true);
const vncStatus = ref(null);
const connectionState = ref("disconnected"); // disconnected, connecting, connected, error
const errorMessage = ref("");
const isFullscreen = ref(false);

// DOM 引用
const vncContainer = ref(null);

// noVNC 實例
let rfb = null;
let RFB = null;

// 取得 VNC 狀態
async function fetchVncStatus() {
  try {
    const res = await fetch("/admin/vnc/status", {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      vncStatus.value = await res.json();
    }
  } catch (e) {
    console.error("取得 VNC 狀態失敗", e);
  } finally {
    loading.value = false;
  }
}

// 連接 VNC
async function connectVnc() {
  if (!vncStatus.value?.enabled) return;

  connectionState.value = "connecting";
  errorMessage.value = "";

  try {
    // 動態匯入 noVNC
    if (!RFB) {
      const module = await import("@novnc/novnc/core/rfb.js");
      RFB = module.default;
    }

    // 構建 WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/admin/vnc?token=${settingsStore.token}`;

    // 建立 RFB 實例
    rfb = new RFB(vncContainer.value, wsUrl, {
      wsProtocols: ["binary"],
    });

    // 配置
    rfb.scaleViewport = true; // 縮放遠端畫面以適應容器
    rfb.clipViewport = false; // 不裁剪視口
    rfb.resizeSession = false; // 允許調整遠端解析度

    // 事件監聽
    rfb.addEventListener("connect", () => {
      connectionState.value = "connected";
    });

    rfb.addEventListener("disconnect", (e) => {
      connectionState.value = "disconnected";
      if (e.detail.clean === false) {
        errorMessage.value = "連線意外中斷";
      }
      rfb = null;
    });

    rfb.addEventListener("credentialsrequired", () => {
      rfb.sendCredentials({ password: "" });
    });
  } catch (e) {
    connectionState.value = "error";
    errorMessage.value = e.message || "連線失敗";
  }
}

// 斷開連線
function disconnectVnc() {
  if (rfb) {
    rfb.disconnect();
    rfb = null;
  }
  connectionState.value = "disconnected";
}

// 切換全螢幕
function toggleFullscreen() {
  if (!vncContainer.value) return;

  if (!document.fullscreenElement) {
    vncContainer.value.requestFullscreen();
    isFullscreen.value = true;
  } else {
    document.exitFullscreen();
    isFullscreen.value = false;
  }
}

// 監聽全螢幕變化
function handleFullscreenChange() {
  isFullscreen.value = !!document.fullscreenElement;
}

onMounted(async () => {
  await fetchVncStatus();
  document.addEventListener("fullscreenchange", handleFullscreenChange);
});

onUnmounted(() => {
  disconnectVnc();
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
});
</script>

<template>
  <a-layout style="background: transparent">
    <a-card title="虛擬顯示器" :bordered="false" style="height: 100%">
      <!-- 載入中 -->
      <div v-if="loading" style="text-align: center; padding: 48px">
        <a-spin size="large" />
        <div style="margin-top: 16px; color: #8c8c8c">正在檢查 VNC 狀態...</div>
      </div>

      <!-- 非 xvfbMode -->
      <div
        v-else-if="!vncStatus?.xvfbMode"
        style="text-align: center; padding: 48px"
      >
        <DisconnectOutlined style="font-size: 64px; color: #bfbfbf" />
        <div style="margin-top: 16px; font-size: 16px; color: #595959">
          程式未使用虛擬顯示器執行
        </div>
        <div style="margin-top: 8px; color: #8c8c8c">
          VNC 遠端顯示功能僅在 Linux 環境下使用
          <code>-xvfb -vnc</code> 參數啟動時可用
        </div>
      </div>

      <!-- xvfbMode 但 VNC 未啟用 -->
      <div
        v-else-if="!vncStatus?.enabled"
        style="text-align: center; padding: 48px"
      >
        <DesktopOutlined style="font-size: 64px; color: #bfbfbf" />
        <div style="margin-top: 16px; font-size: 16px; color: #595959">
          VNC 服務未啟動
        </div>
        <div style="margin-top: 8px; color: #8c8c8c">
          請確保啟動時包含 <code>-vnc</code> 參數，並已安裝 x11vnc
        </div>
      </div>

      <!-- VNC 可用 -->
      <div v-else>
        <!-- 控制列 -->
        <div
          style="
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          "
        >
          <div>
            <a-tag v-if="connectionState === 'connected'" color="success"
              >已連線</a-tag
            >
            <a-tag
              v-else-if="connectionState === 'connecting'"
              color="processing"
              >連線中...</a-tag
            >
            <a-tag v-else-if="connectionState === 'error'" color="error"
              >連線錯誤</a-tag
            >
            <a-tag v-else color="default">未連線</a-tag>
            <span
              v-if="errorMessage"
              style="margin-left: 8px; color: #ff4d4f; font-size: 12px"
            >
              {{ errorMessage }}
            </span>
          </div>
          <a-space>
            <a-button
              v-if="connectionState !== 'connected'"
              type="primary"
              @click="connectVnc"
              :loading="connectionState === 'connecting'"
            >
              <template #icon>
                <DesktopOutlined />
              </template>
              連線
            </a-button>
            <a-button v-else danger @click="disconnectVnc">
              <template #icon>
                <DisconnectOutlined />
              </template>
              斷開
            </a-button>
            <a-button
              @click="toggleFullscreen"
              :disabled="connectionState !== 'connected'"
            >
              <template #icon>
                <CompressOutlined v-if="isFullscreen" />
                <ExpandOutlined v-else />
              </template>
            </a-button>
            <a-button @click="fetchVncStatus">
              <template #icon>
                <ReloadOutlined />
              </template>
            </a-button>
          </a-space>
        </div>

        <!-- VNC 顯示區域 -->
        <div
          ref="vncContainer"
          style="
            width: 100%;
            aspect-ratio: 16/9;
            min-height: 400px;
            max-height: 70vh;
            background: #000;
            border-radius: 8px;
            overflow: hidden;
          "
        >
          <div
            v-if="connectionState === 'disconnected'"
            style="
              height: 100%;
              display: flex;
              align-items: center;
              justify-content: center;
              color: #595959;
            "
          >
            <div style="text-align: center">
              <DesktopOutlined style="font-size: 48px; color: #434343" />
              <div style="margin-top: 16px">點擊「連線」按鈕檢視遠端顯示器</div>
            </div>
          </div>
        </div>

        <!-- 資訊 -->
        <div style="margin-top: 12px; font-size: 12px; color: #8c8c8c">
          顯示器: {{ vncStatus.display }} | VNC 埠號: {{ vncStatus.port }}
        </div>
      </div>
    </a-card>
  </a-layout>
</template>
