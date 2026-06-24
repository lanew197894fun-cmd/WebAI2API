<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
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

const settingsStore = useSettingsStore();

// 資料狀態
const loading = ref(false);
const records = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);

// 篩選狀態
const dateRange = ref([]);
const statusFilter = ref("all");
const modelFilter = ref("");
const searchText = ref("");
const modelOptions = ref([]);

// 多選狀態
const selectedRowKeys = ref([]);
const selectedRows = ref([]);

// 統計摘要
const stats = ref({ total: 0, success: 0, failed: 0, avgDuration: 0 });

// 詳情抽屜
const drawerVisible = ref(false);
const currentRecord = ref(null);
const detailLoading = ref(false);

// 快速預覽彈窗
const previewModalVisible = ref(false);
const previewContent = ref("");
const previewMediaType = ref("text"); // text, image, video
const previewMediaUrl = ref("");
const previewTitle = ref("快速預覽");

// 媒體資料快取 (blob URLs)
const mediaCache = ref({});

// 發送請求相關
const sendModelList = ref([]);
const sendModel = ref("");
const sendPrompt = ref("");
const sendImageList = ref([]);
const sendStreamMode = ref(false);
const sendReasoningMode = ref(true);
const sending = ref(false);

// 當前模型是否支援圖片輸入
const currentModelSupportsImage = computed(() => {
  if (!sendModel.value) return false;
  const model = sendModelList.value.find((m) => m.id === sendModel.value);
  if (!model) return false;
  return model.image_policy !== "forbidden";
});

// 自動重新整理
let autoRefreshInterval = null;

// 行動端偵測
const isMobile = ref(window.innerWidth <= 768);
let resizeHandler = null;

// 狀態配置
const statusConfig = {
  success: { color: "#52c41a", text: "成功", icon: CheckCircleOutlined },
  failed: { color: "#ff4d4f", text: "失敗", icon: CloseCircleOutlined },
  pending: { color: "#faad14", text: "處理中", icon: ClockCircleOutlined },
};

// 取得歷史列表
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
      // 預載入縮圖
      preloadThumbnails();
    }
  } catch (e) {
    message.error("取得歷史記錄失敗");
  } finally {
    loading.value = false;
  }
};

// 預載入列表中的縮圖
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

// 取得統計摘要
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

// 取得模型列表
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

// 查看詳情
const viewDetail = async (record) => {
  drawerVisible.value = true;
  detailLoading.value = true;
  try {
    const res = await fetch(`/admin/history/${record.id}`, {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      currentRecord.value = await res.json();
      // 預載入詳情中的媒體
      if (currentRecord.value.responseMedia) {
        for (const media of currentRecord.value.responseMedia) {
          if (media.localPath && media.status === "downloaded") {
            await getMediaBlobUrl(media);
          }
        }
      }
    }
  } catch (e) {
    message.error("取得詳情失敗");
  } finally {
    detailLoading.value = false;
  }
};

// 取得媒體 Blob URL（帶認證）
const getMediaBlobUrl = async (media) => {
  if (!media.localPath) return null;

  const filename = media.localPath.split("/").pop();
  const cacheKey = filename;

  // 檢查快取
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

// 取得快取的 blob URL
const getCachedMediaUrl = (media) => {
  if (!media || !media.localPath) return null;
  const filename = media.localPath.split("/").pop();
  return mediaCache.value[filename] || null;
};

// 重試下載媒體
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
      message.success("下載成功");
      fetchHistory();
      if (currentRecord.value && currentRecord.value.id === recordId) {
        viewDetail(currentRecord.value);
      }
    } else {
      const data = await res.json();
      message.error(data.message || "下載失敗");
    }
  } catch (e) {
    message.error("請求失敗");
  }
};

// 刪除記錄
const deleteRecords = (ids) => {
  Modal.confirm({
    title: "確認刪除",
    content: `確定要刪除這 ${ids.length} 條記錄嗎？關聯的媒體檔案也會被刪除。`,
    okText: "刪除",
    okType: "danger",
    cancelText: "取消",
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
          message.success("刪除成功");
          clearSelection();
          fetchHistory();
          fetchStats();
        } else {
          message.error("刪除失敗");
        }
      } catch (e) {
        message.error("請求失敗");
      }
    },
  });
};

