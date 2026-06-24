<script setup>
import { ref, onMounted, computed } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { Modal } from "ant-design-vue";

const settingsStore = useSettingsStore();

const poolConfig = computed({
  get: () => settingsStore.poolConfig,
  set: (val) => (settingsStore.poolConfig = val),
});

const handleSavePool = async () => {
  await settingsStore.savePoolConfig(poolConfig.value);
};

// 取得初始資料
onMounted(async () => {
  await Promise.all([
    settingsStore.fetchWorkerConfig(),
    settingsStore.fetchPoolConfig(),
    settingsStore.fetchAdaptersMeta(),
  ]);
});

// 計算屬性：適配器選項（包含 merge）
const adapterOptions = computed(() => {
  const options = settingsStore.adaptersMeta.map((a) => ({
    label: a.displayName || a.id,
    value: a.id,
  }));
  // 將 Merge 選項放在第一個位置
  if (!options.find((o) => o.value === "merge")) {
    options.unshift({ label: "Merge（聚合模式）", value: "merge" });
  }
  return options;
});

// 計算屬性：可聚合的適配器選項（不包含 merge，避免套娃）
const mergeableAdapterOptions = computed(() => {
  return settingsStore.adaptersMeta
    .filter((a) => a.id !== "merge")
    .map((a) => ({
      label: a.displayName || a.id,
      value: a.id,
    }));
});

// 輔助函數：根據適配器 ID 獲取 displayName
const getAdapterDisplayName = (id) => {
  if (id === "merge") return "Merge（聚合模式）";
  const adapter = settingsStore.adaptersMeta.find((a) => a.id === id);
  return adapter?.displayName || id;
};

// 實例列表表格列定義
const columns = [
  {
    title: "實例名稱",
    dataIndex: "name",
    key: "name",
  },
  {
    title: "Worker 數量",
    dataIndex: "workerCount",
    key: "workerCount",
  },
  {
    title: "代理",
    dataIndex: "proxy",
    key: "proxy",
  },
  {
    title: "資料標記",
    key: "userDataMark",
    dataIndex: "userDataMark",
  },
  {
    title: "操作",
    key: "action",
  },
];

// 實例列表資料 (從 Store 取得)
const instanceData = computed({
  get: () => settingsStore.workerConfig,
  set: (val) => {
    settingsStore.workerConfig = val;
  },
});

// 取得實例唯一識別（優先 id，沒有則用 name）
const getInstanceKey = (inst) => inst.id || inst.name;

// 批量選擇
const selectedRowKeys = ref([]);
const rowSelection = computed(() => ({
  selectedRowKeys: selectedRowKeys.value,
  onChange: (keys) => {
    selectedRowKeys.value = keys;
  },
}));

// 批量代理設定
const batchProxyVisible = ref(false);
const batchProxyForm = ref({
  proxy: true,
  proxyType: "socks5",
  proxyHost: "",
  proxyPort: 1080,
  proxyAuth: false,
  proxyUsername: "",
  proxyPassword: "",
});

const openBatchProxy = () => {
  batchProxyForm.value = {
    proxy: true,
    proxyType: "socks5",
    proxyHost: "",
    proxyPort: 1080,
    proxyAuth: false,
    proxyUsername: "",
    proxyPassword: "",
  };
  batchProxyVisible.value = true;
};

const handleBatchProxySave = async () => {
  const newList = (instanceData.value || []).map((inst) => {
    if (!selectedRowKeys.value.includes(getInstanceKey(inst))) return inst;
    return {
      ...inst,
      proxy: batchProxyForm.value.proxy
        ? {
            enable: true,
            type: batchProxyForm.value.proxyType,
            host: batchProxyForm.value.proxyHost,
            port: batchProxyForm.value.proxyPort,
            auth: batchProxyForm.value.proxyAuth,
            username: batchProxyForm.value.proxyUsername,
            password: batchProxyForm.value.proxyPassword,
          }
        : null,
    };
  });
  const success = await settingsStore.saveWorkerConfig(newList);
  if (success) {
    batchProxyVisible.value = false;
    selectedRowKeys.value = [];
  }
};

