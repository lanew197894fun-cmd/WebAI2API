<script setup>
import { onMounted, reactive } from "vue";
import { useSettingsStore } from "@/stores/settings";

const settingsStore = useSettingsStore();

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
    <a-card title="瀏覽器設定" :bordered="false" style="width: 100%">
      <a-row :gutter="[16, 16]">
        <!-- 瀏覽器可執行檔案路徑 -->
        <a-col :xs="24" :md="24">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              瀏覽器可執行檔案路徑
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              留空則使用 Camoufox 預設下載路徑<br />
              Windows示例: C:\camoufox\camoufox.exe<br />
              Linux示例: /opt/camoufox/camoufox
            </div>
            <a-input
              v-model:value="formData.path"
              placeholder="留空使用預設路徑"
            />
          </div>
        </a-col>

        <!-- 無頭模式 -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">無頭模式</div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              啟用後瀏覽器無介面化運行<br />
              登入模式和 Xvfb 模式會無視該設定強行禁用無頭模式
            </div>
            <a-switch v-model:checked="formData.headless" />
            <span style="margin-left: 8px">
              {{ formData.headless ? "已啟用" : "未啟用" }}
            </span>
          </div>
        </a-col>

        <!-- 站點隔離 (Fission) -->
        <a-col :xs="24" :md="12">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              站點隔離 (fission.autostart)
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              關閉可低記憶體佔用，適合低配伺服器<br />
              正常 FireFox 用戶是預設開啟的，請酌情關閉<br />
              <span style="color: #faad14"
                >⚠️
                反爬檢測可能通過檢測單進程或者跨進程延遲來識別自動化特徵</span
              >
            </div>
            <a-switch v-model:checked="formData.fission" />
            <span style="margin-left: 8px">
              {{ formData.fission ? "已啟用" : "已關閉 (省記憶體)" }}
            </span>
          </div>
        </a-col>

        <!-- 擬人鼠標軌跡 -->
        <a-col :xs="24" :md="24">
          <div style="margin-bottom: 8px">
            <div style="font-weight: 600; margin-bottom: 4px">
              擬人鼠標軌跡模式
            </div>
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 8px">
              控制鼠標點擊的擬人化程度，影響性能和反爬檢測風險
            </div>
            <a-segmented
              v-model:value="formData.humanizeCursor"
              block
              :options="[
                { label: '停用 (效能最佳)', value: false },
                { label: 'Ghost-Cursor (更擬人)', value: true },
                { label: 'Camoufox內置 (平衡)', value: 'camou' },
              ]"
            />
            <div style="font-size: 11px; color: #8c8c8c; margin-top: 6px">
              <span v-if="formData.humanizeCursor === false"
                >使用 Playwright 原生點擊，性能最好，但可能被檢測為自動化</span
              >
              <span v-else-if="formData.humanizeCursor === true"
                >使用專案優化的 ghost-cursor
                模擬人類鼠標軌跡（如不會點擊正中心），性能稍差</span
              >
              <span v-else
                >使用 Camoufox 內置的 humanize
                功能，性能與擬人化的平衡選擇</span
              >
            </div>
          </div>
        </a-col>
      </a-row>

      <!-- 全域代理設定（折疊面板） -->
      <div style="margin-top: 16px">
        <a-collapse>
          <a-collapse-panel key="proxy" header="全域代理設定">
            <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 16px">
              如果實例沒有獨立配置代理，將使用此全域代理配置
            </div>

            <!-- 是否啟用代理 -->
            <div style="margin-bottom: 16px">
              <a-switch v-model:checked="formData.proxyEnable" />
              <span style="margin-left: 8px">
                {{ formData.proxyEnable ? "已啟用全域代理" : "未啟用全域代理" }}
              </span>
            </div>

            <!-- 代理類型 -->
            <div style="margin-bottom: 16px" v-if="formData.proxyEnable">
              <div style="font-weight: 600; margin-bottom: 8px">代理類型</div>
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
                    代理主機
                  </div>
                  <a-input
                    v-model:value="formData.proxyHost"
                    placeholder="例如: 127.0.0.1"
                  />
                </div>
              </a-col>

              <!-- 代理埠號 -->
              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 16px">
                  <div style="font-weight: 600; margin-bottom: 8px">
                    代理埠號
                  </div>
                  <a-input-number
                    v-model:value="formData.proxyPort"
                    :min="1"
                    :max="65535"
                    style="width: 100%"
                    placeholder="例如: 7890"
                  />
                </div>
              </a-col>
            </a-row>

            <!-- 是否需要驗證 -->
            <div style="margin-bottom: 16px" v-if="formData.proxyEnable">
              <div style="font-weight: 600; margin-bottom: 8px">代理認證</div>
              <a-switch v-model:checked="formData.proxyAuth" />
              <span style="margin-left: 8px">
                {{ formData.proxyAuth ? "需要認證" : "無需認證" }}
              </span>
            </div>

            <a-row
              :gutter="16"
              v-if="formData.proxyEnable && formData.proxyAuth"
            >
              <!-- 用户名 -->
              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 16px">
                  <div style="font-weight: 600; margin-bottom: 8px">用户名</div>
                  <a-input
                    v-model:value="formData.proxyUser"
                    placeholder="請輸入用戶名"
                  />
                </div>
              </a-col>

              <!-- 密码 -->
              <a-col :xs="24" :md="12">
                <div style="margin-bottom: 16px">
                  <div style="font-weight: 600; margin-bottom: 8px">密码</div>
                  <a-input-password
                    v-model:value="formData.proxyPasswd"
                    placeholder="請輸入密碼"
                  />
                </div>
              </a-col>
            </a-row>
          </a-collapse-panel>

          <!-- CSS 性能优化 -->
          <a-collapse-panel key="cssInject" header="CSS 效能最佳化注入">
            <a-alert
              message="⚡ 適用於無 GPU 的伺服器環境，透過禁用網頁特效來降低 CPU 壓力"
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
                    禁用網頁動畫
                  </div>
                  <div style="font-size: 12px; color: #8c8c8c">
                    移除 transition 和 animation，顯著降低 CPU 持續佔用
                  </div>
                  <a-tag color="green" style="margin-top: 6px">風險：低</a-tag>
                  <span
                    style="font-size: 11px; color: #389e0d; margin-left: 8px"
                  >
                    幾乎不影響瀏覽器指紋，但可能導致部分網頁佈局異常
                  </span>
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
                    禁用濾鏡和陰影
                  </div>
                  <div style="font-size: 12px; color: #8c8c8c">
                    移除 blur(模糊)、box-shadow(陰影) 等複雜渲染
                  </div>
                  <a-tag color="orange" style="margin-top: 6px">風險：中</a-tag>
                  <span
                    style="font-size: 11px; color: #faad14; margin-left: 8px"
                  >
                    介面會變醜，少數反爬可能偵測樣式計算結果
                  </span>
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
                    降低字體渲染品質
                  </div>
                  <div style="font-size: 12px; color: #8c8c8c">
                    強制使用極速渲染模式，微量減少 CPU 繪圖壓力
                  </div>
                  <a-tag color="red" style="margin-top: 6px">⚠️ 風險：高</a-tag>
                  <div style="font-size: 11px; color: #cf1322; margin-top: 4px">
                    會導致文字邊緣有鋸齒，且可能導致字體指紋與標準瀏覽器不符，易被進階反爬識別
                  </div>
                </div>
                <a-switch v-model:checked="formData.cssFont" />
              </div>
            </div>
          </a-collapse-panel>
        </a-collapse>
      </div>

      <!-- 儲存按鈕（右下角） -->
      <div style="display: flex; justify-content: flex-end; margin-top: 24px">
        <a-button type="primary" @click="handleSave"> 儲存設定 </a-button>
      </div>
    </a-card>
  </a-layout>
</template>