// 按日期範圍刪除
const deleteByDateRange = () => {
  if (!dateRange.value || dateRange.value.length !== 2) {
    message.warning("請先選擇日期範圍");
    return;
  }

  Modal.confirm({
    title: "確認刪除",
    content: `確定要刪除 ${dateRange.value[0].format("YYYY-MM-DD")} 至 ${dateRange.value[1].format("YYYY-MM-DD")} 的所有記錄嗎？`,
    okText: "刪除",
    okType: "danger",
    cancelText: "取消",
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
          message.success(`已刪除 ${data.deleted} 條記錄`);
          clearSelection();
          fetchHistory();
          fetchStats();
        } else {
          message.error("刪除失敗");
        }
      } catch (e) {
        message.error("請求失敗");
      }
    },
  });
};

// 格式化時間
const formatTime = (timestamp) => {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// 格式化耗時
const formatDuration = (ms) => {
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

// 截斷文字
const truncateText = (text, maxLen = 120) => {
  if (!text) return "-";
  return text.length > maxLen ? text.substring(0, maxLen) + "..." : text;
};

// 判斷回應是否有媒體內容
const hasMedia = (record) => {
  return record.responseMedia && record.responseMedia.length > 0;
};

// 取得第一個媒體
const getFirstMedia = (record) => {
  if (!hasMedia(record)) return null;
  return record.responseMedia[0];
};

// 表格列定義
const columns = [
  {
    title: "狀態",
    dataIndex: "status",
    key: "status",
    width: 70,
    align: "center",
  },
  {
    title: "Prompt",
    dataIndex: "prompt",
    key: "prompt",
    width: 200,
  },
  {
    title: "模型",
    dataIndex: "model_name",
    key: "model_name",
    width: 150,
    ellipsis: true,
  },
  {
    title: "回應",
    key: "response",
    width: 220,
  },
  {
    title: "媒體",
    key: "media",
    width: 180,
    align: "center",
  },
  {
    title: "時間",
    dataIndex: "created_at",
    key: "created_at",
    width: 100,
    customRender: ({ value }) => formatTime(value),
  },
  {
    title: "耗時",
    dataIndex: "duration_ms",
    key: "duration_ms",
    width: 60,
    align: "right",
    customRender: ({ value }) => formatDuration(value),
  },
  {
    title: "",
    key: "action",
    width: 100,
    align: "center",
    fixed: "right",
  },
];

// 監聽篩選變化
watch([statusFilter, modelFilter, dateRange], () => {
  page.value = 1;
  fetchHistory();
  fetchStats();
});

// 切換模型時清空已選圖片
watch(sendModel, () => {
  sendImageList.value = [];
});

// 搜尋防抖
let searchTimeout = null;
watch(searchText, () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    page.value = 1;
    fetchHistory();
  }, 300);
});

// 分頁變化
const handleTableChange = (pagination) => {
  page.value = pagination.current;
  pageSize.value = pagination.pageSize;
  clearSelection();
  fetchHistory();
};

// 刷新
const handleRefresh = () => {
  fetchHistory();
  fetchModels();
};

// 快速預覽回應內容
const previewResponse = async (record) => {
  previewModalVisible.value = true;
  previewMediaType.value = "text";
  previewTitle.value = "回應預覽";
  if (record.status === "failed") {
    previewContent.value = record.error_message || "未知錯誤";
  } else {
    previewContent.value = record.response_text || "無回應";
  }
};

// 快速預覽 Prompt 內容
const previewPrompt = (record) => {
  previewModalVisible.value = true;
  previewMediaType.value = "text";
  previewTitle.value = "Prompt 預覽";
  previewContent.value = record.prompt || "無內容";
};

// 複製預覽內容到剪貼板
const copyPreviewContent = async () => {
  try {
    await navigator.clipboard.writeText(previewContent.value);
    message.success("已複製到剪貼板");
  } catch (e) {
    message.error("複製失敗");
  }
};

// 快速預覽媒體
const previewMedia = async (record) => {
  const media = getFirstMedia(record);
  if (!media) return;

  if (media.type === "image") {
    previewMediaType.value = "image";
  } else if (media.type === "video") {
    previewMediaType.value = "video";
  } else {
    previewMediaType.value = "text";
    previewContent.value = media.originalUrl || "無預覽";
    previewModalVisible.value = true;
    return;
  }

  if (media.status === "downloaded") {
    const url = await getMediaBlobUrl(media);
    if (url) {
      previewMediaUrl.value = url;
      previewModalVisible.value = true;
    } else {
      message.error("預覽載入失敗");
    }
  } else {
    previewContent.value = "媒體未下載或下載失敗，請查看詳情並重試下載";
    previewMediaType.value = "text";
    previewModalVisible.value = true;
  }
};

// 關閉預覽彈窗
const closePreview = () => {
  previewModalVisible.value = false;
  previewContent.value = "";
  previewMediaUrl.value = "";
  previewMediaType.value = "text";
  previewTitle.value = "快速預覽";
};

