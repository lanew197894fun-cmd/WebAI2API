<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@/stores/settings";
import {
  ReloadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  RocketOutlined,
  RedoOutlined,
  InboxOutlined,
  LoadingOutlined,
  CopyOutlined,
} from "@ant-design/icons-vue";
import { message, Modal } from "ant-design-vue";

const { t } = useI18n();
const settingsStore = useSettingsStore();

const loading = ref(false);
const records = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);

const dateRange = ref([]);
const statusFilter = ref("all");
const modelFilter = ref("");
const searchText = ref("");
const modelOptions = ref([]);

const selectedRowKeys = ref([]);
const selectedRows = ref([]);

const stats = ref({ total: 0, success: 0, failed: 0, avgDuration: 0 });

const drawerVisible = ref(false);
const currentRecord = ref(null);
const detailLoading = ref(false);

const previewModalVisible = ref(false);
const previewContent = ref("");
const previewMediaType = ref("text");
const previewMediaUrl = ref("");
const previewTitle = ref(t("request.preview.responsePreview"));

const mediaCache = ref({});

const sendModelList = ref([]);
const sendModel = ref("");
const sendPrompt = ref("");
const sendImageList = ref([]);
const sendStreamMode = ref(false);
const sendReasoningMode = ref(true);
const sending = ref(false);

const currentModelSupportsImage = computed(() => {
  if (!sendModel.value) return false;
  const model = sendModelList.value.find((m) => m.id === sendModel.value);
  if (!model) return false;
  return model.image_policy !== "forbidden";
});

let autoRefreshInterval = null;

const isMobile = ref(window.innerWidth <= 768);
let resizeHandler = null;

const statusConfig = computed(() => ({
  success: {
    color: "#52c41a",
    text: t("common.success"),
    icon: CheckCircleOutlined,
  },
  failed: {
    color: "#ff4d4f",
    text: t("common.failed"),
    icon: CloseCircleOutlined,
  },
  pending: {
    color: "#faad14",
    text: t("common.pending"),
    icon: ClockCircleOutlined,
  },
}));

