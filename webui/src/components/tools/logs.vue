<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useSettingsStore } from "@/stores/settings";
import {
  ReloadOutlined,
  DeleteOutlined,
  SearchOutlined,
  DownloadOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  BugOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons-vue";
import { message, Modal } from "ant-design-vue";

const settingsStore = useSettingsStore();

const logs = ref([]);
const loading = ref(false);
const total = ref(0);
const autoRefresh = ref(false);
const refreshInterval = ref(null);
const searchText = ref("");
const levelFilter = ref("all");

// 統計查詢相關
const dateRange = ref([]);
const rangeStats = ref({ success: 0, failed: 0, days: 0 });
const statsLoading = ref(false);

// 日誌級別配置
const levelConfig = {
  INFO: { color: "#1890ff", icon: InfoCircleOutlined },
  WARN: { color: "#faad14", icon: WarningOutlined },
  ERRO: { color: "#ff4d4f", icon: CloseCircleOutlined },
  DBUG: { color: "#722ed1", icon: BugOutlined },
};

// 取得日誌
const fetchLogs = async () => {
  loading.value = true;
  try {
    const res = await fetch("/admin/logs?lines=500", {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      const data = await res.json();
      logs.value = parseLogs(data.logs || []);
      total.value = data.total || 0;
    }
  } catch (e) {
    message.error("取得日誌失敗");
  } finally {
    loading.value = false;
  }
};

// 解析日誌行
const parseLogs = (lines) => {
  return lines.map((line, index) => {
    // 格式: 2025-12-20 17:00:00.000 [INFO] [模組] 訊息
    const match = line.match(
      /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[(\w+)\] \[([^\]]+)\] (.*)$/,
    );
    if (match) {
      return {
        id: index,
        time: match[1],
        level: match[2],
        module: match[3],
        message: match[4],
        raw: line,
      };
    }
    return {
      id: index,
      raw: line,
      level: "INFO",
      time: "",
      module: "",
      message: line,
    };
  });
};

// 過濾後的日誌（最新的在最上面）
const filteredLogs = computed(() => {
  const filtered = logs.value.filter((log) => {
    // 級別過濾
    if (levelFilter.value !== "all" && log.level !== levelFilter.value) {
      return false;
    }
    // 搜尋過濾
    if (searchText.value) {
      const search = searchText.value.toLowerCase();
      return log.raw.toLowerCase().includes(search);
    }
    return true;
  });
  // 反轉陣列，最新的日誌顯示在最上面
  return filtered.reverse();
});

// 清除日誌
const clearLogs = () => {
    Modal.confirm({
        title: '確認清除日誌',
        content: '此操作將刪除所有系統日誌檔案，是否繼續？',
        okText: '確認清除',
        okType: 'danger',
        cancelText: '取消',
        async onOk() {
            try {
                const res = await fetch('/admin/logs', {
                    method: 'DELETE',
                    headers: settingsStore.getHeaders()
                });
                if (res.ok) {
                    message.success('日誌已清除');
                    logs.value = [];
                    total.value = 0;
                } else {
                    message.error('清除失敗');
                }
            } catch (e) {
                message.error('請求失敗');
            }
        }
    });
        if (res.ok) {
          message.success("日誌已清除");
          logs.value = [];
          total.value = 0;
        } else {
          message.error("清除失敗");
        }
      } catch (e) {
        message.error("請求失敗");
      }
    },
  });
};

// 匯出日誌
const exportLogs = () => {
  const content = logs.value.map((l) => l.raw).join("\n");
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `system-${new Date().toISOString().split("T")[0]}.log`;
  a.click();
  URL.revokeObjectURL(url);
};

// 切換自動重新整理
const toggleAutoRefresh = (newState) => {
  autoRefresh.value = newState;
  if (newState) {
    fetchLogs(); // 立即重新整理一次
    refreshInterval.value = setInterval(fetchLogs, 5000);
  } else {
    if (refreshInterval.value) {
      clearInterval(refreshInterval.value);
      refreshInterval.value = null;
    }
  }
};

