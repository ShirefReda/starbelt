import { render } from "preact";
import "./styles/fonts.css";
import "./styles/global.css";
import "./styles/sheet.css";
import "./styles/print.css";
import { App } from "./app";

document.body.classList.add("is-editing");
const root = document.getElementById("app");
if (root) render(<App />, root);

// Auto-recover from stale lazy-loaded chunk 404s after new deployments
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  const RELOAD_KEY = "sb.lastChunkReload";
  const lastReload = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  if (Date.now() - lastReload > 10000) {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.location.reload();
  }
});

// Register the service worker for offline use (production only).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        reg.update().catch(() => {});
      })
      .catch(() => {
        /* offline support is best-effort */
      });
  });
}