// 批量刪除
const handleBatchDelete = () => {
  Modal.confirm({
    title: "批量刪除實例",
    content: `確定要刪除選中的 ${selectedRowKeys.value.length} 個實例嗎？此操作不可撤銷。`,
    okText: "刪除",
    okType: "danger",
    cancelText: "取消",
    async onOk() {
      const newList = (instanceData.value || []).filter(
        (inst) => !selectedRowKeys.value.includes(getInstanceKey(inst)),
      );
      const success = await settingsStore.saveWorkerConfig(newList);
      if (success) {
        selectedRowKeys.value = [];
      }
    },
  });
};

// 抽屜狀態
const drawerOpen = ref(false);
const editingInstance = ref(null);

// 編輯表單資料
const editForm = ref({
  name: "",
  userDataMark: "",
  proxy: false,
  proxyType: "socks5",
  proxyHost: "",
  proxyPort: 1080,
  proxyAuth: false,
  proxyUsername: "",
  proxyPassword: "",
  workers: [],
});

// 創建實例
const handleCreateInstance = () => {
  editingInstance.value = null; // null表示創建新實例
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  // 重設表單為預設值
  editForm.value = {
    name: `instance-${(instanceData.value || []).length + 1}-${randomSuffix}`,
    userDataMark: "",
    proxy: false,
    proxyType: "socks5",
    proxyHost: "",
    proxyPort: 1080,
    proxyAuth: false,
    proxyUsername: "",
    proxyPassword: "",
    workers: [],
  };
  drawerOpen.value = true;
};

// 編輯實例
const handleEdit = (record) => {
  editingInstance.value = record;
  // 填充表單資料
  editForm.value = {
    name: record.name,
    userDataMark: record.userDataMark || "",
    proxy: record.proxy ? true : false,
    proxyType: record.proxy?.type || "socks5",
    proxyHost: record.proxy?.host || "",
    proxyPort: record.proxy?.port || 1080,
    proxyAuth: record.proxy?.auth || false,
    proxyUsername: record.proxy?.username || "",
    proxyPassword: record.proxy?.password || "",
    workers: record.workers ? [...record.workers] : [],
  };
  // 相容前端展示用的 proxy 布林值
  if (record.proxy === null || record.proxy === undefined) {
    editForm.value.proxy = false;
  }
  drawerOpen.value = true;
};

// 刪除實例
const handleDelete = async (record) => {
  const key = getInstanceKey(record);
  const newList = instanceData.value.filter(
    (item) => getInstanceKey(item) !== key,
  );
  await settingsStore.saveWorkerConfig(newList);
};

// 儲存編輯
const handleSaveEdit = async () => {
  // 構建要儲存的物件結構
  const instanceToSave = {
    name: editForm.value.name,
    userDataMark: editForm.value.userDataMark,
    workers: editForm.value.workers,
    // 如果啟用了代理，則構建代理物件，否則為 null
    proxy: editForm.value.proxy
      ? {
          enable: true,
          type: editForm.value.proxyType,
          host: editForm.value.proxyHost,
          port: editForm.value.proxyPort,
          auth: editForm.value.proxyAuth,
          username: editForm.value.proxyUsername,
          password: editForm.value.proxyPassword,
        }
      : null,
  };

  let newList = [...(instanceData.value || [])];
  if (editingInstance.value === null) {
    // 創建
    newList.push(instanceToSave);
  } else {
    // 更新 - 用唯一标识查找
    const editingKey = getInstanceKey(editingInstance.value);
    const index = newList.findIndex(
      (item) => getInstanceKey(item) === editingKey,
    );
    if (index > -1) {
      newList[index] = instanceToSave;
    }
  }

  const success = await settingsStore.saveWorkerConfig(newList);
  if (success) {
    drawerOpen.value = false;
  }
};

// 編輯中的Worker索引
const editingWorkerIndex = ref(-1);
const workerFormVisible = ref(false);
const workerForm = ref({
  name: "",
  type: "lmarena",
  mergeTypes: [],
  mergeMonitor: "",
});

