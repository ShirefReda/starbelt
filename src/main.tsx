import { render } from "preact";
import "./styles/fonts.css";
import "./styles/global.css";
import "./styles/sheet.css";
import "./styles/print.css";
import { App } from "./app";

document.body.classList.add("is-editing");
const root = document.getElementById("app");
if (root) render(<App />, root);

// Register the service worker for offline use (production only).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch(() => {
      /* offline support is best-effort */
    });
  });
}