// 多選變化
const onSelectChange = (keys, rows) => {
  selectedRowKeys.value = keys;
  selectedRows.value = rows;
};

// 批量刪除選中
const deleteSelected = () => {
  if (selectedRowKeys.value.length === 0) {
    message.warning("請先選擇要刪除的記錄");
    return;
  }
  deleteRecords(selectedRowKeys.value);
};

// 清空選擇
const clearSelection = () => {
  selectedRowKeys.value = [];
  selectedRows.value = [];
};

// === 發送請求功能 ===

// 取得可用模型列表
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
    message.error("僅支援 PNG, JPEG, GIF, WebP 格式");
    return false;
  }
  if (sendImageList.value.length >= 10) {
    message.error("最多上傳 10 張圖片");
    return false;
  }
  return false;
};

// 處理圖片選擇
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
    message.error("圖片讀取失敗");
  }
};

// 發送請求（fire-and-forget，不阻塞 UI）
const sendRequest = () => {
  if (!sendModel.value) {
    message.warning("請選擇模型");
    return;
  }
  if (!sendPrompt.value.trim()) {
    message.warning("請輸入提示詞");
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

  // 發射後不等待
  fetch("/v1/chat/completions", {
    method: "POST",
    headers: {
      ...settingsStore.getHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).catch(() => {
    /* 網路錯誤靜默處理，列表會顯示失敗狀態 */
  });

  message.success("請求已發送");

  // 清空輸入，允許立即發下一個
  sendPrompt.value = "";
  sendImageList.value = [];

  // 啟動自動重新整理 + 1秒後立即刷一次以快速顯示新記錄
  startAutoRefresh();
  setTimeout(() => {
    silentFetchHistory();
    silentFetchStats();
  }, 1000);
};

// 靜默刪除記錄（不彈確認框）
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
  } catch (e) {
    /* 靜默失敗 */
  }
};

// 從歷史記錄重發
const resendFromRecord = (record) => {
  const modelId = record.model_id || record.model_name;
  if (modelId) {
    sendModel.value = modelId;
  }
  if (record.prompt) {
    sendPrompt.value = record.prompt;
  }
  sendImageList.value = [];

  // 如果原記錄是失敗狀態（沒有生成回覆或圖片），重發後刪除舊記錄
  const shouldDelete = record.status === "failed";

  sendRequest();

  if (shouldDelete) {
    silentDeleteRecord(record.id);
  }
};

// === 自動重新整理 ===
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
  } catch (e) {
    /* 靜默失敗 */
  }
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
  } catch (e) {
    /* 靜默失敗 */
  }
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
    <!-- 發送請求 -->
    <a-card title="發送請求" :bordered="false" style="margin-bottom: 24px">
        <div style="display: flex; gap: 16px; flex-wrap: wrap;">
            <!-- 左側：模型 + 提示詞 -->
            <div style="flex: 1; min-width: 280px;">
                <!-- 模型選擇 -->
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px;">模型</div>
                    <a-select v-model:value="sendModel" style="width: 100%" size="small" placeholder="選擇模型" show-search>
                        <a-select-option v-for="model in sendModelList" :key="model.id" :value="model.id">
                            {{ model.id }}
                        </a-select-option>
                    </a-select>
                </div>

                <!-- 提示詞 -->
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px;">提示詞</div>
                    <a-textarea v-model:value="sendPrompt" placeholder="輸入提示詞" :rows="3" size="small" />
                </div>

                <!-- 選項 + 發送按鈕 -->
                <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                    <a-checkbox v-model:checked="sendStreamMode">流式回應</a-checkbox>
                    <a-checkbox v-model:checked="sendReasoningMode">返回思考</a-checkbox>
                    <a-button type="primary" @click="sendRequest" :disabled="!sendModel">
                        <template #icon><RocketOutlined /></template>
                        發送
                    </a-button>
                </div>
            </div>

            <!-- 右側：圖片上傳（僅支援圖片的模型顯示） -->
            <div v-if="currentModelSupportsImage" class="send-upload-area">
                <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px;">
                    附加圖片 ({{ sendImageList.length }}/10)
                </div>
                <a-upload-dragger :file-list="[]" :multiple="true" :before-upload="beforeUpload"
                    @change="handleSendImageChange" accept=".png,.jpg,.jpeg,.gif,.webp" :show-upload-list="false">
                    <p style="margin: 0;">
                        <InboxOutlined style="font-size: 20px; color: #1890ff;" />
                    </p>
                    <p style="font-size: 12px; margin: 2px 0 0 0; color: #8c8c8c;">
                        點擊或拖曳上傳圖片
                    </p>
                </a-upload-dragger>
                <div v-if="sendImageList.length > 0" style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px;">
                    <a-tag v-for="img in sendImageList" :key="img.uid" closable
                        @close="sendImageList = sendImageList.filter(i => i.uid !== img.uid)">
                        <PictureOutlined /> {{ img.name.slice(0, 15) }}{{ img.name.length > 15 ? '...' : '' }}
                    </a-tag>
                </div>
            </div>
        </div>
    </a-card>

    <!-- 統計摘要 -->
    <a-card title="請求記錄" :bordered="false">
        <template #extra>
            <a-button type="link" danger size="small" @click="deleteByDateRange"
                :disabled="!dateRange || dateRange.length !== 2">
                <template #icon>
                    <DeleteOutlined />
                </template>
                刪除所選範圍
            </a-button>
        </template>

        <div class="stats-content">
            <a-range-picker v-model:value="dateRange" :format="'YYYY-MM-DD'" :placeholder="['開始日期', '結束日期']"
                size="small" class="stats-date-picker" />

            <a-divider type="vertical" style="height: 32px; margin: 0 16px" />

            <div class="stats-numbers">
                <div class="stat-item neutral">
                    <FileTextOutlined />
                    <span class="stat-value">{{ stats.total }}</span>
                    <span class="stat-label">總數</span>
                </div>
                <div class="stat-item success">
                    <CheckCircleOutlined />
                    <span class="stat-value">{{ stats.success }}</span>
                    <span class="stat-label">成功</span>
                </div>
                <div class="stat-item error">
                    <CloseCircleOutlined />
                    <span class="stat-value">{{ stats.failed }}</span>
                    <span class="stat-label">失敗</span>
                </div>
                <div class="stat-item neutral">
                    <ClockCircleOutlined />
                    <span class="stat-value">{{ formatDuration(stats.avgDuration) }}</span>
                    <span class="stat-label">平均耗時</span>
                </div>
            </div>
        </div>
    </a-card>

    <!-- 歷史記錄表格 -->
    <a-card :bordered="false" style="margin-top: 24px">
        <!-- 篩選工具列 -->
        <div class="toolbar">
            <div class="toolbar-row">
                <a-select v-model:value="statusFilter" class="toolbar-status-select" size="small" placeholder="狀態">
                    <a-select-option value="all">全部狀態</a-select-option>
                    <a-select-option value="success">成功</a-select-option>
                    <a-select-option value="failed">失敗</a-select-option>
                    <a-select-option value="pending">處理中</a-select-option>
                </a-select>
                <a-select v-model:value="modelFilter" class="toolbar-model-select" size="small" placeholder="全部模型"
                    allow-clear show-search>
                    <a-select-option v-for="model in modelOptions" :key="model" :value="model">
                        {{ model }}
                    </a-select-option>
                </a-select>
                <a-button size="small" @click="handleRefresh">
                    <template #icon>
                        <ReloadOutlined />
                    </template>
                </a-button>
                <a-button v-if="selectedRowKeys.length > 0" type="primary" danger size="small" @click="deleteSelected">
                    <template #icon>
                        <DeleteOutlined />
                    </template>
                    刪除選中 ({{ selectedRowKeys.length }})
                </a-button>
            </div>
            <div class="toolbar-row">
                <a-input-search v-model:value="searchText" placeholder="搜尋 Prompt 或回應內容" size="small"
                    allow-clear style="width: 100%;" />
            </div>
        </div>

        <!-- 表格 -->
        <a-table
            :columns="columns"
            :data-source="records"
            :loading="loading"
            :row-selection="{
                selectedRowKeys: selectedRowKeys,
                onChange: onSelectChange,
                columnWidth: 40
            }"
            :pagination="{
                current: page,
                pageSize: pageSize,
                total: total,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `共 ${total} 條`,
                pageSizeOptions: ['20', '50', '100', '200']
            }"
            row-key="id"
            size="small"
            :scroll="{ x: 1000 }"
            @change="handleTableChange"
        >
            <template #bodyCell="{ column, record }">
                <!-- Prompt 列：支援多行，點擊彈出預覽 -->
                <template v-if="column.key === 'prompt'">
                    <div class="multiline-text clickable" @click="previewPrompt(record)" title="點擊檢視完整內容">
                        {{ truncateText(record.prompt, 120) }}
                    </div>
                </template>

                <!-- 回應列 -->
                <template v-else-if="column.key === 'response'">
                    <div v-if="record.status === 'failed'" class="multiline-text error-text clickable"
                        @click="previewResponse(record)" title="點擊檢視完整內容">
                        {{ truncateText(record.error_message, 120) || '錯誤' }}
                    </div>
                    <div v-else class="multiline-text response-text clickable"
                        @click="previewResponse(record)" title="點擊檢視完整內容">
                        {{ truncateText(record.response_text, 120) || '-' }}
                    </div>
                </template>

                <!-- 媒體列：顯示縮圖 -->
                <template v-else-if="column.key === 'media'">
                    <div v-if="hasMedia(record)" class="media-thumb-cell" @click="previewMedia(record)" title="點擊檢視大圖">
                        <template v-if="getFirstMedia(record).status === 'downloaded'">
                            <img
                                v-if="getFirstMedia(record).type === 'image'"
                                :src="getCachedMediaUrl(getFirstMedia(record))"
                                class="thumb-img"
                                loading="lazy"
                            />
                            <div v-else-if="getFirstMedia(record).type === 'video'" class="thumb-video">
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

                <!-- 狀態列 -->
                <template v-else-if="column.key === 'status'">
                    <a-tag :color="statusConfig[record.status]?.color || '#8c8c8c'" size="small">
                        {{ statusConfig[record.status]?.text || record.status }}
                    </a-tag>
                </template>

                <!-- 操作列 -->
                <template v-else-if="column.key === 'action'">
                    <a-space :size="0">
                        <a-tooltip title="重發">
                            <a-button type="link" size="small" @click="resendFromRecord(record)">
                                <template #icon>
                                    <RedoOutlined />
                                </template>
                            </a-button>
                        </a-tooltip>
                        <a-tooltip title="詳情">
                            <a-button type="link" size="small" @click="viewDetail(record)">
                                <template #icon>
                                    <EyeOutlined />
                                </template>
                            </a-button>
                        </a-tooltip>
                        <a-tooltip title="刪除">
                            <a-button type="link" size="small" danger @click="deleteRecords([record.id])">
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

    <!-- 詳情抽屜 -->
    <a-drawer v-model:open="drawerVisible" title="請求詳情" placement="right" :width="isMobile ? '100%' : 700" :destroy-on-close="true">
        <a-spin :spinning="detailLoading">
            <template v-if="currentRecord">
                <!-- 基本資訊 -->
                <a-descriptions :column="isMobile ? 1 : 2" size="small" bordered>
                    <a-descriptions-item label="請求 ID" :span="2">
                        <code>{{ currentRecord.id }}</code>
                    </a-descriptions-item>
                    <a-descriptions-item label="時間">
                        {{ new Date(currentRecord.created_at).toLocaleString('zh-TW') }}
                    </a-descriptions-item>
                    <a-descriptions-item label="狀態">
                        <a-tag :color="statusConfig[currentRecord.status]?.color">
                            {{ statusConfig[currentRecord.status]?.text || currentRecord.status }}
                        </a-tag>
                    </a-descriptions-item>
                    <a-descriptions-item label="模型" :span="2">
                        {{ currentRecord.model_name || currentRecord.model_id || '-' }}
                    </a-descriptions-item>
                    <a-descriptions-item label="耗時">
                        {{ formatDuration(currentRecord.duration_ms) }}
                    </a-descriptions-item>
                    <a-descriptions-item label="流式">
                        {{ currentRecord.isStreaming ? '是' : '否' }}
                    </a-descriptions-item>
                </a-descriptions>

                <!-- Prompt -->
                <a-divider orientation="left">Prompt</a-divider>
                <div class="content-box">
                    {{ currentRecord.prompt || '無' }}
                </div>

                <!-- 輸入圖片 -->
                <template v-if="currentRecord.inputImages && currentRecord.inputImages.length > 0">
                    <a-divider orientation="left">輸入圖片</a-divider>
                    <div class="media-list">
                        <span v-for="(img, idx) in currentRecord.inputImages" :key="idx" class="media-item">
                            <a-tag>{{ img.split('/').pop() }}</a-tag>
                        </span>
                    </div>
                </template>

                <!-- 回應內容 -->
                <a-divider orientation="left">回應內容</a-divider>
                <div class="content-box" :class="{ 'error-box': currentRecord.status === 'failed' }">
                    <template v-if="currentRecord.status === 'failed'">
                        {{ currentRecord.error_message || '未知錯誤' }}
                    </template>
                    <template v-else>
                        {{ currentRecord.response_text || '無回應' }}
                    </template>
                </div>

                <!-- 思考過程 -->
                <template v-if="currentRecord.reasoning_content">
                    <a-divider orientation="left">思考過程</a-divider>
                    <div class="content-box reasoning-box">
                        {{ currentRecord.reasoning_content }}
                    </div>
                </template>

                <!-- 媒體內容 -->
                <template v-if="currentRecord.responseMedia && currentRecord.responseMedia.length > 0">
                    <a-divider orientation="left">媒體內容 ({{ currentRecord.responseMedia.length }})</a-divider>
                    <div class="media-gallery-large">
                        <div v-for="(media, idx) in currentRecord.responseMedia" :key="idx" class="media-card-large">
                            <div class="media-preview-large">
                                <template v-if="media.status === 'downloaded' && getCachedMediaUrl(media)">
                                    <img v-if="media.type === 'image'" :src="getCachedMediaUrl(media)" alt="生成圖片" />
                                    <video v-else-if="media.type === 'video'" :src="getCachedMediaUrl(media)" controls />
                                </template>
                                <template v-else>
                                    <div class="media-placeholder-large">
                                        <PictureOutlined v-if="media.type === 'image'" />
                                        <PlayCircleOutlined v-else-if="media.type === 'video'" />
                                        <FileTextOutlined v-else />
                                        <div class="media-status">
                                            <a-tag v-if="media.status === 'failed'" color="red">下載失敗</a-tag>
                                            <a-tag v-else-if="media.status === 'external'" color="blue">外部連結</a-tag>
                                            <a-tag v-else-if="media.status === 'pending'" color="orange">待下載</a-tag>
                                        </div>
                                        <a-button v-if="media.status === 'failed'" type="primary" size="small"
                                            @click="retryMedia(currentRecord.id, idx)">
                                            <template #icon>
                                                <ReloadOutlined />
                                            </template>
                                            重試下載
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

    <!-- 快速預覽彈窗 -->
    <a-modal
        v-model:open="previewModalVisible"
        :footer="null"
        :width="isMobile ? '95%' : (previewMediaType === 'image' || previewMediaType === 'video' ? '90%' : '70%')"
        centered
        @cancel="closePreview"
    >
        <template #title>
            <div style="display: flex; align-items: center; gap: 8px;">
                <span>{{ previewTitle }}</span>
                <a-button v-if="previewMediaType === 'text'" type="text" size="small" @click="copyPreviewContent">
                    <template #icon><CopyOutlined /></template>
                    複製全文
                </a-button>
            </div>
        </template>
        <div v-if="previewMediaType === 'text'" class="preview-text-content">
            {{ previewContent }}
        </div>
        <div v-else-if="previewMediaType === 'image'" class="preview-image-content">
            <img :src="previewMediaUrl" alt="預覽圖片" />
        </div>
        <div v-else-if="previewMediaType === 'video'" class="preview-video-content">
            <video :src="previewMediaUrl" controls autoplay />
        </div>
    </a-modal>