const fetchHistory = async () => {
  loading.value = true;
  try {
    const params = new URLSearchParams({
      page: page.value,
      pageSize: pageSize.value,
    });

    if (statusFilter.value && statusFilter.value !== "all") {
      params.append("status", statusFilter.value);
    }
    if (modelFilter.value) {
      params.append("model", modelFilter.value);
    }
    if (searchText.value) {
      params.append("search", searchText.value);
    }
    if (dateRange.value && dateRange.value.length === 2) {
      params.append("startDate", dateRange.value[0].format("YYYY-MM-DD"));
      params.append("endDate", dateRange.value[1].format("YYYY-MM-DD"));
    }

    const res = await fetch(`/admin/history?${params.toString()}`, {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      records.value = data.items || [];
      total.value = data.total || 0;
      preloadThumbnails();
    }
  } catch (e) {
    message.error(t("common.failed"));
  } finally {
    loading.value = false;
  }
};

const preloadThumbnails = async () => {
  for (const record of records.value) {
    if (record.responseMedia && record.responseMedia.length > 0) {
      const media = record.responseMedia[0];
      if (media.localPath && media.status === "downloaded") {
        await getMediaBlobUrl(media);
      }
    }
  }
};

const fetchStats = async () => {
  try {
    const params = new URLSearchParams();
    if (dateRange.value && dateRange.value.length === 2) {
      params.append("startDate", dateRange.value[0].format("YYYY-MM-DD"));
      params.append("endDate", dateRange.value[1].format("YYYY-MM-DD"));
    }

    const res = await fetch(`/admin/history/stats?${params.toString()}`, {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      stats.value = await res.json();
    }
  } catch (e) {
    console.error("取得統計失敗", e);
  }
};

const fetchModels = async () => {
  try {
    const res = await fetch("/admin/history/models", {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      modelOptions.value = await res.json();
    }
  } catch (e) {
    console.error("取得模型列表失敗", e);
  }
};

const viewDetail = async (record) => {
  drawerVisible.value = true;
  detailLoading.value = true;
  try {
    const res = await fetch(`/admin/history/${record.id}`, {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      currentRecord.value = await res.json();
      if (currentRecord.value.responseMedia) {
        for (const media of currentRecord.value.responseMedia) {
          if (media.localPath && media.status === "downloaded") {
            await getMediaBlobUrl(media);
          }
        }
      }
    }
  } catch (e) {
    message.error(t("common.failed"));
  } finally {
    detailLoading.value = false;
  }
};

const getMediaBlobUrl = async (media) => {
  if (!media.localPath) return null;

  const filename = media.localPath.split("/").pop();
  const cacheKey = filename;

  if (mediaCache.value[cacheKey]) {
    return mediaCache.value[cacheKey];
  }

  try {
    const res = await fetch(`/admin/history/media/${filename}`, {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      mediaCache.value[cacheKey] = blobUrl;
      return blobUrl;
    }
  } catch (e) {
    console.error("取得媒體失敗", e);
  }
  return null;
};

const getCachedMediaUrl = (media) => {
  if (!media || !media.localPath) return null;
  const filename = media.localPath.split("/").pop();
  return mediaCache.value[filename] || null;
};

const retryMedia = async (recordId, mediaIndex) => {
  try {
    const res = await fetch(`/admin/history/${recordId}/retry-media`, {
      method: "POST",
      headers: {
        ...settingsStore.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mediaIndex }),
    });

    if (res.ok) {
      message.success(t("request.detail.downloadSuccess"));
      fetchHistory();
      if (currentRecord.value && currentRecord.value.id === recordId) {
        viewDetail(currentRecord.value);
      }
    } else {
      const data = await res.json();
      message.error(data.message || t("request.detail.downloadFailed"));
    }
  } catch (e) {
    message.error(t("common.failed"));
  }
};

const deleteRecords = (ids) => {
  Modal.confirm({
    title: t("common.confirmDelete"),
    content: t("common.confirmDeleteItems", { n: ids.length }),
    okText: t("common.delete"),
    okType: "danger",
    cancelText: t("common.cancel"),
    async onOk() {
      try {
        const res = await fetch("/admin/history", {
          method: "DELETE",
          headers: {
            ...settingsStore.getHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ids }),
        });
        if (res.ok) {
          message.success(t("common.success"));
          clearSelection();
          fetchHistory();
          fetchStats();
        } else {
          message.error(t("common.failed"));
        }
      } catch (e) {
        message.error(t("common.failed"));
      }
    },
  });
};

const deleteByDateRange = () => {
  if (!dateRange.value || dateRange.value.length !== 2) {
    message.warning(t("logs.selectDateRange"));
    return;
  }

  Modal.confirm({
    title: t("request.deleteRange.title"),
    content: t("request.deleteRange.content", {
      start: dateRange.value[0].format("YYYY-MM-DD"),
      end: dateRange.value[1].format("YYYY-MM-DD"),
    }),
    okText: t("common.delete"),
    okType: "danger",
    cancelText: t("common.cancel"),
    async onOk() {
      try {
        const params = new URLSearchParams({
          startDate: dateRange.value[0].format("YYYY-MM-DD"),
          endDate: dateRange.value[1].format("YYYY-MM-DD"),
        });
        const res = await fetch(`/admin/history?${params.toString()}`, {
          method: "DELETE",
          headers: settingsStore.getHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          message.success(
            t("request.deleteRange.deleted", { n: data.deleted }),
          );
          clearSelection();
          fetchHistory();
          fetchStats();
        } else {
          message.error(t("common.failed"));
        }
      } catch (e) {
        message.error(t("common.failed"));
      }
    },
  });
};

const formatTime = (timestamp) => {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  return date.toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDuration = (ms) => {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const truncateText = (text, maxLen = 120) => {
  if (!text) return "-";
  return text.length > maxLen ? text.substring(0, maxLen) + "..." : text;
};

const hasMedia = (record) => {
  return record.responseMedia && record.responseMedia.length > 0;
};

const getFirstMedia = (record) => {
  if (!hasMedia(record)) return null;
  return record.responseMedia[0];
};

const columns = computed(() => [
  {
    title: t("request.table.status"),
    dataIndex: "status",
    key: "status",
    width: 70,
    align: "center",
  },
  {
    title: t("request.table.prompt"),
    dataIndex: "prompt",
    key: "prompt",
    width: 200,
  },
  {
    title: t("request.table.model"),
    dataIndex: "model_name",
    key: "model_name",
    width: 150,
    ellipsis: true,
  },
  {
    title: t("request.table.response"),
    key: "response",
    width: 220,
  },
  {
    title: t("request.table.media"),
    key: "media",
    width: 180,
    align: "center",
  },
  {
    title: t("request.table.time"),
    dataIndex: "created_at",
    key: "created_at",
    width: 100,
    customRender: ({ value }) => formatTime(value),
  },
  {
    title: t("request.table.duration"),
    dataIndex: "duration_ms",
    key: "duration_ms",
    width: 60,
    align: "right",
    customRender: ({ value }) => formatDuration(value),
  },
  {
    title: t("request.table.action"),
    key: "action",
    width: 100,
    align: "center",
    fixed: "right",
  },
]);

watch([statusFilter, modelFilter, dateRange], () => {
  page.value = 1;
  fetchHistory();
  fetchStats();
});

watch(sendModel, () => {
  sendImageList.value = [];
});

let searchTimeout = null;
watch(searchText, () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    page.value = 1;
    fetchHistory();
  }, 300);
});

const handleTableChange = (pagination) => {
  page.value = pagination.current;
  pageSize.value = pagination.pageSize;
  clearSelection();
  fetchHistory();
};

const handleRefresh = () => {
  fetchHistory();
  fetchModels();
};

const previewResponse = async (record) => {
  previewModalVisible.value = true;
  previewMediaType.value = "text";
  previewTitle.value = t("request.preview.responsePreview");
  if (record.status === "failed") {
    previewContent.value =
      record.error_message || t("request.detail.unknownError");
  } else {
    previewContent.value =
      record.response_text || t("request.detail.noResponse");
  }
};

const previewPrompt = (record) => {
  previewModalVisible.value = true;
  previewMediaType.value = "text";
  previewTitle.value = t("request.preview.promptPreview");
  previewContent.value = record.prompt || t("request.detail.none");
};

const copyPreviewContent = async () => {
  try {
    await navigator.clipboard.writeText(previewContent.value);
    message.success(t("request.preview.copied"));
  } catch (e) {
    message.error(t("request.preview.copyFailed"));
  }
};

const previewMedia = async (record) => {
  const media = getFirstMedia(record);
  if (!media) return;

  if (media.type === "image") {
    previewMediaType.value = "image";
  } else if (media.type === "video") {
    previewMediaType.value = "video";
  } else {
    previewMediaType.value = "text";
    previewContent.value = media.originalUrl || t("request.detail.none");
    previewModalVisible.value = true;
    return;
  }

  if (media.status === "downloaded") {
    const url = await getMediaBlobUrl(media);
    if (url) {
      previewMediaUrl.value = url;
      previewModalVisible.value = true;
    } else {
      message.error(t("common.failed"));
    }
  } else {
    previewContent.value = t("request.detail.retryDownload");
    previewMediaType.value = "text";
    previewModalVisible.value = true;
  }
};

const closePreview = () => {
  previewModalVisible.value = false;
  previewContent.value = "";
  previewMediaUrl.value = "";
  previewMediaType.value = "text";
  previewTitle.value = t("request.preview.responsePreview");
};

const onSelectChange = (keys, rows) => {
  selectedRowKeys.value = keys;
  selectedRows.value = rows;
};

const deleteSelected = () => {
  if (selectedRowKeys.value.length === 0) {
    message.warning(t("common.failed"));
    return;
  }
  deleteRecords(selectedRowKeys.value);
};

const clearSelection = () => {
  selectedRowKeys.value = [];
  selectedRows.value = [];
};

const fetchSendModelList = async () => {
  try {
    const res = await fetch("/v1/models", {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      sendModelList.value = data.data || [];
      if (sendModelList.value.length > 0 && !sendModel.value) {
        sendModel.value = sendModelList.value[0].id;
      }
    }
  } catch (e) {
    console.error("取得模型列表失敗", e);
  }
};

const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
  });
};

const beforeUpload = (file) => {
  const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    message.error(t("request.imageFormatErrorCN"));
    return false;
  }
  if (sendImageList.value.length >= 10) {
    message.error(t("request.maxImagesErrorCN"));
    return false;
  }
  return false;
};

