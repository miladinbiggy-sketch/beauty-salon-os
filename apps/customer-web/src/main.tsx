import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { LocaleProvider } from "./lib/i18n";
import { App } from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("root element missing");

createRoot(rootEl).render(
  <StrictMode>
    <LocaleProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </LocaleProvider>
  </StrictMode>,
);

// 生产环境注册 Service Worker（PWA app shell 缓存）
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* 注册失败不影响使用 */
    });
  });
}
