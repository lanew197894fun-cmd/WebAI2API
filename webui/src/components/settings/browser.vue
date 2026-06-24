<script setup>
import { onMounted, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@/stores/settings";

const settingsStore = useSettingsStore();
const { t } = useI18n();

// 表單資料
const formData = reactive({
  path: "",
  headless: false,
  fission: true,
  humanizeCursor: false, // false | true | 'camou'
  // CSS 效能最佳化
  cssAnimation: false,
  cssFilter: false,
  cssFont: false,
  // 全域代理
  proxyEnable: false,
  proxyType: "http",
  proxyHost: "127.0.0.1",
  proxyPort: 7890,
  proxyAuth: false,
  proxyUser: "",
  proxyPasswd: "",
});

onMounted(async () => {
  await settingsStore.fetchBrowserConfig();
  const cfg = settingsStore.browserConfig || {};
  formData.path = cfg.path || "";
  formData.headless = cfg.headless || false;
  formData.fission = cfg.fission !== false; // 預設 true
  // humanizeCursor: false=停用, true=ghost-cursor, 'camou'=Camoufox內置
  formData.humanizeCursor = cfg.humanizeCursor ?? false;

  // CSS 效能最佳化
  if (cfg.cssInject) {
    formData.cssAnimation = cfg.cssInject.animation || false;
    formData.cssFilter = cfg.cssInject.filter || false;
    formData.cssFont = cfg.cssInject.font || false;
  }

  if (cfg.proxy) {
    formData.proxyEnable = cfg.proxy.enable || false;
    formData.proxyType = cfg.proxy.type || "http";
    formData.proxyHost = cfg.proxy.host || "";
    formData.proxyPort = cfg.proxy.port || 7890;
    formData.proxyAuth = cfg.proxy.auth || false;
    formData.proxyUser = cfg.proxy.username || "";
    formData.proxyPasswd = cfg.proxy.password || "";
  }
});

// 儲存設定
const handleSave = async () => {
  const config = {
    path: formData.path,
    headless: formData.headless,
    cssInject: {
      animation: formData.cssAnimation,
      filter: formData.cssFilter,
      font: formData.cssFont,
    },
    fission: formData.fission,
    humanizeCursor: formData.humanizeCursor,
    proxy: {
      enable: formData.proxyEnable,
      type: formData.proxyType,
      host: formData.proxyHost,
      port: formData.proxyPort,
      auth: formData.proxyAuth,
      username: formData.proxyUser,
      password: formData.proxyPasswd,
    },
  };
  await settingsStore.saveBrowserConfig(config);
};
</script>

<template>
  <a-layout style="background: transparent">
    <a-card :title="$t('browser.title')" :bordered="false" style="width: 100%">
      <a-row :gutter="[16, 16]">
        <!-- 瀏覽器可執行檔案路徑 -->
        <a-col :xs="24" :md="24">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              {{ $t("browser.browserPath") }}
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              {{ $t("browser.browserPath") }}
            </div>
            <a-input
              v-model:value="formData.path"
              :placeholder="$t('browser.browserPath')"
            />
          </div>
        </a-col>

        <!-- 無頭模式 -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              {{ $t("browser.headless") }}
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              {{ $t("browser.headless") }}
            </div>
            <a-switch v-model:checked="formData.headless" />
            <span style="margin-left: 8px">
              {{
                formData.headless ? $t("common.enable") : $t("common.disable")
              }}
            </span>
          </div>
        </a-col>

        <!-- 站點隔離 (Fission) -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              {{ $t("browser.fission") }}
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              {{ $t("browser.fission") }}
            </div>
            <a-switch v-model:checked="formData.fission" />
            <span style="margin-left: 8px">
              {{
                formData.fission ? $t("common.enable") : $t("common.disable")
              }}
            </span>
          </div>
        </a-col>

        <!-- 擬人鼠標軌跡 -->
        <a-col :xs="24" :md="24">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              {{ $t("browser.humanizeCursor") }}
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              {{ $t("browser.humanizeCursor") }}
            </div>
            <a-segmented
              v-model:value="formData.humanizeCursor"
              block
              :options="[
                { label: $t('browser.disabled'), value: false },
                { label: $t('browser.ghostCursor'), value: true },
                { label: $t('browser.camoufox'), value: 'camou' },
              ]"
            />
            <div style="font-size: 11px; color: #8c8c8c; margin-top: 6px">
              {{ $t("browser.humanizeCursor") }}
            </div>
          </div>
        </a-col>
      </a-row>

      <!-- 全域代理設定（折疊面板） -->
      <div style="margin-top: 16px">
        <a-collapse>
          <a-collapse-panel key="proxy" :header="$t('browser.proxy')">
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px">
              {{ $t("browser.proxy") }}
            </div>

            <!-- 是否啟用代理 -->
            <div style="margin-bottom: 16px">
              <a-switch v-model:checked="formData.proxyEnable" />
              <span style="margin-left: 8px">
                {{
                  formData.proxyEnable
                    ? $t("common.enable")
                    : $t("common.disable")
                }}
              </span>
            </div>

            <!-- 代理類型 -->
            <div style="margin-bottom: 16px" v-if="formData.proxyEnable">
              <div style="font-weight: 600; margin-bottom: 8px">
                {{ $t("browser.proxyType") }}
              </div>
              <a-segmented
                v-model:value="formData.proxyType"
                block
                :options="[
                  { label: 'HTTP', value: 'http' },
                  { label: 'SOCKS5', value: 'socks5' },
                ]"
              />
            </div>

            <a-row :gutter="16" v-if="formData.proxyEnable">
              <!-- 代理主機 -->
              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 16px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    {{ $t("browser.proxyHost") }}
                  </div>
                  <a-input
                    v-model:value="formData.proxyHost"
                    :placeholder="$t('browser.proxyHost')"
                  />
                </div>
              </a-col>

              <!-- 代理埠號 -->
              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 16px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    {{ $t("browser.proxyPort") }}
                  </div>
                  <a-input-number
                    v-model:value="formData.proxyPort"
                    :min="1"
                    :max="65535"
                    style="width: 100%"
                    :placeholder="$t('browser.proxyPort')"
                  />
                </div>
              </a-col>
            </a-row>

            <!-- 是否需要驗證 -->
            <div style="margin-bottom: 16px" v-if="formData.proxyEnable">
              <div style="font-weight: 600; margin-bottom: 8px">
                {{ $t("browser.proxyAuth") }}
              </div>
              <a-switch v-model:checked="formData.proxyAuth" />
              <span style="margin-left: 8px">
                {{ formData.proxyAuth ? $t("common.yes") : $t("common.no") }}
              </span>
            </div>

            <a-row
              :gutter="16"
              v-if="formData.proxyEnable && formData.proxyAuth"
            >
              <!-- 用户名 -->
              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 16px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    {{ $t("browser.proxyUser") }}
                  </div>
                  <a-input
                    v-model:value="formData.proxyUser"
                    :placeholder="$t('browser.proxyUser')"
                  />
                </div>
              </a-col>

              <!-- 密码 -->
              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 16px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    {{ $t("browser.proxyPass") }}
                  </div>
                  <a-input-password
                    v-model:value="formData.proxyPasswd"
                    :placeholder="$t('browser.proxyPass')"
                  />
                </div>
              </a-col>
            </a-row>
          </a-collapse-panel>

          <!-- CSS 性能优化 -->
          <a-collapse-panel
            key="cssInject"
            :header="$t('browser.cssOptimization')"
          >
            <a-alert
              :message="$t('browser.cssOptimization')"
              type="info"
              show-icon
              style="margin-bottom: 16px"
            />

            <!-- 禁用動畫 -->
            <div
              style="
                margin-bottom: 16px;
                padding: 12px;
                background: #fafafa;
                border-radius: 6px;
              "
            >
              <div
                style="
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                "
              >
                <div>
                  <div style="font-weight: 600; margin-bottom: 4px">
                    {{ $t("browser.cssAnimation") }}
                  </div>
                  <div style="font-size: 12px; color: #8c8c8c">
                    {{ $t("browser.cssAnimation") }}
                  </div>
                  <a-tag color="green" style="margin-top: 6px">{{
                    $t("common.enable")
                  }}</a-tag>
                </div>
                <a-switch v-model:checked="formData.cssAnimation" />
              </div>
            </div>

            <!-- 禁用濾鏡 -->
            <div
              style="
                margin-bottom: 16px;
                padding: 12px;
                background: #fafafa;
                border-radius: 6px;
              "
            >
              <div
                style="
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                "
              >
                <div>
                  <div style="font-weight: 600; margin-bottom: 4px">
                    {{ $t("browser.cssFilter") }}
                  </div>
                  <div style="font-size: 12px; color: #8c8c8c">
                    {{ $t("browser.cssFilter") }}
                  </div>
                  <a-tag color="orange" style="margin-top: 6px">{{
                    $t("common.disable")
                  }}</a-tag>
                </div>
                <a-switch v-model:checked="formData.cssFilter" />
              </div>
            </div>

            <!-- 降低字體渲染 -->
            <div
              style="
                padding: 12px;
                background: #fff2f0;
                border-radius: 6px;
                border: 1px solid #ffccc7;
              "
            >
              <div
                style="
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                "
              >
                <div>
                  <div style="font-weight: 600; margin-bottom: 4px">
                    {{ $t("browser.cssFont") }}
                  </div>
                  <div style="font-size: 12px; color: #8c8c8c">
                    {{ $t("browser.cssFont") }}
                  </div>
                  <a-tag color="red" style="margin-top: 6px"
                    >⚠️ {{ $t("common.disable") }}</a-tag
                  >
                </div>
                <a-switch v-model:checked="formData.cssFont" />
              </div>
            </div>
          </a-collapse-panel>
        </a-collapse>
      </div>

      <!-- 儲存按鈕（右下角） -->
      <div style="display: flex; justify-content: flex-end; margin-top: 24px">
        <a-button type="primary" @click="handleSave">
          {{ $t("common.saveSettings") }}
        </a-button>
      </div>
    </a-card>
  </a-layout>
</template>
