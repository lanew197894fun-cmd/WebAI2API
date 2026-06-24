<script setup>
import { ref, onMounted, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@/stores/settings";
import { Modal } from "ant-design-vue";

const settingsStore = useSettingsStore();
const { t } = useI18n();

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
    options.unshift({ label: t("adapters.mergeMode"), value: "merge" });
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
  if (id === "merge") return t("adapters.mergeMode");
  const adapter = settingsStore.adaptersMeta.find((a) => a.id === id);
  return adapter?.displayName || id;
};

// 實例列表表格列定義
const columns = [
  {
    title: t("workers.instanceName"),
    dataIndex: "name",
    key: "name",
  },
  {
    title: t("workers.workers"),
    dataIndex: "workerCount",
    key: "workerCount",
  },
  {
    title: t("browser.proxy"),
    dataIndex: "proxy",
    key: "proxy",
  },
  {
    title: t("workers.instanceName"),
    key: "userDataMark",
    dataIndex: "userDataMark",
  },
  {
    title: t("common.operation"),
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
    title: t("workers.deleteInstance"),
    content: t("common.confirmDeleteItems", {
      n: selectedRowKeys.value.length,
    }),
    okText: t("common.delete"),
    okType: "danger",
    cancelText: t("common.cancel"),
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
      :title="$t('workers.poolConfig')"
      :bordered="false"
      style="width: 100%; margin-bottom: 10px"
    >
      <!-- 調度策略 -->
      <div style="margin-bottom: 24px">
        <div style="font-weight: 600; margin-bottom: 8px">
          {{ $t("workers.strategy") }}
        </div>
        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px">
          {{ $t("workers.strategy") }}
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
        <div style="font-weight: 600; margin-bottom: 8px">
          {{ $t("workers.waitTimeout") }}
        </div>
        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px">
          {{ $t("workers.waitTimeout") }}
        </div>
        <a-input-number
          v-model:value="poolConfig.waitTimeout"
          :min="30"
          :max="3600"
          :step="30"
          style="width: 100%"
          :placeholder="$t('workers.waitTimeout')"
        >
          <template #addonAfter>{{ $t("common.items") }}</template>
        </a-input-number>
      </div>

      <!-- 故障轉移（折疊面板） -->
      <div style="margin-bottom: 24px">
        <a-collapse>
          <a-collapse-panel key="failover" :header="$t('workers.failover')">
            <a-row :gutter="16">
              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 8px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    {{ $t("workers.failover") }}
                  </div>
                  <div
                    style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px"
                  >
                    {{ $t("workers.failover") }}
                  </div>
                  <a-switch v-model:checked="poolConfig.failover.enabled" />
                </div>
              </a-col>

              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 8px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    {{ $t("workers.maxRetries") }}
                  </div>
                  <div
                    style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px"
                  >
                    {{ $t("workers.maxRetries") }}
                  </div>
                  <a-input-number
                    v-model:value="poolConfig.failover.maxRetries"
                    :min="1"
                    :max="10"
                    :disabled="!poolConfig.failover.enabled"
                    style="width: 100%"
                    :placeholder="$t('workers.maxRetries')"
                  />
                </div>
              </a-col>
            </a-row>

            <a-divider style="margin: 12px 0" />

            <a-row :gutter="16">
              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 8px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    {{ $t("workers.imgRetry") }}
                  </div>
                  <div
                    style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px"
                  >
                    {{ $t("workers.imgRetry") }}
                  </div>
                  <a-switch v-model:checked="poolConfig.failover.imgDlRetry" />
                </div>
              </a-col>

              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 8px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    {{ $t("workers.imgMaxRetries") }}
                  </div>
                  <div
                    style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px"
                  >
                    {{ $t("workers.imgMaxRetries") }}
                  </div>
                  <a-input-number
                    v-model:value="poolConfig.failover.imgDlRetryMaxRetries"
                    :min="1"
                    :max="10"
                    :disabled="!poolConfig.failover.imgDlRetry"
                    style="width: 100%"
                    :placeholder="$t('workers.imgMaxRetries')"
                  />
                </div>
              </a-col>
            </a-row>
          </a-collapse-panel>
        </a-collapse>
      </div>

      <!-- 儲存按鈕 -->
      <div style="display: flex; justify-content: flex-end; margin-top: 24px">
        <a-button type="primary" @click="handleSavePool">
          {{ $t("common.saveSettings") }}
        </a-button>
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
          <span>{{ $t("workers.title") }}</span>
          <a-space>
            <a-button v-if="selectedRowKeys.length > 0" @click="openBatchProxy">
              {{ $t("browser.proxy") }} ({{ selectedRowKeys.length }})
            </a-button>
            <a-button
              v-if="selectedRowKeys.length > 0"
              danger
              @click="handleBatchDelete"
            >
              {{ $t("common.delete") }} ({{ selectedRowKeys.length }})
            </a-button>
            <a-button type="primary" @click="handleCreateInstance">
              {{ $t("workers.addInstance") }}
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
              {{ record.proxy ? $t("common.enable") : $t("common.disable") }}
            </a-tag>
          </template>

          <!-- 操作列 -->
          <template v-else-if="column.key === 'action'">
            <span>
              <a @click="handleEdit(record)">{{ $t("common.detail") }}</a>
              <a-divider type="vertical" />
              <a style="color: #ff4d4f" @click="handleDelete(record)">{{
                $t("common.delete")
              }}</a>
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
          ? $t('workers.addInstance')
          : $t('workers.title') + ' - ' + editingInstance.name
      "
      placement="right"
      width="500"
    >
      <div style="margin-bottom: 24px">
        <!-- 實例名稱 -->
        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 4px">
            {{ $t("workers.instanceName") }}
          </div>
          <div style="font-size: 12px; color: #ff4d4f; margin-bottom: 8px">
            * {{ $t("workers.instanceName") }}
          </div>
          <a-input
            v-model:value="editForm.name"
            :placeholder="$t('workers.instanceName')"
          />
        </div>

        <!-- 資料標記 -->
        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 4px">
            {{ $t("workers.instanceName") }}
          </div>
          <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
            {{ $t("workers.instanceName") }}
          </div>
          <a-input
            v-model:value="editForm.userDataMark"
            :placeholder="$t('workers.instanceName')"
          />
        </div>

        <!-- 代理設定（折疊面板） -->
        <div style="margin-bottom: 16px">
          <a-collapse>
            <a-collapse-panel key="proxy" :header="$t('browser.proxy')">
              <!-- 是否啟用代理 -->
              <div style="margin-bottom: 16px">
                <a-switch v-model:checked="editForm.proxy" />
                <span style="margin-left: 8px">
                  {{
                    editForm.proxy ? $t("common.enable") : $t("common.disable")
                  }}
                </span>
              </div>

              <!-- 代理類型 -->
              <div style="margin-bottom: 16px" v-if="editForm.proxy">
                <div style="font-weight: 600; margin-bottom: 8px">
                  {{ $t("browser.proxyType") }}
                </div>
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
                  {{ $t("browser.proxyHost") }}
                </div>
                <a-input
                  v-model:value="editForm.proxyHost"
                  :placeholder="$t('browser.proxyHost')"
                />
              </div>

              <!-- 埠號 -->
              <div style="margin-bottom: 16px" v-if="editForm.proxy">
                <div style="font-weight: 600; margin-bottom: 8px">
                  {{ $t("browser.proxyPort") }}
                </div>
                <a-input-number
                  v-model:value="editForm.proxyPort"
                  :min="1"
                  :max="65535"
                  style="width: 100%"
                  :placeholder="$t('browser.proxyPort')"
                />
              </div>

              <!-- 是否需要驗證 -->
              <div style="margin-bottom: 16px" v-if="editForm.proxy">
                <div style="font-weight: 600; margin-bottom: 8px">
                  {{ $t("browser.proxyAuth") }}
                </div>
                <a-switch v-model:checked="editForm.proxyAuth" />
                <span style="margin-left: 8px">
                  {{ editForm.proxyAuth ? $t("common.yes") : $t("common.no") }}
                </span>
              </div>

              <!-- 用戶名 -->
              <div
                style="margin-bottom: 16px"
                v-if="editForm.proxy && editForm.proxyAuth"
              >
                <div style="font-weight: 600; margin-bottom: 8px">
                  {{ $t("browser.proxyUser") }}
                </div>
                <a-input
                  v-model:value="editForm.proxyUsername"
                  :placeholder="$t('browser.proxyUser')"
                />
              </div>

              <!-- 密碼 -->
              <div
                style="margin-bottom: 16px"
                v-if="editForm.proxy && editForm.proxyAuth"
              >
                <div style="font-weight: 600; margin-bottom: 8px">
                  {{ $t("browser.proxyPass") }}
                </div>
                <a-input-password
                  v-model:value="editForm.proxyPassword"
                  :placeholder="$t('browser.proxyPass')"
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
            <div style="font-weight: 600">{{ $t("workers.workers") }}</div>
            <a-button size="small" type="primary" @click="handleAddWorker">
              {{ $t("workers.addInstance") }}
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
                  <a @click="handleEditWorker(index)">{{
                    $t("common.detail")
                  }}</a>
                  <a
                    style="color: #ff4d4f"
                    @click="handleRemoveWorker(index)"
                    >{{ $t("common.delete") }}</a
                  >
                </template>
                <div>
                  <div style="font-weight: 600">{{ item.name }}</div>
                  <div style="font-size: 12px; color: #8c8c8c">
                    {{ $t("workers.adapter") }}:
                    {{ getAdapterDisplayName(item.type) }}
                    <span v-if="item.type === 'merge'">
                      | {{ $t("adapters.mergeMode") }}:
                      {{
                        item.mergeTypes
                          ?.map(getAdapterDisplayName)
                          .join(", ") || $t("common.no")
                      }}
                      <span v-if="item.mergeMonitor">
                        | {{ $t("adapters.adapterConfig") }}:
                        {{ getAdapterDisplayName(item.mergeMonitor) }}
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
          <a-button style="margin-right: 8px" @click="drawerOpen = false">{{
            $t("common.cancel")
          }}</a-button>
          <a-button type="primary" @click="handleSaveEdit">{{
            $t("common.save")
          }}</a-button>
        </div>
      </template>
    </a-drawer>

    <!-- Worker配置模態框 -->
    <a-modal
      v-model:open="workerFormVisible"
      :title="
        editingWorkerIndex === -1
          ? $t('workers.addInstance')
          : $t('workers.title')
      "
      :okText="$t('common.ok')"
      :cancelText="$t('common.cancel')"
      @ok="handleSaveWorker"
    >
      <div style="margin-bottom: 16px">
        <div style="font-weight: 600; margin-bottom: 4px">
          {{ $t("workers.instanceName") }}
        </div>
        <div style="font-size: 12px; color: #ff4d4f; margin-bottom: 8px">
          * {{ $t("workers.instanceName") }}
        </div>
        <a-input
          v-model:value="workerForm.name"
          :placeholder="$t('workers.instanceName')"
        />
      </div>

      <div style="margin-bottom: 16px">
        <div style="font-weight: 600; margin-bottom: 8px">
          {{ $t("workers.adapter") }}
        </div>
        <a-select
          v-model:value="workerForm.type"
          style="width: 100%"
          :options="adapterOptions"
        />
      </div>

      <!-- Merge 模式額外配置 -->
      <template v-if="workerForm.type === 'merge'">
        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 4px">
            {{ $t("workers.adapter") }}
          </div>
          <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
            {{ $t("workers.adapter") }}
          </div>
          <a-select
            v-model:value="workerForm.mergeTypes"
            mode="multiple"
            style="width: 100%"
            :placeholder="$t('workers.adapter')"
            :options="mergeableAdapterOptions"
          >
          </a-select>
        </div>

        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 4px">
            {{ $t("workers.adapter") }}
          </div>
          <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
            {{ $t("workers.adapter") }}
          </div>
          <a-select
            v-model:value="workerForm.mergeMonitor"
            style="width: 100%"
            :placeholder="$t('workers.adapter')"
            allow-clear
          >
            <a-select-option value="">{{ $t("common.no") }}</a-select-option>
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
      :title="$t('browser.proxy')"
      :okText="$t('common.ok')"
      :cancelText="$t('common.cancel')"
      @ok="handleBatchProxySave"
    >
      <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px">
        {{ $t("browser.proxy") }}: {{ selectedRowKeys.length }}
      </div>
      <div style="margin-bottom: 16px">
        <a-switch v-model:checked="batchProxyForm.proxy" />
        <span style="margin-left: 8px">
          {{
            batchProxyForm.proxy ? $t("common.enable") : $t("common.disable")
          }}
        </span>
      </div>

      <template v-if="batchProxyForm.proxy">
        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 8px">
            {{ $t("browser.proxyType") }}
          </div>
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
          <div style="font-weight: 600; margin-bottom: 8px">
            {{ $t("browser.proxyHost") }}
          </div>
          <a-input
            v-model:value="batchProxyForm.proxyHost"
            :placeholder="$t('browser.proxyHost')"
          />
        </div>

        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 8px">
            {{ $t("browser.proxyPort") }}
          </div>
          <a-input-number
            v-model:value="batchProxyForm.proxyPort"
            :min="1"
            :max="65535"
            style="width: 100%"
            :placeholder="$t('browser.proxyPort')"
          />
        </div>

        <div style="margin-bottom: 16px">
          <div style="font-weight: 600; margin-bottom: 8px">
            {{ $t("browser.proxyAuth") }}
          </div>
          <a-switch v-model:checked="batchProxyForm.proxyAuth" />
          <span style="margin-left: 8px">
            {{ batchProxyForm.proxyAuth ? $t("common.yes") : $t("common.no") }}
          </span>
        </div>

        <div style="margin-bottom: 16px" v-if="batchProxyForm.proxyAuth">
          <div style="font-weight: 600; margin-bottom: 8px">
            {{ $t("browser.proxyUser") }}
          </div>
          <a-input
            v-model:value="batchProxyForm.proxyUsername"
            :placeholder="$t('browser.proxyUser')"
          />
        </div>

        <div style="margin-bottom: 16px" v-if="batchProxyForm.proxyAuth">
          <div style="font-weight: 600; margin-bottom: 8px">
            {{ $t("browser.proxyPass") }}
          </div>
          <a-input-password
            v-model:value="batchProxyForm.proxyPassword"
            :placeholder="$t('browser.proxyPass')"
          />
        </div>
      </template>
    </a-modal>
  </a-layout>
</template>
