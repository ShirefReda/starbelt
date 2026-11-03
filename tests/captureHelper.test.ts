// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { prepareClonedDocForCapture } from "../src/utils/captureHelper";
import { STARBELT_LOGO_DATA_URI } from "../src/config/logoFallback";

describe("Capture Helper & Mobile Logo Reliability", () => {
  it("provides an embedded fallback data URI for offline safety", () => {
    expect(STARBELT_LOGO_DATA_URI).toBeTruthy();
    expect(STARBELT_LOGO_DATA_URI.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("replaces cloned img elements with canvas elements for synchronous render", () => {
    const liveDoc = document.implementation.createHTMLDocument("live");
    const liveContainer = liveDoc.createElement("div");
    liveContainer.className = "sheet-page";
    liveContainer.innerHTML = `
      <div class="logo-block">
        <img class="header-logo" src="assets/logo.svg" alt="logo" />
      </div>
      <div class="page-watermark">
        <img class="wm-logo" src="assets/logo.svg" alt="" />
      </div>
    `;
    liveDoc.body.appendChild(liveContainer);

    const clonedDoc = document.implementation.createHTMLDocument("cloned");
    clonedDoc.body.appendChild(liveContainer.cloneNode(true));

    expect(clonedDoc.querySelectorAll("img").length).toBe(2);
    expect(clonedDoc.querySelectorAll("canvas").length).toBe(0);

    // Call prepareClonedDocForCapture
    prepareClonedDocForCapture(clonedDoc, liveContainer, null);

    // Both img elements should be replaced by canvas elements
    const canvases = clonedDoc.querySelectorAll("canvas");
    expect(canvases.length).toBe(2);
    expect(clonedDoc.querySelectorAll("img").length).toBe(0);

    const logoCanvas = clonedDoc.querySelector(".logo-block canvas") as HTMLCanvasElement;
    expect(logoCanvas).toBeTruthy();
    expect(logoCanvas.width).toBe(2400);
    expect(logoCanvas.height).toBe(1392);
    expect(logoCanvas.style.height).toBe("24mm");

    const wmCanvas = clonedDoc.querySelector(".page-watermark canvas") as HTMLCanvasElement;
    expect(wmCanvas).toBeTruthy();
    expect(wmCanvas.width).toBe(2400);
    expect(wmCanvas.height).toBe(1392);
    expect(wmCanvas.style.opacity).toBe("0.08");
  });

  it("sets export mode classes on body and resets scale transform", () => {
    const clonedDoc = document.implementation.createHTMLDocument("cloned");
    const scaleEl = clonedDoc.createElement("div");
    scaleEl.className = "sheet-scale";
    scaleEl.style.transform = "scale(0.5)";
    clonedDoc.body.appendChild(scaleEl);
    clonedDoc.body.classList.add("is-editing");

    const liveEl = document.createElement("div");
    prepareClonedDocForCapture(clonedDoc, liveEl, null);

    expect(clonedDoc.body.classList.contains("is-exporting")).toBe(true);
    expect(clonedDoc.body.classList.contains("is-editing")).toBe(false);
    expect(scaleEl.style.transform).toBe("none");
  });
});
