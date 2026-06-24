<script setup>
import { h, ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
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

const { t } = useI18n();
const systemStore = useSystemStore();
const settingsStore = useSettingsStore();

const currentStep = ref(0);
const restarting = ref(false);

const restartSteps = ref([
  {
    title: t("cache.stepPrepare"),
    status: "wait",
    icon: h(ClockCircleOutlined),
  },
  {
    title: t("cache.stepSendCmd"),
    status: "wait",
    icon: h(PoweroffOutlined),
  },
  {
    title: t("cache.stepWait"),
    status: "wait",
    icon: h(LoadingOutlined),
  },
  {
    title: t("cache.stepDone"),
    status: "wait",
    icon: h(CheckCircleOutlined),
  },
]);

const instanceDrawerOpen = ref(false);
const selectedFolders = ref([]);

const instanceFolders = ref([]);

const restartModalVisible = ref(false);

const workers = ref([]);

const restartConfirmVisible = ref(false);
const pendingRestartOptions = ref({});

const fetchWorkers = async () => {
  try {
    const res = await fetch("/admin/config/instances", {
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      const instances = await res.json();
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

const showRestartConfirm = (options = {}) => {
  pendingRestartOptions.value = options;
  restartConfirmVisible.value = true;
};

const confirmRestart = () => {
  restartConfirmVisible.value = false;
  handleRestart(pendingRestartOptions.value);
};

onMounted(() => {
  fetchWorkers();
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const handleRestart = async (options = {}) => {
  restartModalVisible.value = true;
  restarting.value = true;
  currentStep.value = 0;

  restartSteps.value[0].status = "process";
  await sleep(500);
  restartSteps.value[0].status = "finish";
  currentStep.value = 1;

  restartSteps.value[1].status = "process";
  try {
    await systemStore.restartService(options);
    restartSteps.value[1].status = "finish";
    currentStep.value = 2;
  } catch (e) {
    restartSteps.value[1].status = "error";
    message.error(t("common.failed"));
    return;
  }

  restartSteps.value[2].status = "process";
  await sleep(3000);
  let retries = 20;
  while (retries > 0) {
    try {
      await systemStore.fetchStatus();
      if (systemStore.status) {
        break;
      }
    } catch (e) {}
    await sleep(2000);
    retries--;
  }
  restartSteps.value[2].status = "finish";
  currentStep.value = 3;

  restartSteps.value[3].status = "finish";

  message.success(t("cache.restartSuccess"));

  setTimeout(() => {
    restartModalVisible.value = false;
    restarting.value = false;
    restartSteps.value.forEach((step) => (step.status = "wait"));
    currentStep.value = 0;
  }, 1500);
};

const handleStop = async () => {
  try {
    const success = await systemStore.stopService();
    if (success) {
      message.success(t("common.success"));
    }
  } catch (e) {
    message.error(t("common.failed") + ": " + e.message);
  }
};

const handleClearCache = async () => {
  try {
    const res = await fetch("/admin/cache/clear", {
      method: "POST",
      headers: settingsStore.getHeaders(),
    });
    if (res.ok) {
      message.success(t("cache.cacheCleared"));
    } else {
      message.error(t("common.failed"));
    }
  } catch (e) {
    message.error(t("common.failed") + ": " + e.message);
  }
};

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
    message.error(t("common.failed"));
  }
};

const handleFolderSelect = (name, checked) => {
  if (checked) {
    if (!selectedFolders.value.includes(name)) {
      selectedFolders.value.push(name);
    }
  } else {
    selectedFolders.value = selectedFolders.value.filter((n) => n !== name);
  }
};

const handleDeleteSelectedFolders = async () => {
  if (selectedFolders.value.length === 0) {
    message.warning(t("cache.noFolderSelected"));
    return;
  }

  try {
    const res = await fetch("/admin/data-folders/delete", {
      method: "POST",
      headers: settingsStore.getHeaders(),
      body: JSON.stringify({ folders: selectedFolders.value }),
    });

    if (res.ok) {
      message.success(
        t("cache.foldersDeleted", { n: selectedFolders.value.length }),
      );
      await handleOpenInstanceDrawer();
    } else {
      message.error(t("common.failed"));
    }
  } catch (e) {
    message.error(t("common.failed"));
  }
};
</script>

<template>
  <a-layout style="background: transparent">
    <a-card
      :title="$t('cache.projectMgmt')"
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
            <div style="font-weight: 600; margin-bottom: 4px">
              {{ $t("cache.serviceControl") }}
            </div>
            <div style="font-size: 12px; color: #8c8c8c">
              {{ $t("cache.serviceControlDescCN") }}
            </div>
          </div>
        </div>
        <div>
          <a-space>
            <a-dropdown-button
              type="primary"
              size="large"
              @click="showRestartConfirm()"
            >
              <PoweroffOutlined />
              {{ $t("cache.restart") }}
              <template #overlay>
                <a-menu>
                  <a-menu-item key="normal" @click="showRestartConfirm()">
                    <PoweroffOutlined />
                    {{ $t("cache.normalRestart") }}
                  </a-menu-item>
                  <a-menu-divider />
                  <a-menu-item
                    key="login"
                    @click="showRestartConfirm({ loginMode: true })"
                  >
                    <LoginOutlined />
                    {{ $t("cache.loginModeRestart") }}
                  </a-menu-item>
                  <a-sub-menu
                    v-if="workers.length > 1"
                    key="login-worker"
                    :title="$t('cache.specifyWorker')"
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
              :ok-text="$t('common.confirm')"
              :cancel-text="$t('common.cancel')"
              @confirm="handleStop"
              placement="topRight"
            >
              <template #title>
                <div style="width: 240px">
                  <div style="font-weight: 500; margin-bottom: 4px">
                    {{ $t("cache.stopConfirmTitleCN") }}
                  </div>
                  <div style="font-size: 12px; color: #f5222d">
                    {{ $t("cache.stopConfirmContentCN") }}
                  </div>
                </div>
              </template>
              <a-button type="primary" danger size="large">
                <template #icon>
                  <StopOutlined />
                </template>
                {{ $t("cache.stop") }}
              </a-button>
            </a-popconfirm>
          </a-space>
        </div>
      </div>
    </a-card>

    <a-modal
      v-model:open="restartConfirmVisible"
      :title="$t('cache.restartConfirmTitle')"
      @ok="confirmRestart"
      :ok-text="$t('common.confirm')"
      :cancel-text="$t('common.cancel')"
      :width="400"
    >
      <div style="padding: 12px 0">
        <p v-if="!pendingRestartOptions.loginMode">
          {{ $t("cache.restartConfirmNormal") }}
        </p>
        <p v-else-if="pendingRestartOptions.workerName">
          {{ $t("cache.restartConfirmLogin") }}<br />
          <span style="color: #1890ff">
            {{ pendingRestartOptions.workerName }}
          </span>
        </p>
        <p v-else>{{ $t("cache.restartConfirmLogin") }}</p>
      </div>
    </a-modal>

    <a-modal
      v-model:open="restartModalVisible"
      :title="$t('cache.restarting')"
      :footer="null"
      :closable="false"
      :maskClosable="false"
      width="500px"
    >
      <div style="padding: 24px 0">
        <a-steps :current="currentStep" :items="restartSteps" />
        <div style="text-align: center; margin-top: 24px; color: #8c8c8c">
          {{ $t("cache.restartWait") }}
        </div>
      </div>
    </a-modal>

    <a-card
      :title="$t('cache.cacheMgmt')"
      :bordered="false"
      style="width: 100%"
    >
      <a-row :gutter="[16, 16]">
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
                  {{ $t("cache.clearCache") }}
                </div>
              </div>
              <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px">
                {{ $t("cache.clearCacheDescCN") }}
              </div>
            </div>
            <a-popconfirm
              :title="$t('cache.clearCacheConfirm')"
              :ok-text="$t('common.confirm')"
              :cancel-text="$t('common.cancel')"
              @confirm="handleClearCache"
            >
              <a-button type="primary" block>
                <template #icon>
                  <DeleteOutlined />
                </template>
                {{ $t("cache.clearCache") }}
              </a-button>
            </a-popconfirm>
          </a-card>
        </a-col>

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
                  {{ $t("cache.deleteInstanceFolders") }}
                </div>
              </div>
              <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px">
                {{ $t("cache.deleteInstanceDescCN") }}
              </div>
            </div>
            <a-button danger block @click="handleOpenInstanceDrawer">
              <template #icon>
                <FolderOutlined />
              </template>
              {{ $t("cache.manageInstances") }}
            </a-button>
          </a-card>
        </a-col>
      </a-row>
    </a-card>

    <a-drawer
      v-model:open="instanceDrawerOpen"
      :title="$t('cache.instanceMgmtTitle')"
      placement="right"
      width="500"
    >
      <div style="margin-bottom: 16px">
        <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 12px">
          {{ $t("cache.instanceMgmtDescCN") }}
        </div>

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
                    <div>{{ item.path }}</div>
                    <div>{{ item.instance }}</div>
                    <div>{{ item.size }}</div>
                  </div>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </div>

      <template #footer>
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
          "
        >
          <div style="font-size: 12px; color: #8c8c8c">
            {{ $t("cache.selectedFolders", { n: selectedFolders.length }) }}
          </div>
          <div>
            <a-button
              style="margin-right: 8px"
              @click="instanceDrawerOpen = false"
            >
              {{ $t("common.cancel") }}
            </a-button>
            <a-popconfirm
              placement="topRight"
              :ok-text="$t('cache.deleteSelected')"
              :cancel-text="$t('common.cancel')"
              @confirm="handleDeleteSelectedFolders"
            >
              <template #title>
                <div style="white-space: nowrap">
                  {{
                    $t("cache.confirmDeleteFolders", {
                      n: selectedFolders.length,
                    })
                  }}
                </div>
              </template>
              <a-button
                type="primary"
                danger
                :disabled="selectedFolders.length === 0"
              >
                {{ $t("cache.deleteSelected") }}
              </a-button>
            </a-popconfirm>
          </div>
        </div>
      </template>
    </a-drawer>
  </a-layout>
</template>