const handleSendImageChange = async (info) => {
  const file = info.file;
  if (file.status === "removed") {
    sendImageList.value = sendImageList.value.filter((f) => f.uid !== file.uid);
    return;
  }
  try {
    const base64 = await fileToBase64(file.originFileObj || file);
    sendImageList.value.push({ uid: file.uid, name: file.name, base64 });
  } catch (e) {
    message.error(t("request.imageReadErrorCN"));
  }
};

const sendRequest = () => {
  if (!sendModel.value) {
    message.warning(t("request.actions.selectModelWarn"));
    return;
  }
  if (!sendPrompt.value.trim()) {
    message.warning(t("request.actions.enterPromptWarn"));
    return;
  }

  let content;
  if (sendImageList.value.length > 0) {
    content = [{ type: "text", text: sendPrompt.value }];
    for (const img of sendImageList.value) {
      content.push({ type: "image_url", image_url: { url: img.base64 } });
    }
  } else {
    content = sendPrompt.value;
  }

  const body = {
    model: sendModel.value,
    messages: [{ role: "user", content }],
    stream: sendStreamMode.value,
  };
  if (sendReasoningMode.value) {
    body.reasoning = true;
  }

  fetch("/v1/chat/completions", {
    method: "POST",
    headers: {
      ...settingsStore.getHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch(() => {});

  message.success(t("request.actions.requestSent"));

  sendPrompt.value = "";
  sendImageList.value = [];

  startAutoRefresh();
  setTimeout(() => {
    silentFetchHistory();
    silentFetchStats();
  }, 1000);
};

const silentDeleteRecord = async (id) => {
  try {
    await fetch("/admin/history", {
      method: "DELETE",
      headers: {
        ...settingsStore.getHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: [id] }),
    });
  } catch (e) {}
};

const resendFromRecord = (record) => {
  const modelId = record.model_id || record.model_name;
  if (modelId) {
    sendModel.value = modelId;
  }
  if (record.prompt) {
    sendPrompt.value = record.prompt;
  }
  sendImageList.value = [];

  const shouldDelete = record.status === "failed";

  sendRequest();

  if (shouldDelete) {
    silentDeleteRecord(record.id);
  }
};

const silentFetchHistory = async () => {
  try {
    const params = new URLSearchParams({
      page: page.value,
      pageSize: pageSize.value,
    });
    if (statusFilter.value && statusFilter.value !== "all")
      params.append("status", statusFilter.value);
    if (modelFilter.value) params.append("model", modelFilter.value);
    if (searchText.value) params.append("search", searchText.value);
    if (dateRange.value && dateRange.value.length === 2) {
      params.append("startDate", dateRange.value[0].format("YYYY-MM-DD"));
      params.append("endDate", dateRange.value[1].format("YYYY-MM-DD"));
    }
    const res = await fetch(`/admin/history?${params.toString()}`, {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      records.value = data.items || [];
      total.value = data.total || 0;
      preloadThumbnails();
    }
  } catch (e) {}
};

const silentFetchStats = async () => {
  try {
    const params = new URLSearchParams();
    if (dateRange.value && dateRange.value.length === 2) {
      params.append("startDate", dateRange.value[0].format("YYYY-MM-DD"));
      params.append("endDate", dateRange.value[1].format("YYYY-MM-DD"));
    }
    const res = await fetch(`/admin/history/stats?${params.toString()}`, {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      stats.value = await res.json();
    }
  } catch (e) {}
};

const startAutoRefresh = () => {
  if (autoRefreshInterval) return;
  autoRefreshInterval = setInterval(() => {
    silentFetchHistory();
    silentFetchStats();
  }, 5000);
};

const stopAutoRefresh = () => {
  if (autoRefreshInterval) {
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
};

onMounted(() => {
  resizeHandler = () => {
    isMobile.value = window.innerWidth <= 768;
  };
  window.addEventListener("resize", resizeHandler);
  fetchHistory();
  fetchStats();
  fetchModels();
  fetchSendModelList();
});

onUnmounted(() => {
  stopAutoRefresh();
  if (resizeHandler) window.removeEventListener("resize", resizeHandler);
});
</script>

<template>
  <a-card
    :title="$t('request.sendRequest')"
    :bordered="false"
    style="margin-bottom: 24px"
  >
    <div style="display: flex; gap: 16px; flex-wrap: wrap">
      <div style="flex: 1; min-width: 280px">
        <div style="margin-bottom: 12px">
          <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px">
            {{ $t("request.model") }}
          </div>
          <a-select
            v-model:value="sendModel"
            style="width: 100%"
            size="small"
            :placeholder="$t('request.selectModel')"
            show-search
          >
            <a-select-option
              v-for="model in sendModelList"
              :key="model.id"
              :value="model.id"
            >
              {{ model.id }}
            </a-select-option>
          </a-select>
        </div>

        <div style="margin-bottom: 12px">
          <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px">
            {{ $t("request.prompt") }}
          </div>
          <a-textarea
            v-model:value="sendPrompt"
            :placeholder="$t('request.enterPrompt')"
            :rows="3"
            size="small"
          />
        </div>

        <div
          style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap"
        >
          <a-checkbox v-model:checked="sendStreamMode">{{
            $t("request.streamResponse")
          }}</a-checkbox>
          <a-checkbox v-model:checked="sendReasoningMode">{{
            $t("request.returnReasoning")
          }}</a-checkbox>
          <a-button type="primary" @click="sendRequest" :disabled="!sendModel">
            <template #icon><RocketOutlined /></template>
            {{ $t("request.send") }}
          </a-button>
        </div>
      </div>

      <div v-if="currentModelSupportsImage" class="send-upload-area">
        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px">
          {{ $t("request.attachedImagesCN", { n: sendImageList.length }) }}
        </div>
        <a-upload-dragger
          :file-list="[]"
          :multiple="true"
          :before-upload="beforeUpload"
          @change="handleSendImageChange"
          accept=".png,.jpg,.jpeg,.gif,.webp"
          :show-upload-list="false"
        >
          <p style="margin: 0">
            <InboxOutlined style="font-size: 20px; color: #1890ff" />
          </p>
          <p style="font-size: 12px; margin: 2px 0 0 0; color: #8c8c8c">
            {{ $t("request.clickUploadCN") }}
          </p>
        </a-upload-dragger>
        <div
          v-if="sendImageList.length > 0"
          style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px"
        >
          <a-tag
            v-for="img in sendImageList"
            :key="img.uid"
            closable
            @close="
              sendImageList = sendImageList.filter((i) => i.uid !== img.uid)
            "
          >
            <PictureOutlined /> {{ img.name.slice(0, 15)
            }}{{ img.name.length > 15 ? "..." : "" }}
          </a-tag>
        </div>
      </div>
    </div>
  </a-card>

  <a-card :title="$t('request.pageTitle')" :bordered="false">
    <template #extra>
      <a-button
        type="link"
        danger
        size="small"
        @click="deleteByDateRange"
        :disabled="!dateRange || dateRange.length !== 2"
      >
        <template #icon>
          <DeleteOutlined />
        </template>
        {{ $t("request.stats.deleteRange") }}
      </a-button>
    </template>

    <div class="stats-content">
      <a-range-picker
        v-model:value="dateRange"
        :format="'YYYY-MM-DD'"
        :placeholder="[
          $t('request.filter.startDate'),
          $t('request.filter.endDate'),
        ]"
        size="small"
        class="stats-date-picker"
      />

      <a-divider type="vertical" style="height: 32px; margin: 0 16px" />

      <div class="stats-numbers">
        <div class="stat-item neutral">
          <FileTextOutlined />
          <span class="stat-value">{{ stats.total }}</span>
          <span class="stat-label">{{
            $t("request.stats.totalRequests")
          }}</span>
        </div>
        <div class="stat-item success">
          <CheckCircleOutlined />
          <span class="stat-value">{{ stats.success }}</span>
          <span class="stat-label">{{ $t("request.stats.success") }}</span>
        </div>
        <div class="stat-item error">
          <CloseCircleOutlined />
          <span class="stat-value">{{ stats.failed }}</span>
          <span class="stat-label">{{ $t("request.stats.failed") }}</span>
        </div>
        <div class="stat-item neutral">
          <ClockCircleOutlined />
          <span class="stat-value">{{
            formatDuration(stats.avgDuration)
          }}</span>
          <span class="stat-label">{{ $t("request.stats.avgDuration") }}</span>
        </div>
      </div>
    </div>
  </a-card>

  <a-card :bordered="false" style="margin-top: 24px">
    <div class="toolbar">
      <div class="toolbar-row">
        <a-select
          v-model:value="statusFilter"
          class="toolbar-status-select"
          size="small"
          :placeholder="$t('request.filter.allStatus')"
        >
          <a-select-option value="all">{{
            $t("request.filter.allStatus")
          }}</a-select-option>
          <a-select-option value="success">{{
            $t("request.filter.success")
          }}</a-select-option>
          <a-select-option value="failed">{{
            $t("request.filter.failed")
          }}</a-select-option>
          <a-select-option value="pending">{{
            $t("request.filter.pending")
          }}</a-select-option>
        </a-select>
        <a-select
          v-model:value="modelFilter"
          class="toolbar-model-select"
          size="small"
          :placeholder="$t('request.filter.allModels')"
          allow-clear
          show-search
        >
          <a-select-option
            v-for="model in modelOptions"
            :key="model"
            :value="model"
          >
            {{ model }}
          </a-select-option>
        </a-select>
        <a-button size="small" @click="handleRefresh">
          <template #icon>
            <ReloadOutlined />
          </template>
        </a-button>
        <a-button
          v-if="selectedRowKeys.length > 0"
          type="primary"
          danger
          size="small"
          @click="deleteSelected"
        >
          <template #icon>
            <DeleteOutlined />
          </template>
          {{
            $t("request.table.selectedDeleteCN", { n: selectedRowKeys.length })
          }}
        </a-button>
      </div>
      <div class="toolbar-row">
        <a-input-search
          v-model:value="searchText"
          :placeholder="$t('request.filter.searchPrompt')"
          size="small"
          allow-clear
          style="width: 100%"
        />
      </div>
    </div>

    <a-table
      :columns="columns"
      :data-source="records"
      :loading="loading"
      :row-selection="{
        selectedRowKeys: selectedRowKeys,
        onChange: onSelectChange,
        columnWidth: 40,
      }"
      :pagination="{
        current: page,
        pageSize: pageSize,
        total: total,
        showSizeChanger: true,
        showQuickJumper: true,
        showTotal: (total) => $t('request.table.total', { n: total }),
        pageSizeOptions: ['20', '50', '100', '200'],
      }"
      row-key="id"
      size="small"
      :scroll="{ x: 1000 }"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'prompt'">
          <div
            class="multiline-text clickable"
            @click="previewPrompt(record)"
            :title="$t('request.preview.clickViewCN')"
          >
            {{ truncateText(record.prompt, 120) }}
          </div>
        </template>

        <template v-else-if="column.key === 'response'">
          <div
            v-if="record.status === 'failed'"
            class="multiline-text error-text clickable"
            @click="previewResponse(record)"
            :title="$t('request.preview.clickViewCN')"
          >
            {{
              truncateText(record.error_message, 120) ||
              $t("request.detail.errorMsg")
            }}
          </div>
          <div
            v-else
            class="multiline-text response-text clickable"
            @click="previewResponse(record)"
            :title="$t('request.preview.clickViewCN')"
          >
            {{ truncateText(record.response_text, 120) || "-" }}
          </div>
        </template>

        <template v-else-if="column.key === 'media'">
          <div
            v-if="hasMedia(record)"
            class="media-thumb-cell"
            @click="previewMedia(record)"
            :title="$t('request.preview.clickViewImageCN')"
          >
            <template v-if="getFirstMedia(record).status === 'downloaded'">
              <img
                v-if="getFirstMedia(record).type === 'image'"
                :src="getCachedMediaUrl(getFirstMedia(record))"
                class="thumb-img"
                loading="lazy"
              />
              <div
                v-else-if="getFirstMedia(record).type === 'video'"
                class="thumb-video"
              >
                <PlayCircleOutlined />
              </div>
            </template>
            <div v-else class="thumb-placeholder">
              <PictureOutlined v-if="getFirstMedia(record).type === 'image'" />
              <PlayCircleOutlined v-else />
            </div>
            <span v-if="record.responseMedia.length > 1" class="media-count">
              +{{ record.responseMedia.length - 1 }}
            </span>
          </div>
          <span v-else class="no-media">-</span>
        </template>

        <template v-else-if="column.key === 'status'">
          <a-tag
            :color="statusConfig[record.status]?.color || '#8c8c8c'"
            size="small"
          >
            {{ statusConfig[record.status]?.text || record.status }}
          </a-tag>
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space :size="0">
            <a-tooltip :title="$t('request.actions.resend')">
              <a-button
                type="link"
                size="small"
                @click="resendFromRecord(record)"
              >
                <template #icon>
                  <RedoOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="$t('request.actions.detail')">
              <a-button type="link" size="small" @click="viewDetail(record)">
                <template #icon>
                  <EyeOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="$t('request.actions.delete')">
              <a-button
                type="link"
                size="small"
                danger
                @click="deleteRecords([record.id])"
              >
                <template #icon>
                  <DeleteOutlined />
                </template>
              </a-button>
            </a-tooltip>
          </a-space>
        </template>
      </template>
    </a-table>
  </a-card>

  <a-drawer
    v-model:open="drawerVisible"
    :title="$t('request.detail.title')"
    placement="right"
    :width="isMobile ? '100%' : 700"
    :destroy-on-close="true"
  >
    <a-spin :spinning="detailLoading">
      <template v-if="currentRecord">
        <a-descriptions :column="isMobile ? 1 : 2" size="small" bordered>
          <a-descriptions-item
            :label="$t('request.detail.requestId')"
            :span="2"
          >
            <code>{{ currentRecord.id }}</code>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('request.detail.time')">
            {{ new Date(currentRecord.created_at).toLocaleString() }}
          </a-descriptions-item>
          <a-descriptions-item :label="$t('request.detail.status')">
            <a-tag :color="statusConfig[currentRecord.status]?.color">
              {{
                statusConfig[currentRecord.status]?.text || currentRecord.status
              }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('request.detail.model')" :span="2">
            {{ currentRecord.model_name || currentRecord.model_id || "-" }}
          </a-descriptions-item>
          <a-descriptions-item :label="$t('request.detail.duration')">
            {{ formatDuration(currentRecord.duration_ms) }}
          </a-descriptions-item>
          <a-descriptions-item :label="$t('request.detail.stream')">
            {{
              currentRecord.isStreaming
                ? $t("request.detail.yes")
                : $t("request.detail.no")
            }}
          </a-descriptions-item>
        </a-descriptions>

        <a-divider orientation="left">Prompt</a-divider>
        <div class="content-box">
          {{ currentRecord.prompt || $t("request.detail.none") }}
        </div>

        <template
          v-if="
            currentRecord.inputImages && currentRecord.inputImages.length > 0
          "
        >
          <a-divider orientation="left">{{
            $t("request.detail.inputImages")
          }}</a-divider>
          <div class="media-list">
            <span
              v-for="(img, idx) in currentRecord.inputImages"
              :key="idx"
              class="media-item"
            >
              <a-tag>{{ img.split("/").pop() }}</a-tag>
            </span>
          </div>
        </template>

        <a-divider orientation="left">{{
          $t("request.detail.response")
        }}</a-divider>
        <div
          class="content-box"
          :class="{ 'error-box': currentRecord.status === 'failed' }"
        >
          <template v-if="currentRecord.status === 'failed'">
            {{
              currentRecord.error_message || $t("request.detail.unknownError")
            }}
          </template>
          <template v-else>
            {{ currentRecord.response_text || $t("request.detail.noResponse") }}
          </template>
        </div>

        <template v-if="currentRecord.reasoning_content">
          <a-divider orientation="left">{{
            $t("request.detail.reasoning")
          }}</a-divider>
          <div class="content-box reasoning-box">
            {{ currentRecord.reasoning_content }}
          </div>
        </template>

        <template
          v-if="
            currentRecord.responseMedia &&
            currentRecord.responseMedia.length > 0
          "
        >
          <a-divider orientation="left">{{
            $t("request.detail.mediaContent", {
              n: currentRecord.responseMedia.length,
            })
          }}</a-divider>
          <div class="media-gallery-large">
            <div
              v-for="(media, idx) in currentRecord.responseMedia"
              :key="idx"
              class="media-card-large"
            >
              <div class="media-preview-large">
                <template
                  v-if="
                    media.status === 'downloaded' && getCachedMediaUrl(media)
                  "
                >
                  <img
                    v-if="media.type === 'image'"
                    :src="getCachedMediaUrl(media)"
                    :alt="$t('media.image')"
                  />
                  <video
                    v-else-if="media.type === 'video'"
                    :src="getCachedMediaUrl(media)"
                    controls
                  />
                </template>
                <template v-else>
                  <div class="media-placeholder-large">
                    <PictureOutlined v-if="media.type === 'image'" />
                    <PlayCircleOutlined v-else-if="media.type === 'video'" />
                    <FileTextOutlined v-else />
                    <div class="media-status">
                      <a-tag v-if="media.status === 'failed'" color="red">{{
                        $t("request.detail.downloadFailed")
                      }}</a-tag>
                      <a-tag
                        v-else-if="media.status === 'external'"
                        color="blue"
                        >{{ $t("request.detail.externalLink") }}</a-tag
                      >
                      <a-tag
                        v-else-if="media.status === 'pending'"
                        color="orange"
                        >{{ $t("request.detail.pendingDownload") }}</a-tag
                      >
                    </div>
                    <a-button
                      v-if="media.status === 'failed'"
                      type="primary"
                      size="small"
                      @click="retryMedia(currentRecord.id, idx)"
                    >
                      <template #icon>
                        <ReloadOutlined />
                      </template>
                      {{ $t("request.detail.retryDownload") }}
                    </a-button>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </template>
      </template>
    </a-spin>
  </a-drawer>

  <a-modal
    v-model:open="previewModalVisible"
    :footer="null"
    :width="
      isMobile
        ? '95%'
        : previewMediaType === 'image' || previewMediaType === 'video'
          ? '90%'
          : '70%'
    "
    centered
    @cancel="closePreview"
  >
    <template #title>
      <div style="display: flex; align-items: center; gap: 8px">
        <span>{{ previewTitle }}</span>
        <a-button
          v-if="previewMediaType === 'text'"
          type="text"
          size="small"
          @click="copyPreviewContent"
        >
          <template #icon><CopyOutlined /></template>
          {{ $t("request.preview.copyText") }}
        </a-button>
      </div>
    </template>
    <div v-if="previewMediaType === 'text'" class="preview-text-content">
      {{ previewContent }}
    </div>
    <div v-else-if="previewMediaType === 'image'" class="preview-image-content">
      <img :src="previewMediaUrl" :alt="$t('media.image')" />
    </div>
    <div v-else-if="previewMediaType === 'video'" class="preview-video-content">
      <video :src="previewMediaUrl" controls autoplay />
    </div>
  </a-modal>
</template>

<style scoped>
.send-upload-area :deep(.ant-upload-drag) {
  height: calc(100% - 20px);
}

.stats-content {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.stats-numbers {
  display: flex;
  align-items: center;
  gap: 20px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: #fafafa;
  border-radius: 6px;
  transition: all 0.2s;
}

.stat-item:hover {
  background: #f0f0f0;
}

.stat-item.success {
  color: #52c41a;
}

.stat-item.error {
  color: #ff4d4f;
}

.stat-item.neutral {
  color: #8c8c8c;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  font-family: "SF Mono", "Monaco", monospace;
}

.stat-label {
  font-size: 12px;
  color: #8c8c8c;
}

.toolbar {
  margin-bottom: 16px;
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.toolbar-row:last-child {
  margin-bottom: 0;
}

.toolbar-status-select {
  width: 100px;
}

.toolbar-model-select {
  width: 200px;
}

@media (min-width: 768px) {
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .toolbar-row {
    margin-bottom: 0;
  }

  .toolbar-row:last-child {
    flex: 1;
    max-width: 300px;
  }
}

.error-text {
  color: #ff4d4f;
  font-size: 12px;
}

.response-text {
  font-size: 12px;
  color: #595959;
}

.multiline-text {
  font-size: 12px;
  line-height: 1.5;
  max-height: 54px;
  overflow: hidden;
  word-break: break-all;
}

.multiline-text.clickable {
  cursor: pointer;
  padding: 4px;
  margin: -4px;
  border-radius: 4px;
  transition: background 0.2s;
}

.multiline-text.clickable:hover {
  background: #f0f0f0;
}

.no-media {
  color: #bfbfbf;
}

:deep(.ant-table-tbody > tr > td) {
  vertical-align: middle;
}

.media-thumb-cell {
  position: relative;
  width: 160px;
  height: 160px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 8px auto;
}

.thumb-img {
  width: 160px;
  height: 160px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #f0f0f0;
}

.thumb-video {
  width: 160px;
  height: 160px;
  background: #000;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 28px;
}

.thumb-placeholder {
  width: 160px;
  height: 160px;
  background: #fafafa;
  border: 1px dashed #d9d9d9;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #bfbfbf;
  font-size: 24px;
}

.media-count {
  position: absolute;
  bottom: 4px;
  right: 4px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
}

.content-box {
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 4px;
  padding: 12px;
  font-family: "Consolas", "Monaco", monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 600px;
  overflow-y: auto;
}

.content-box.error-box {
  color: #ff4d4f;
  background: #fff2f0;
  border-color: #ffccc7;
}

.content-box.reasoning-box {
  background: #f6ffed;
  border-color: #b7eb8f;
  color: #389e0d;
}

.media-gallery-large {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.media-card-large {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  overflow: hidden;
  background: #fafafa;
}

.media-preview-large {
  width: 100%;
  min-height: 300px;
  max-height: 500px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
}

.media-preview-large img {
  max-width: 100%;
  max-height: 500px;
  object-fit: contain;
}

.media-preview-large video {
  max-width: 100%;
  max-height: 500px;
}

.media-placeholder-large {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #bfbfbf;
  gap: 12px;
  padding: 40px;
  font-size: 48px;
}

.media-status {
  font-size: 14px;
}

.media-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preview-text-content {
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 4px;
  padding: 16px;
  font-family: "Consolas", "Monaco", monospace;
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 60vh;
  overflow-y: auto;
  line-height: 1.6;
}

.preview-image-content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
}

.preview-image-content img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  border-radius: 4px;
}

.preview-video-content {
  display: flex;
  justify-content: center;
  align-items: center;
}

.preview-video-content video {
  max-width: 100%;
  max-height: 70vh;
  border-radius: 4px;
}

.send-upload-area {
  flex: 0 0 280px;
  min-width: 200px;
}

.stats-date-picker {
  width: 240px;
}

@media (max-width: 768px) {
  .send-upload-area {
    flex: 1 1 100% !important;
    min-width: 0 !important;
  }

  .stats-date-picker {
    width: 100%;
  }

  .media-thumb-cell {
    width: 80px;
    height: 80px;
  }

  .thumb-img {
    width: 80px;
    height: 80px;
  }

  .thumb-video {
    width: 80px;
    height: 80px;
    font-size: 20px;
  }

  .thumb-placeholder {
    width: 80px;
    height: 80px;
    font-size: 18px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .toolbar-row {
    flex-wrap: nowrap;
    margin-bottom: 0;
    gap: 4px;
  }

  .toolbar-row:last-child {
    flex: 1;
    min-width: 100px;
  }

  .toolbar-status-select {
    width: 80px !important;
  }

  .toolbar-model-select {
    width: 100px !important;
  }

  .stat-value {
    font-size: 14px;
  }

  .stat-item {
    padding: 2px 8px;
  }

  .content-box {
    max-height: 400px;
    font-size: 12px;
    padding: 8px;
  }

  .media-preview-large {
    min-height: 200px;
    max-height: 350px;
  }
}

@media (max-width: 576px) {
  .stats-content {
    flex-direction: column;
    align-items: flex-start;
  }

  .stats-content .ant-divider {
    display: none;
  }

  .stats-numbers {
    margin-top: 8px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .stat-item {
    padding: 2px 6px;
    gap: 4px;
  }

  .stat-value {
    font-size: 13px;
  }

  .stat-label {
    font-size: 11px;
  }
}
</style>