// 添加Worker
const handleAddWorker = () => {
  editingWorkerIndex.value = -1;
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  workerForm.value = {
    name: `worker-${editForm.value.workers.length + 1}-${randomSuffix}`,
    type: "lmarena",
    mergeTypes: [],
    mergeMonitor: "",
  };
  workerFormVisible.value = true;
};

// 編輯Worker
const handleEditWorker = (index) => {
  editingWorkerIndex.value = index;
  const worker = editForm.value.workers[index];
  workerForm.value = {
    name: worker.name,
    type: worker.type,
    mergeTypes: worker.mergeTypes ? [...worker.mergeTypes] : [],
    mergeMonitor: worker.mergeMonitor || "",
  };
  workerFormVisible.value = true;
};

// 儲存Worker配置
const handleSaveWorker = () => {
  if (editingWorkerIndex.value === -1) {
    // 新增
    editForm.value.workers.push({ ...workerForm.value });
  } else {
    // 編輯
    editForm.value.workers[editingWorkerIndex.value] = { ...workerForm.value };
  }
  workerFormVisible.value = false;
};

// 刪除Worker
const handleRemoveWorker = (index) => {
  editForm.value.workers.splice(index, 1);
};
</script>

<template>
  <a-layout style="background: transparent">
    <a-card
      title="負載均衡"
      :bordered="false"
      style="width: 100%; margin-bottom: 10px"
    >
      <!-- 調度策略 -->
      <div style="margin-bottom: 24px">
        <div style="font-weight: 600; margin-bottom: 8px">調度策略</div>
        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px">
          選擇任務分配到工作實例的調度演算法
        </div>
        <a-segmented
          v-model:value="poolConfig.strategy"
          block
          :options="[
            { label: '最少繁忙', value: 'least_busy' },
            { label: '輪詢', value: 'round_robin' },
            { label: '隨機', value: 'random' },
          ]"
        />
      </div>

      <!-- 生成等待超時 -->
      <div style="margin-bottom: 24px">
        <div style="font-weight: 600; margin-bottom: 8px">生成等待超時</div>
        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px">
          等待 AI 生成結果的最長時間，單位：秒（預設 120 秒）
        </div>
        <a-input-number
          v-model:value="poolConfig.waitTimeout"
          :min="30"
          :max="3600"
          :step="30"
          style="width: 100%"
          placeholder="請輸入超時秒數"
        >
          <template #addonAfter>秒</template>
        </a-input-number>
      </div>

      <!-- 故障轉移（折疊面板） -->
      <div style="margin-bottom: 24px">
        <a-collapse>
          <a-collapse-panel key="failover" header="故障轉移">
            <a-row :gutter="16">
              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 8px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    啟用故障轉移
                  </div>
                  <div
                    style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px"
                  >
                    啟用後，任務失敗時會自動切換到其他可用實例重試
                  </div>
                  <a-switch v-model:checked="poolConfig.failover.enabled" />
                </div>
              </a-col>

              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 8px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    重試次數
                  </div>
                  <div
                    style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px"
                  >
                    故障轉移時最大重試次數，範圍 1-10
                  </div>
                  <a-input-number
                    v-model:value="poolConfig.failover.maxRetries"
                    :min="1"
                    :max="10"
                    :disabled="!poolConfig.failover.enabled"
                    style="width: 100%"
                    placeholder="請輸入重試次數"
                  />
                </div>
              </a-col>
            </a-row>

            <a-divider style="margin: 12px 0" />

            <a-row :gutter="16">
              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 8px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    圖片下載重試
                  </div>
                  <div
                    style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px"
                  >
                    啟用後，圖片/視頻下載失敗時會自動重試下載（不重新生成）
                  </div>
                  <a-switch v-model:checked="poolConfig.failover.imgDlRetry" />
                </div>
              </a-col>

              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 8px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    下載重試次數
                  </div>
                  <div
                    style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px"
                  >
                    圖片下載失敗時的最大重試次數，範圍 1-10
                  </div>
                  <a-input-number
                    v-model:value="poolConfig.failover.imgDlRetryMaxRetries"
                    :min="1"
                    :max="10"
                    :disabled="!poolConfig.failover.imgDlRetry"
                    style="width: 100%"
                    placeholder="請輸入下載重試次數"
                  />
                </div>
              </a-col>
            </a-row>
          </a-collapse-panel>
        </a-collapse>
      </div>

      <!-- 儲存按鈕 -->
      <div style="display: flex; justify-content: flex-end; margin-top: 24px">
        <a-button type="primary" @click="handleSavePool"> 儲存設定 </a-button>
      </div>
    </a-card>

    <a-card :bordered="false" style="width: 100%">
      <!-- 卡片標題和創建按鈕 -->
      <template #title>
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
          "
        >
          <span>實例列表</span>
          <a-space>
            <a-button v-if="selectedRowKeys.length > 0" @click="openBatchProxy">
              批量設定代理 ({{ selectedRowKeys.length }})
            </a-button>
            <a-button
              v-if="selectedRowKeys.length > 0"
              danger
              @click="handleBatchDelete"
            >
              批量刪除 ({{ selectedRowKeys.length }})
            </a-button>
            <a-button type="primary" @click="handleCreateInstance">
              創建實例
            </a-button>
          </a-space>
        </div>
      </template>

      <!-- 實例表格 -->
      <a-table
        :columns="columns"
        :data-source="instanceData"
        :pagination="false"
        :row-selection="rowSelection"
        :row-key="(record) => record.id || record.name"
      >
        <template #bodyCell="{ column, record }">
          <!-- 實例名稱 -->
          <template v-if="column.key === 'name'">
            <a>{{ record.name }}</a>
          </template>

          <!-- Worker 数量 -->
          <template v-else-if="column.key === 'workerCount'">
            {{ record.workers ? record.workers.length : 0 }}
          </template>

          <!-- 代理狀態 -->
          <template v-else-if="column.key === 'proxy'">
            <a-tag :color="record.proxy ? 'green' : 'default'">
              {{ record.proxy ? "已啟用" : "未啟用" }}
            </a-tag>
          </template>

          <!-- 操作列 -->
          <template v-else-if="column.key === 'action'">
            <span>
              <a @click="handleEdit(record)">編輯</a>
              <a-divider type="vertical" />
              <a style="color: #ff4d4f" @click="handleDelete(record)">刪除</a>
            </span>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 編輯/創建抽屜 -->
    <a-drawer
      v-model:open="drawerOpen"
      :title="
        editingInstance === null
          ? '創建實例'
          : `編輯實例 - ${editingInstance.name}`
      "
      placement="right"
      width="500"
    >
      <div style="margin-bottom: 24px">
        <!-- 實例名稱 -->
        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 4px">實例名稱</div>
          <div style="font-size: 12px; color: #ff4d4f; margin-bottom: 8px">
            * 名稱必須全局唯一，不可重複
          </div>
          <a-input v-model:value="editForm.name" placeholder="請輸入實例名稱" />
        </div>

        <!-- 資料標記 -->
        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 4px">資料標記</div>
          <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
            用於區分實例資料存儲的資料夾名稱 (userDataMark)
          </div>
          <a-input
            v-model:value="editForm.userDataMark"
            placeholder="請輸入資料標記，如: main-gemini"
          />
        </div>

        <!-- 代理設定（折疊面板） -->
        <div style="margin-bottom: 16px">
          <a-collapse>
            <a-collapse-panel key="proxy" header="代理設定">
              <!-- 是否啟用代理 -->
              <div style="margin-bottom: 16px">
                <a-switch v-model:checked="editForm.proxy" />
                <span style="margin-left: 8px">
                  {{ editForm.proxy ? "已啟用代理" : "未啟用代理" }}
                </span>
              </div>

              <!-- 代理類型 -->
              <div style="margin-bottom: 16px" v-if="editForm.proxy">
                <div style="font-weight: 600; margin-bottom: 8px">代理類型</div>
                <a-segmented
                  v-model:value="editForm.proxyType"
                  block
                  :options="[
                    { label: 'SOCKS5', value: 'socks5' },
                    { label: 'HTTP', value: 'http' },
                  ]"
                  style="width: 100%"
                />
              </div>

              <!-- 伺服器地址 -->
              <div style="margin-bottom: 16px" v-if="editForm.proxy">
                <div style="font-weight: 600; margin-bottom: 8px">
                  伺服器地址
                </div>
                <a-input
                  v-model:value="editForm.proxyHost"
                  placeholder="例如: 127.0.0.1"
                />
              </div>

              <!-- 埠號 -->
              <div style="margin-bottom: 16px" v-if="editForm.proxy">
                <div style="font-weight: 600; margin-bottom: 8px">埠號</div>
                <a-input-number
                  v-model:value="editForm.proxyPort"
                  :min="1"
                  :max="65535"
                  style="width: 100%"
                  placeholder="例如: 1080"
                />
              </div>

              <!-- 是否需要驗證 -->
              <div style="margin-bottom: 16px" v-if="editForm.proxy">
                <div style="font-weight: 600; margin-bottom: 8px">身份驗證</div>
                <a-switch v-model:checked="editForm.proxyAuth" />
                <span style="margin-left: 8px">
                  {{ editForm.proxyAuth ? "需要驗證" : "無需驗證" }}
                </span>
              </div>

              <!-- 用戶名 -->
              <div
                style="margin-bottom: 16px"
                v-if="editForm.proxy && editForm.proxyAuth"
              >
                <div style="font-weight: 600; margin-bottom: 8px">用戶名</div>
                <a-input
                  v-model:value="editForm.proxyUsername"
                  placeholder="請輸入用戶名"
                />
              </div>

              <!-- 密碼 -->
              <div
                style="margin-bottom: 16px"
                v-if="editForm.proxy && editForm.proxyAuth"
              >
                <div style="font-weight: 600; margin-bottom: 8px">密碼</div>
                <a-input-password
                  v-model:value="editForm.proxyPassword"
                  placeholder="請輸入密碼"
                />
              </div>
            </a-collapse-panel>
          </a-collapse>
        </div>

        <!-- Worker 列表 -->
        <div>
          <div
            style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 8px;
            "
          >
            <div style="font-weight: 600">Worker 列表</div>
            <a-button size="small" type="primary" @click="handleAddWorker">
              添加 Worker
            </a-button>
          </div>
          <a-list
            bordered
            :data-source="editForm.workers"
            style="margin-top: 8px"
          >
            <template #renderItem="{ item, index }">
              <a-list-item>
                <template #actions>
                  <a @click="handleEditWorker(index)">編輯</a>
                  <a style="color: #ff4d4f" @click="handleRemoveWorker(index)"
                    >刪除</a
                  >
                </template>
                <div>
                  <div style="font-weight: 600">{{ item.name }}</div>
                  <div style="font-size: 12px; color: #8c8c8c">
                    類型: {{ getAdapterDisplayName(item.type) }}
                    <span v-if="item.type === 'merge'">
                      | 聚合:
                      {{
                        item.mergeTypes
                          ?.map(getAdapterDisplayName)
                          .join(", ") || "無"
                      }}
                      <span v-if="item.mergeMonitor">
                        | 監控: {{ getAdapterDisplayName(item.mergeMonitor) }}
                      </span>
                    </span>
                  </div>
                </div>
              </a-list-item>
            </template>
          </a-list>
        </div>
      </div>

      <!-- 抽屜底部儲存按鈕 -->
      <template #footer>
        <div style="text-align: right">
          <a-button style="margin-right: 8px" @click="drawerOpen = false"
            >取消</a-button
          >
          <a-button type="primary" @click="handleSaveEdit">儲存</a-button>
        </div>
      </template>
    </a-drawer>

    <!-- Worker配置模態框 -->
    <a-modal
      v-model:open="workerFormVisible"
      :title="editingWorkerIndex === -1 ? '添加 Worker' : '編輯 Worker'"
      okText="確定"
      cancelText="取消"
      @ok="handleSaveWorker"
    >
      <div style="margin-bottom: 16px">
        <div style="font-weight: 600; margin-bottom: 4px">Worker 名稱</div>
        <div style="font-size: 12px; color: #ff4d4f; margin-bottom: 8px">
          * 名稱必須全局唯一，不可重複
        </div>
        <a-input v-model:value="workerForm.name" placeholder="例如: default" />
      </div>

      <div style="margin-bottom: 16px">
        <div style="font-weight: 600; margin-bottom: 8px">適配器類型</div>
        <a-select
          v-model:value="workerForm.type"
          style="width: 100%"
          :options="adapterOptions"
        />
      </div>

      <!-- Merge 模式額外配置 -->
      <template v-if="workerForm.type === 'merge'">
        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 4px">聚合類型</div>
          <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
            選擇要聚合的後端適配器（可多選）
          </div>
          <a-select
            v-model:value="workerForm.mergeTypes"
            mode="multiple"
            style="width: 100%"
            placeholder="選擇要聚合的適配器"
            :options="mergeableAdapterOptions"
          >
          </a-select>
        </div>

        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 4px">空閒監控後端</div>
          <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
            空閒時掛機監控的後端（可選）
          </div>
          <a-select
            v-model:value="workerForm.mergeMonitor"
            style="width: 100%"
            placeholder="選擇監控後端（可留空）"
            allow-clear
          >
            <a-select-option value="">無</a-select-option>
            <a-select-option
              v-for="type in workerForm.mergeTypes"
              :key="type"
              :value="type"
            >
              {{ getAdapterDisplayName(type) }}
            </a-select-option>
          </a-select>
        </div>
      </template>
    </a-modal>

    <!-- 批量代理設定模態框 -->
    <a-modal
      v-model:open="batchProxyVisible"
      title="批量設定代理"
      okText="確定"
      cancelText="取消"
      @ok="handleBatchProxySave"
    >
      <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px">
        將對選中的 {{ selectedRowKeys.length }} 個實例統一設定代理
      </div>
      <div style="margin-bottom: 16px">
        <a-switch v-model:checked="batchProxyForm.proxy" />
        <span style="margin-left: 8px">
          {{ batchProxyForm.proxy ? "啟用代理" : "停用代理" }}
        </span>
      </div>

      <template v-if="batchProxyForm.proxy">
        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 8px">代理類型</div>
          <a-segmented
            v-model:value="batchProxyForm.proxyType"
            block
            :options="[
              { label: 'SOCKS5', value: 'socks5' },
              { label: 'HTTP', value: 'http' },
            ]"
            style="width: 100%"
          />
        </div>

        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 8px">伺服器地址</div>
          <a-input
            v-model:value="batchProxyForm.proxyHost"
            placeholder="例如: 127.0.0.1"
          />
        </div>

        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 8px">埠號</div>
          <a-input-number
            v-model:value="batchProxyForm.proxyPort"
            :min="1"
            :max="65535"
            style="width: 100%"
            placeholder="例如: 1080"
          />
        </div>

        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 8px">身份驗證</div>
          <a-switch v-model:checked="batchProxyForm.proxyAuth" />
          <span style="margin-left: 8px">
            {{ batchProxyForm.proxyAuth ? "需要驗證" : "無需驗證" }}
          </span>
        </div>

        <div style="margin-bottom: 16px" v-if="batchProxyForm.proxyAuth">
          <div style="font-weight: 600; margin-bottom: 8px">用戶名</div>
          <a-input
            v-model:value="batchProxyForm.proxyUsername"
            placeholder="請輸入用戶名"
          />
        </div>

        <div style="margin-bottom: 16px" v-if="batchProxyForm.proxyAuth">
          <div style="font-weight: 600; margin-bottom: 8px">密碼</div>
          <a-input-password
            v-model:value="batchProxyForm.proxyPassword"
            placeholder="請輸入密碼"
          />
        </div>
      </template>
    </a-modal>
  </a-layout>
</template>