</template>
        刪除所选范围
      </a-button>
    </template>

    <div class="stats-content">
      <a-range-picker
        v-model:value="dateRange"
        :format="'YYYY-MM-DD'"
        :placeholder="['開始日期', '結束日期']"
        size="small"
        class="stats-date-picker"
      />

      <a-divider type="vertical" style="height: 32px; margin: 0 16px" />

      <div class="stats-numbers">
        <div class="stat-item neutral">
          <FileTextOutlined />
          <span class="stat-value">{{ stats.total }}</span>
          <span class="stat-label">总数</span>
        </div>
        <div class="stat-item success">
          <CheckCircleOutlined />
          <span class="stat-value">{{ stats.success }}</span>
          <span class="stat-label">成功</span>
        </div>
        <div class="stat-item error">
          <CloseCircleOutlined />
          <span class="stat-value">{{ stats.failed }}</span>
          <span class="stat-label">失敗</span>
        </div>
        <div class="stat-item neutral">
          <ClockCircleOutlined />
          <span class="stat-value">{{
            formatDuration(stats.avgDuration)
          }}</span>
          <span class="stat-label">平均耗時</span>
        </div>
      </div>
    </div>
  </a-card>

  <!-- 历史记录表格 -->
  <a-card :bordered="false" style="margin-top: 24px">
    <!-- 篩選工具欄 -->
    <div class="toolbar">
      <div class="toolbar-row">
        <a-select
          v-model:value="statusFilter"
          class="toolbar-status-select"
          size="small"
          placeholder="狀態"
        >
          <a-select-option value="all">全部狀態</a-select-option>
          <a-select-option value="success">成功</a-select-option>
          <a-select-option value="failed">失敗</a-select-option>
          <a-select-option value="pending">處理中</a-select-option>
        </a-select>
        <a-select
          v-model:value="modelFilter"
          class="toolbar-model-select"
          size="small"
          placeholder="全部模型"
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
          刪除選中 ({{ selectedRowKeys.length }})
        </a-button>
      </div>
      <div class="toolbar-row">
        <a-input-search
          v-model:value="searchText"
          placeholder="搜尋 Prompt 或回應內容"
          size="small"
          allow-clear
          style="width: 100%"
        />
      </div>
    </div>

    <!-- 表格 -->
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
        showTotal: (total) => `共 ${total} 條`,
        pageSizeOptions: ['20', '50', '100', '200'],
      }"
      row-key="id"
      size="small"
      :scroll="{ x: 1000 }"
      @change="handleTableChange"
    >
      <template #bodyCell="{ column, record }">
        <!-- Prompt 列：支援多行，點擊彈出預覽 -->
        <template v-if="column.key === 'prompt'">
          <div
            class="multiline-text clickable"
            @click="previewPrompt(record)"
            title="點擊檢視完整內容"
          >
            {{ truncateText(record.prompt, 120) }}
          </div>
        </template>

        <!-- 回應列 -->
        <template v-else-if="column.key === 'response'">
          <div
            v-if="record.status === 'failed'"
            class="multiline-text error-text clickable"
            @click="previewResponse(record)"
            title="點擊檢視完整內容"
          >
            {{ truncateText(record.error_message, 120) || "錯誤" }}
          </div>
          <div
            v-else
            class="multiline-text response-text clickable"
            @click="previewResponse(record)"
            title="點擊檢視完整內容"
          >
            {{ truncateText(record.response_text, 120) || "-" }}
          </div>
        </template>

        <!-- 媒體列：顯示縮圖 -->
        <template v-else-if="column.key === 'media'">
          <div
            v-if="hasMedia(record)"
            class="media-thumb-cell"
            @click="previewMedia(record)"
            title="點擊檢視大圖"
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

        <!-- 狀態列 -->
        <template v-else-if="column.key === 'status'">
          <a-tag
            :color="statusConfig[record.status]?.color || '#8c8c8c'"
            size="small"
          >
            {{ statusConfig[record.status]?.text || record.status }}
          </a-tag>
        </template>

        <!-- 操作列 -->
        <template v-else-if="column.key === 'action'">
          <a-space :size="0">
            <a-tooltip title="重發">
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
            <a-tooltip title="詳情">
              <a-button type="link" size="small" @click="viewDetail(record)">
                <template #icon>
                  <EyeOutlined />
                </template>
              </a-button>
            </a-tooltip>
            <a-tooltip title="刪除">
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

  <!-- 詳情抽屜 -->
  <a-drawer
    v-model:open="drawerVisible"
    title="請求詳情"
    placement="right"
    :width="isMobile ? '100%' : 700"
    :destroy-on-close="true"
  >
    <a-spin :spinning="detailLoading">
      <template v-if="currentRecord">
        <!-- 基本資訊 -->
        <a-descriptions :column="isMobile ? 1 : 2" size="small" bordered>
          <a-descriptions-item label="請求 ID" :span="2">
            <code>{{ currentRecord.id }}</code>
          </a-descriptions-item>
          <a-descriptions-item label="時間">
            {{ new Date(currentRecord.created_at).toLocaleString("zh-CN") }}
          </a-descriptions-item>
          <a-descriptions-item label="狀態">
            <a-tag :color="statusConfig[currentRecord.status]?.color">
              {{
                statusConfig[currentRecord.status]?.text || currentRecord.status
              }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="模型" :span="2">
            {{ currentRecord.model_name || currentRecord.model_id || "-" }}
          </a-descriptions-item>
          <a-descriptions-item label="耗時">
            {{ formatDuration(currentRecord.duration_ms) }}
          </a-descriptions-item>
          <a-descriptions-item label="流式">
            {{ currentRecord.isStreaming ? "是" : "否" }}
          </a-descriptions-item>
        </a-descriptions>

        <!-- Prompt -->
        <a-divider orientation="left">Prompt</a-divider>
        <div class="content-box">
          {{ currentRecord.prompt || "無" }}
        </div>

        <!-- 输入圖片 -->
        <template
          v-if="
            currentRecord.inputImages && currentRecord.inputImages.length > 0
          "
        >
          <a-divider orientation="left">輸入圖片</a-divider>
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

        <!-- 回應內容 -->
        <a-divider orientation="left">回應內容</a-divider>
        <div
          class="content-box"
          :class="{ 'error-box': currentRecord.status === 'failed' }"
        >
          <template v-if="currentRecord.status === 'failed'">
            {{ currentRecord.error_message || "未知錯誤" }}
          </template>
          <template v-else>
            {{ currentRecord.response_text || "無回應" }}
          </template>
        </div>

        <!-- 思考過程 -->
        <template v-if="currentRecord.reasoning_content">
          <a-divider orientation="left">思考過程</a-divider>
          <div class="content-box reasoning-box">
            {{ currentRecord.reasoning_content }}
          </div>
        </template>

        <!-- 媒體內容 -->
        <template
          v-if="
            currentRecord.responseMedia &&
            currentRecord.responseMedia.length > 0
          "
        >
          <a-divider orientation="left"
            >媒體內容 ({{ currentRecord.responseMedia.length }})</a-divider
          >
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
                    alt="生成圖片"
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
                      <a-tag v-if="media.status === 'failed'" color="red"
                        >下載失敗</a-tag
                      >
                      <a-tag
                        v-else-if="media.status === 'external'"
                        color="blue"
                        >外部連結</a-tag
                      >
                      <a-tag
                        v-else-if="media.status === 'pending'"
                        color="orange"
                        >待下載</a-tag
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
                      重試下載
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

  <!-- 快速預覽彈窗 -->
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
          複製全文
        </a-button>
      </div>
    </template>
    <div v-if="previewMediaType === 'text'" class="preview-text-content">
      {{ previewContent }}
    </div>
    <div v-else-if="previewMediaType === 'image'" class="preview-image-content">
      <img :src="previewMediaUrl" alt="預覽圖片" />
    </div>
    <div v-else-if="previewMediaType === 'video'" class="preview-video-content">
      <video :src="previewMediaUrl" controls autoplay />
    </div>
  </a-modal>
</template>

<style scoped>
/* 圖片上傳區域高度控制 */
.send-upload-area :deep(.ant-upload-drag) {
    height: calc(100% - 20px);
}

/* 統計內容樣式 */
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
    font-family: 'SF Mono', 'Monaco', monospace;
}

