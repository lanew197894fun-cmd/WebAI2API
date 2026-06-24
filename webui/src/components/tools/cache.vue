<script setup>
import { h, ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useSystemStore } from "@/stores/system";
import { useSettingsStore } from "@/stores/settings";
import {
  PoweroffOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  FolderOutlined,
  StopOutlined,
  LoginOutlined,
  DownOutlined,
} from "@ant-design/icons-vue";

const systemStore = useSystemStore();
const settingsStore = useSettingsStore();

// 重新啟動步驟當前狀態
const currentStep = ref(0);
const restarting = ref(false);

// 重新啟動步驟定義
const restartSteps = ref([
  {
    title: "準備重新啟動",
    status: "wait",
    icon: h(ClockCircleOutlined),
  },
  {
    title: "发送指令",
    status: "wait",
    icon: h(PoweroffOutlined),
  },
  {
    title: "等待重新啟動",
    status: "wait",
    icon: h(LoadingOutlined),
  },
  {
    title: "重新啟動完成",
    status: "wait",
    icon: h(CheckCircleOutlined),
  },
]);

// 實例資料夾抽屜
const instanceDrawerOpen = ref(false);
const selectedFolders = ref([]);

// 實例資料夾列表
const instanceFolders = ref([]);

// 重新啟動彈窗狀態
const restartModalVisible = ref(false);

// Workers 列表（用于登录模式选择）
const workers = ref([]);

// 確認重新啟動彈窗
const restartConfirmVisible = ref(false);
const pendingRestartOptions = ref({});