// 查詢日期範圍統計
const fetchRangeStats = async () => {
  if (!dateRange.value || dateRange.value.length !== 2) {
    rangeStats.value = { success: 0, failed: 0, days: 0 };
    return;
  }

  statsLoading.value = true;
  try {
    const [start, end] = dateRange.value;
    const res = await fetch(
      `/admin/stats/range?start=${start.format("YYYY-MM-DD")}&end=${end.format("YYYY-MM-DD")}`,
      { headers: settingsStore.getHeaders() },
    );
    if (res.ok) {
      rangeStats.value = await res.json();
    }
  } catch (e) {
    message.error("取得統計失敗");
  } finally {
    statsLoading.value = false;
  }
};

// 刪除選定範圍的統計資料
const clearRangeStats = () => {
  if (!dateRange.value || dateRange.value.length !== 2) {
    message.warning("請先選擇日期範圍");
    return;
  }

  Modal.confirm({
    title: "確認刪除",
    content: `確定要刪除 ${dateRange.value[0].format("YYYY-MM-DD")} 至 ${dateRange.value[1].format("YYYY-MM-DD")} 的統計資料嗎？`,
    okText: "刪除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      try {
        const [start, end] = dateRange.value;
        const res = await fetch(
          `/admin/stats/range?start=${start.format("YYYY-MM-DD")}&end=${end.format("YYYY-MM-DD")}`,
          { method: "DELETE", headers: settingsStore.getHeaders() },
        );
        if (res.ok) {
          message.success("統計資料已刪除");
          rangeStats.value = { success: 0, failed: 0, days: 0 };
        }
      } catch (e) {
        message.error("刪除失敗");
      }
    },
  });
};

onMounted(() => {
  fetchLogs();
});

onUnmounted(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value);
  }
});
</script>