.stat-label {
    font-size: 12px;
    color: #8c8c8c;
}

/* 工具列樣式 */
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

/* 工具列 select 預設寬度 */
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

/* 表格內樣式 */
.error-text {
    color: #ff4d4f;
    font-size: 12px;
}

.response-text {
    font-size: 12px;
    color: #595959;
}

/* 多行文字 */
.multiline-text {
    font-size: 12px;
    line-height: 1.5;
    max-height: 54px;  /* 約 3 行 */
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

/* 表格行高度適配大縮圖 */
:deep(.ant-table-tbody > tr > td) {
    vertical-align: middle;
}

/* 列表縮圖 - 160x160 */
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

/* 內容框樣式 */
.content-box {
    background: #fafafa;
    border: 1px solid #f0f0f0;
    border-radius: 4px;
    padding: 12px;
    font-family: 'Consolas', 'Monaco', monospace;
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

/* 詳情頁媒體樣式 - 更大尺寸 */
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

/* 媒體列表 */
.media-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

/* 預覽彈窗內容 */
.preview-text-content {
    background: #fafafa;
    border: 1px solid #f0f0f0;
    border-radius: 4px;
    padding: 16px;
    font-family: 'Consolas', 'Monaco', monospace;
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

/* 圖片上傳區域尺寸 */
.send-upload-area {
    flex: 0 0 280px;
    min-width: 200px;
}

/* 日期選擇器 */
.stats-date-picker {
    width: 240px;
}

/* 回應式 - 平板及以下 */
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

/* 回應式 - 手機 */
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

/* 統計內容樣式 */
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

/* 工具列樣式 */
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

/* 工具列 select 預設寬度 */
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

/* 表格內樣式 */
.error-text {
  color: #ff4d4f;
  font-size: 12px;
}

.response-text {
  font-size: 12px;
  color: #595959;
}

/* 多行文字 */
.multiline-text {
  font-size: 12px;
  line-height: 1.5;
  max-height: 54px; /* 约 3 行 */
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

/* 表格行高度適配大縮圖 */
:deep(.ant-table-tbody > tr > td) {
  vertical-align: middle;
}

/* 列表縮圖 - 160x160 */
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

/* 內容框樣式 */
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

/* 詳情頁媒體樣式 - 更大尺寸 */
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

/* 媒體列表 */
.media-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* 預覽彈窗內容 */
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

/* 圖片上傳區域尺寸 */
.send-upload-area {
  flex: 0 0 280px;
  min-width: 200px;
}

/* 日期選擇器 */
.stats-date-picker {
  width: 240px;
}

/* 響應式 - 平板及以下 */
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

/* 響應式 - 手機 */
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
