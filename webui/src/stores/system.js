import { defineStore } from "pinia";
import { message } from "ant-design-vue";
import { useSettingsStore } from "./settings";

export const useSystemStore = defineStore("system", {
  state: () => ({
    // 系統狀態
    status: "",
    version: "1.0.0",
    systemVersion: "",
    uptime: 0,
    cpuUsage: 0,
    memoryUsage: {
      total: 0,
      used: 0,
      free: 0,
    },

    // 安全模式狀態
    safeMode: {
      enabled: false,
      reason: null,
    },

    // 儀表板統計資訊
    stats: {
      totalRequests: 0,
      successRate: 0,
      activeWorkers: 0,
      totalWorkers: 0,
      avgResponseTime: 0,
      success: 0,
      failed: 0,
    },
  }),

  actions: {
    // 取得系統狀態
    async fetchStatus() {
      const settingsStore = useSettingsStore();
      try {
        const response = await fetch("/admin/status", {
          headers: settingsStore.getHeaders(),
        });
        // 如果返回 401，狀態更新將失敗，由 App.vue 的身分驗證檢查處理
        if (response.ok) {
          const data = await response.json();
          this.$patch(data);
        }
      } catch (error) {
        console.error("Failed to fetch system status:", error);
      }
    },

    // 取得儀表板統計資訊
    async fetchStats() {
      const settingsStore = useSettingsStore();
      try {
        const response = await fetch("/admin/stats", {
          headers: settingsStore.getHeaders(),
        });
        if (response.ok) {
          const data = await response.json();
          this.stats = data;
        }
      } catch (error) {
        console.error("Failed to fetch stats:", error);
      }
    },

    // 重新啟動服務
    async restartService(options = {}) {
      const settingsStore = useSettingsStore();
      const { loginMode, workerName } = options;
      try {
        const response = await fetch("/admin/restart", {
          method: "POST",
          headers: {
            ...settingsStore.getHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ loginMode, workerName }),
        });
        const data = await response.json();
        if (data.success) {
          message.success(data.message || "服務重新啟動中...");
          return true;
        } else {
          message.error("重新啟動失敗");
          return false;
        }
      } catch (error) {
        message.error("重新啟動請求失敗");
        return false;
      }
    },

    // 停止服務
    async stopService() {
      const settingsStore = useSettingsStore();
      try {
        const response = await fetch("/admin/stop", {
          method: "POST",
          headers: settingsStore.getHeaders(),
        });
        const data = await response.json();
        if (data.success) {
          message.success(data.message || "服務停止中...");
          return true;
        } else {
          message.error("停止失敗");
          return false;
        }
      } catch (error) {
        message.error("停止請求失敗");
        return false;
      }
    },
  },
});