// 取得 workers 列表
const fetchWorkers = async () => {
  try {
    const res = await fetch("/admin/config/instances", {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      const instances = await res.json();
      // 从 instances 中提取所有 workers
      const allWorkers = [];
      for (const inst of instances) {
        for (const w of inst.workers || []) {
          allWorkers.push({ name: w.name, instance: inst.name });
        }
      }
      workers.value = allWorkers;
    }
  } catch (e) {
    console.error("取得 Workers 列表失敗", e);
  }
};

// 顯示重新啟動確認
const showRestartConfirm = (options = {}) => {
  pendingRestartOptions.value = options;
  restartConfirmVisible.value = true;
};

// 確認重新啟動
const confirmRestart = () => {
  restartConfirmVisible.value = false;
  handleRestart(pendingRestartOptions.value);
};

onMounted(() => {
  fetchWorkers();
});

// 辅助函数：延迟
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 執行重新啟動
const handleRestart = async (options = {}) => {
  restartModalVisible.value = true;
  restarting.value = true;
  currentStep.value = 0;

  // 步驟1: 準備
  restartSteps.value[0].status = "process";
  await sleep(500);
  restartSteps.value[0].status = "finish";
  currentStep.value = 1;

  // 步骤2: 发送指令 (调用API)
  restartSteps.value[1].status = "process";
  try {
    await systemStore.restartService(options);
    restartSteps.value[1].status = "finish";
    currentStep.value = 2;
  } catch (e) {
    restartSteps.value[1].status = "error";
    message.error("無法連接到伺服器");
    return;
  }

  // 步驟3: 等待服務恢復 (輪詢檢查)
  restartSteps.value[2].status = "process";
  // 先等待一小段時間讓服務重新啟動
  await sleep(3000);
  let retries = 20;
  while (retries > 0) {
    try {
      await systemStore.fetchStatus();
      if (systemStore.status) {
        break;
      }
    } catch (e) {
      // ignore
    }
    await sleep(2000);
    retries--;
  }
  restartSteps.value[2].status = "finish";
  currentStep.value = 3;

  // 步骤4: 完成
  restartSteps.value[3].status = "finish";

  message.success("服務重新啟動成功");

  // 延遲關閉彈窗並重設狀態
  setTimeout(() => {
    restartModalVisible.value = false;
    restarting.value = false;
    restartSteps.value.forEach((step) => (step.status = "wait"));
    currentStep.value = 0;
  }, 1500);
};

// 停止服务
const handleStop = async () => {
  try {
    const success = await systemStore.stopService();
    if (success) {
      message.success("服務已停止");
    }
  } catch (e) {
    message.error("停止服務失敗: " + e.message);
  }
};

// 清理快取
const handleClearCache = async () => {
  try {
    const res = await fetch("/admin/cache/clear", {
      method: "POST",
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      message.success("快取資料夾已清理");
    } else {
      message.error("清理失敗");
    }
  } catch (e) {
    message.error("請求失敗: " + e.message);
  }
};

// 開啟實例資料夾管理抽屜
const handleOpenInstanceDrawer = async () => {
  selectedFolders.value = [];
  instanceDrawerOpen.value = true;
  try {
    const res = await fetch("/admin/data-folders", {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      instanceFolders.value = await res.json();
    }
  } catch (e) {
    message.error("取得資料夾列表失敗");
  }
};

// 選中/取消選中資料夾
const handleFolderSelect = (name, checked) => {
  if (checked) {
    if (!selectedFolders.value.includes(name)) {
      selectedFolders.value.push(name);
    }
  } else {
    selectedFolders.value = selectedFolders.value.filter((n) => n !== name);
  }
};

// 刪除選中的實例資料
const handleDeleteSelectedFolders = async () => {
  if (selectedFolders.value.length === 0) {
    message.warning("請先選擇要刪除的資料夾");
    return;
  }

  try {
    const res = await fetch("/admin/data-folders/delete", {
      method: "POST",
      headers: settingsStore.getHeaders(),
      body: JSON.stringify({ folders: selectedFolders.value }),
    });

    if (res.ok) {
      message.success(`已刪除 ${selectedFolders.value.length} 個實例資料夾`);
      // 刷新列表
      await handleOpenInstanceDrawer();
    } else {
      message.error("刪除失敗");
    }
  } catch (e) {
    message.error("刪除請求失敗");
  }
};
</script>

<template>
  <a-layout style="background: transparent">
    <!-- 專案管理區塊 -->
    <a-card
      title="專案管理"
      :bordered="false"
      style="width: 100%; margin-bottom: 10px"
    >
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
        "
      >
        <div style="display: flex; align-items: center">
          <div style="margin-right: 16px">
            <div style="font-weight: 600; margin-bottom: 4px">系統服務控制</div>
            <div style="font-size: 12px; color: #8c8c8c">
              控制後端服務的執行狀態 (重啟或停止)
            </div>
          </div>
        </div>
        <div>
          <a-space>
            <!-- 下拉式重啟按鈕 -->
            <a-dropdown-button
              type="primary"
              size="large"
              @click="showRestartConfirm()"
            >
              <PoweroffOutlined />
              重啟
              <template #overlay>
                <a-menu>
                  <a-menu-item key="normal" @click="showRestartConfirm()">
                    <PoweroffOutlined />
                    普通重啟
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item
                    key="login"
                    @click="showRestartConfirm({ loginMode: true })"
                  >
                    <LoginOutlined />
                    登入模式重啟
                  </a-menu-item>
                  <a-sub-menu
                    v-if="workers.length > 1"
                    key="login-worker"
                    title="指定 Worker 登入"
                  >
                    <template #icon>
                      <LoginOutlined />
                    </template>
                    <a-menu-item
                      v-for="worker in workers"
                      :key="worker.name"
                      @click="
                        showRestartConfirm({
                          loginMode: true,
                          workerName: worker.name,
                        })
                      "
                    >
                      {{ worker.name }}
                    </a-menu-item>
                  </a-sub-menu>
                </a-menu>
              </template>
            </a-dropdown-button>

            <a-popconfirm
              ok-text="確定"
              cancel-text="取消"
              @confirm="handleStop"
              placement="topRight"
            >
              <template #title>
                <div style="width: 240px">
                  <div style="font-weight: 500; margin-bottom: 4px">
                    確定要停止服務嗎？
                  </div>
                  <div style="font-size: 12px; color: #f5222d">
                    停止後服務將完全終止，需要手動重新啟動。
                  </div>
                </div>
              </template>
              <a-button type="primary" danger size="large">
                <template #icon>
                  <StopOutlined />
                </template>
                停止
              </a-button>
            </a-popconfirm>
          </a-space>
        </div>
      </div>
    </a-card>

    <!-- 重啟確認模態框 -->
    <a-modal
      v-model:open="restartConfirmVisible"
      title="確認重啟"
      @ok="confirmRestart"
      ok-text="確定"
      cancel-text="取消"
      :width="400"
    >
      <div style="padding: 12px 0">
        <p v-if="!pendingRestartOptions.loginMode">確定要重啟服務嗎？</p>
        <p v-else-if="pendingRestartOptions.workerName">
          確定要以<b>登入模式</b>重啟服務嗎？<br />
          <span style="color: #1890ff"
            >僅初始化 Worker: {{ pendingRestartOptions.workerName }}</span
          >
        </p>
        <p v-else>確定要以<b>登入模式</b>重啟服務嗎？</p>
      </div>
    </a-modal>

    <!-- 重啟進度模態框 -->
    <a-modal
      v-model:open="restartModalVisible"
      title="系統服務重啟中"
      :footer="null"
      :closable="false"
      :maskClosable="false"
      width="500px"
    >
      <div style="padding: 24px 0">
        <a-steps :current="currentStep" :items="restartSteps" />
        <div style="text-align: center; margin-top: 24px; color: #8c8c8c">
          請稍候，系統正在執行重啟操作...
        </div>
      </div>
    </a-modal>

    <!-- 快取管理區塊 -->
    <a-card title="快取管理" :bordered="false" style="width: 100%">
      <a-row :gutter="[16, 16]">
        <!-- 清理快取 -->
        <a-col :xs="24" :md="12">
          <a-card
            style="height: 100%"
            :body-style="{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
            }"
          >
            <div style="flex: 1">
              <div
                style="display: flex; align-items: center; margin-bottom: 12px"
              >
                <DeleteOutlined
                  style="font-size: 24px; color: #1890ff; margin-right: 8px"
                />
                <div style="font-weight: 600; font-size: 16px">
                  清理快取資料夾
                </div>
              </div>
              <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px">
                清理專案執行過程中可能會遺留的臨時快取檔案（如遇到錯誤時遺留的圖片），<br />
                不會影響用戶資料和配置<strong style="color: #ff4d4f"
                  >有任務執行時請勿執行</strong
                >
              </div>
            </div>
            <a-popconfirm
              title="確定要清理快取資料夾嗎？"
              ok-text="確定"
              cancel-text="取消"
              @confirm="handleClearCache"
            >
              <a-button type="primary" block>
                <template #icon>
                  <DeleteOutlined />
                </template>
                清理快取
              </a-button>
            </a-popconfirm>
          </a-card>
        </a-col>

        <!-- 刪除實例資料 -->
        <a-col :xs="24" :md="12">
          <a-card
            style="height: 100%"
            :body-style="{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
            }"
          >
            <div style="flex: 1">
              <div
                style="display: flex; align-items: center; margin-bottom: 12px"
              >
                <FolderOutlined
                  style="font-size: 24px; color: #ff4d4f; margin-right: 8px"
                />
                <div style="font-weight: 600; font-size: 16px">
                  刪除實例資料夾
                </div>
              </div>
              <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px">
                刪除所有瀏覽器實例的用戶資料夾，<br />
                包括 Cookie、本地儲存等，<strong style="color: #ff4d4f"
                  >請謹慎操作</strong
                >
              </div>
            </div>
            <a-button danger block @click="handleOpenInstanceDrawer">
              <template #icon>
                <FolderOutlined />
              </template>
              管理實例資料
            </a-button>
          </a-card>
        </a-col>
      </a-row>
    </a-card>

    <!-- 實例資料資料夾管理抽屜 -->
    <a-drawer
      v-model:open="instanceDrawerOpen"
      title="管理實例資料資料夾"
      placement="right"
      width="500"
    >
      <div style="margin-bottom: 16px">
        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px">
          選擇要刪除的實例資料資料夾，刪除後無法恢復，請謹慎操作
        </div>

        <!-- 資料夾列表 -->
        <a-list :data-source="instanceFolders" bordered>
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  <a-checkbox
                    :checked="selectedFolders.includes(item.name)"
                    @change="
                      (e) => handleFolderSelect(item.name, e.target.checked)
                    "
                  >
                    {{ item.name }}
                  </a-checkbox>
                </template>
                <template #description>
                  <div style="font-size: 12px; margin-top: 4px">
                    <div>路徑: {{ item.path }}</div>
                    <div>關聯實例: {{ item.instance }}</div>
                    <div>大小: {{ item.size }}</div>
                  </div>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </div>

      <!-- 抽屜底部操作按鈕 -->
      <template #footer>
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
          "
        >
          <div style="font-size: 12px; color: #8c8c8c">
            已選擇 {{ selectedFolders.length }} 個資料夾
          </div>
          <div>
            <a-button
              style="margin-right: 8px"
              @click="instanceDrawerOpen = false"
            >
              取消
            </a-button>
            <a-popconfirm
              placement="topRight"
              ok-text="確定刪除"
              cancel-text="取消"
              @confirm="handleDeleteSelectedFolders"
            >
              <template #title>
                <div style="white-space: nowrap">
                  確定要刪除選中的 {{ selectedFolders.length }} 個資料夾嗎？
                </div>
              </template>
              <a-button
                type="primary"
                danger
                :disabled="selectedFolders.length === 0"
              >
                刪除選中項
              </a-button>
            </a-popconfirm>
          </div>
        </div>
      </template>
    </a-drawer>
  </a-layout>
</template>