<template>
  <!-- 統計查詢面板 -->
  <a-card title="請求統計" :bordered="false">
    <template #extra>
      <a-button
        type="link"
        danger
        size="small"
        @click="clearRangeStats"
        :disabled="!dateRange || dateRange.length !== 2"
      >
        <template #icon>
          <DeleteOutlined />
        </template>
        刪除統計
      </a-button>
    </template>

    <div class="stats-content">
      <a-range-picker
        v-model:value="dateRange"
        :format="'YYYY-MM-DD'"
        :placeholder="['開始日期', '結束日期']"
        size="small"
        class="stats-date-picker"
        @change="fetchRangeStats"
      />

      <a-divider type="vertical" style="height: 32px; margin: 0 16px" />

      <a-spin :spinning="statsLoading" size="small">
        <div class="stats-numbers">
          <div class="stat-item success">
            <CheckCircleOutlined />
            <span class="stat-value">{{ rangeStats.success }}</span>
            <span class="stat-label">成功</span>
          </div>
          <div class="stat-item error">
            <CloseCircleOutlined />
            <span class="stat-value">{{ rangeStats.failed }}</span>
            <span class="stat-label">失敗</span>
          </div>
          <div class="stat-item neutral">
            <span class="stat-value">{{ rangeStats.days }}</span>
            <span class="stat-label">天</span>
          </div>
        </div>
      </a-spin>
    </div>
  </a-card>

  <!-- 系統日誌 -->
  <a-card title="系統日誌" :bordered="false" style="margin-top: 24px">
    <!-- 工具列 -->
    <div class="toolbar">
      <!-- 第一行：級別篩選和操作按鈕 -->
      <div class="toolbar-row">
        <a-select v-model:value="levelFilter" style="width: 90px" size="small">
          <a-select-option value="all">全部</a-select-option>
          <a-select-option value="INFO">INFO</a-select-option>
          <a-select-option value="WARN">WARN</a-select-option>
          <a-select-option value="ERRO">ERROR</a-select-option>
          <a-select-option value="DBUG">DEBUG</a-select-option>
        </a-select>
        <a-space :size="4">
          <a-tooltip
            :title="autoRefresh ? '關閉自動重新整理' : '開啟自動重新整理'"
          >
            <a-button
              size="small"
              :type="autoRefresh ? 'primary' : 'default'"
              @click="toggleAutoRefresh(!autoRefresh)"
            >
              <template #icon>
                <ReloadOutlined />
              </template>
            </a-button>
          </a-tooltip>
          <a-tooltip title="匯出日誌">
            <a-button size="small" @click="exportLogs">
              <template #icon>
                <DownloadOutlined />
              </template>
            </a-button>
          </a-tooltip>
          <a-tooltip title="清除日誌">
            <a-button size="small" danger @click="clearLogs">
              <template #icon>
                <DeleteOutlined />
              </template>
            </a-button>
          </a-tooltip>
        </a-space>
      </div>
      <!-- 第二行：搜尋框 -->
      <div class="toolbar-row">
        <a-input-search
          v-model:value="searchText"
          placeholder="搜尋日誌"
          size="small"
          enter-button
          allow-clear
          style="width: 100%"
        />
      </div>
    </div>

    <!-- 統計資訊 -->
    <div style="margin-bottom: 12px; color: #8c8c8c; font-size: 12px">
      共 {{ total }} 條日誌，目前顯示 {{ filteredLogs.length }} 條
      <span v-if="autoRefresh" style="color: #1890ff; margin-left: 8px">
        <ReloadOutlined :spin="true" /> 自動重新整理中
      </span>
    </div>

    <!-- 日誌列表 -->
    <div class="log-container">
      <div
        v-for="log in filteredLogs"
        :key="log.id"
        class="log-line"
        :class="'level-' + log.level.toLowerCase()"
      >
        <div class="log-meta">
          <a-tag
            :color="levelConfig[log.level]?.color || '#8c8c8c'"
            size="small"
            style="margin: 0"
          >
            {{ log.level }}
          </a-tag>
          <span class="log-module">[{{ log.module }}]</span>
          <span class="log-time">{{ log.time }}</span>
        </div>
        <span class="log-message">{{ log.message }}</span>
      </div>
      <a-empty v-if="filteredLogs.length === 0" description="暫無日誌" />
    </div>
  </a-card>
</template>

<style scoped>
.log-container {
  max-height: 600px;
  overflow-y: auto;
  overflow-x: auto;
  font-family: "Consolas", "Monaco", monospace;
  font-size: 12px;
  background: #fafafa;
  border-radius: 4px;
  padding: 12px;
}

.log-line {
  padding: 4px 0;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-line:hover {
  background: #e6f7ff;
  white-space: normal;
  word-break: break-all;
}

.log-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.log-time {
  color: #8c8c8c;
}

.log-module {
  color: #1890ff;
  margin-right: 4px;
}

.log-message {
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
}

.level-erro .log-message {
  color: #ff4d4f;
}

.level-warn .log-message {
  color: #faad14;
}

.level-dbug .log-message {
  color: #722ed1;
}

/* 工具欄樣式 */
.toolbar {
  margin-bottom: 16px;
}

.toolbar-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.toolbar-row:last-child {
  margin-bottom: 0;
}

/* 大螢幕：工具欄一行顯示 */
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

/* 日期選擇器 */
.stats-date-picker {
  width: 240px;
}

/* 響應式：小螢幕統計面板垂直佈局 */
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
  }
}

/* 響應式：行動端日誌堆疊佈局 */
@media (max-width: 768px) {
  .stats-date-picker {
    width: 100%;
  }

  .log-container {
    padding: 8px;
    font-size: 11px;
  }

  .log-line {
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    white-space: normal;
    word-break: break-all;
    padding: 6px 0;
  }

  .log-line:hover {
    white-space: normal;
  }

  .log-meta {
    flex-wrap: wrap;
  }

  .log-time {
    font-size: 10px;
  }

  .log-message {
    white-space: normal;
    word-break: break-all;
    overflow: visible;
  }
}
</style>
