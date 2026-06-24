import { createApp } from "vue";
import { createPinia } from "pinia";
import Antd from "ant-design-vue";
import { createRouter, createWebHistory } from "vue-router";
import { createI18n } from "vue-i18n";
import App from "./App.vue";
import "ant-design-vue/dist/reset.css";

import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";

const routes = [
  { path: "/", component: () => import("@/components/dash.vue") },
  {
    path: "/settings/server",
    component: () => import("@/components/settings/server.vue"),
  },
  {
    path: "/settings/workers",
    component: () => import("@/components/settings/workers.vue"),
  },
  {
    path: "/settings/browser",
    component: () => import("@/components/settings/browser.vue"),
  },
  {
    path: "/settings/adapters",
    component: () => import("@/components/settings/adapters.vue"),
  },
  {
    path: "/tools/display",
    component: () => import("@/components/tools/display.vue"),
  },
  {
    path: "/tools/cache",
    component: () => import("@/components/tools/cache.vue"),
  },
  {
    path: "/tools/logs",
    component: () => import("@/components/tools/logs.vue"),
  },
  {
    path: "/tools/request",
    component: () => import("@/components/tools/request.vue"),
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

const pinia = createPinia();

const i18n = createI18n({
  locale: localStorage.getItem("webui_locale") || "zh-TW",
  fallbackLocale: "en",
  legacy: false,
  globalInjection: true,
  messages: { en, "zh-CN": zhCN, "zh-TW": zhTW },
});

const app = createApp(App);
app.use(pinia);
app.use(router);
app.use(Antd);
app.use(i18n);
app.mount("#app");

// 全域暴露 i18n 給非元件使用
export default i18n;
