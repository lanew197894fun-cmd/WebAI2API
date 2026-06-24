<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@/stores/settings";
import {
  DesktopOutlined,
  DisconnectOutlined,
  ExpandOutlined,
  CompressOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";

const { t } = useI18n();
const settingsStore = useSettingsStore();

const loading = ref(true);
const vncStatus = ref(null);
const connectionState = ref("disconnected");
const errorMessage = ref("");
const isFullscreen = ref(false);

const vncContainer = ref(null);

let rfb = null;
let RFB = null;

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

async function connectVnc() {
  if (!vncStatus.value?.enabled) return;

  connectionState.value = "connecting";
  errorMessage.value = "";

  try {
    if (!RFB) {
      const module = await import("@novnc/novnc/core/rfb.js");
      RFB = module.default;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/admin/vnc?token=${settingsStore.token}`;

    rfb = new RFB(vncContainer.value, wsUrl, {
      wsProtocols: ["binary"],
    });

    rfb.scaleViewport = true;
    rfb.clipViewport = false;
    rfb.resizeSession = false;

    rfb.addEventListener("connect", () => {
      connectionState.value = "connected";
    });

    rfb.addEventListener("disconnect", (e) => {
      connectionState.value = "disconnected";
      if (e.detail.clean === false) {
        errorMessage.value = t("display.disconnected");
      }
      rfb = null;
    });

    rfb.addEventListener("credentialsrequired", () => {
      rfb.sendCredentials({ password: "" });
    });
  } catch (e) {
    connectionState.value = "error";
    errorMessage.value = e.message || t("display.disconnected");
  }
}

function disconnectVnc() {
  if (rfb) {
    rfb.disconnect();
    rfb = null;
  }
  connectionState.value = "disconnected";
}

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
    <a-card :title="$t('display.title')" :bordered="false" style="height: 100%">
      <div v-if="loading" style="text-align: center; padding: 48px">
        <a-spin size="large" />
        <div style="margin-top: 16px; color: #8c8c8c">
          {{ $t("common.loading") }}
        </div>
      </div>

      <div
        v-else-if="!vncStatus?.xvfbMode"
        style="text-align: center; padding: 48px"
      >
        <DisconnectOutlined style="font-size: 64px; color: #bfbfbf" />
        <div style="margin-top: 16px; font-size: 16px; color: #595959">
          {{ $t("display.vncUnavailable") }}
        </div>
        <div style="margin-top: 8px; color: #8c8c8c">
          VNC {{ $t("display.disconnected") }}
        </div>
      </div>

      <div
        v-else-if="!vncStatus?.enabled"
        style="text-align: center; padding: 48px"
      >
        <DesktopOutlined style="font-size: 64px; color: #bfbfbf" />
        <div style="margin-top: 16px; font-size: 16px; color: #595959">
          {{ $t("display.vncUnavailable") }}
        </div>
        <div style="margin-top: 8px; color: #8c8c8c">
          <code>-vnc</code> x11vnc
        </div>
      </div>

      <div v-else>
        <div
          style="
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          "
        >
          <div>
            <a-tag v-if="connectionState === 'connected'" color="success">{{
              $t("display.connected")
            }}</a-tag>
            <a-tag
              v-else-if="connectionState === 'connecting'"
              color="processing"
              >{{ $t("display.connecting") }}</a-tag
            >
            <a-tag v-else-if="connectionState === 'error'" color="error">{{
              $t("display.disconnected")
            }}</a-tag>
            <a-tag v-else color="default">{{
              $t("display.disconnected")
            }}</a-tag>
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
              {{ $t("display.connect") }}
            </a-button>
            <a-button v-else danger @click="disconnectVnc">
              <template #icon>
                <DisconnectOutlined />
              </template>
              {{ $t("display.disconnect") }}
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
              <div style="margin-top: 16px">{{ $t("display.connect") }}</div>
            </div>
          </div>
        </div>

        <div style="margin-top: 12px; font-size: 12px; color: #8c8c8c">
          {{ vncStatus.display }} | VNC Port: {{ vncStatus.port }}
        </div>
      </div>
    </a-card>
  </a-layout>
</template>
