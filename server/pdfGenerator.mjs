/**
 * Headless Chromium Vector A4 PDF Generator for Fathy AI.
 *
 * Renders the EXACT live Star Belt Quotation App A4 sheet (`dist/index.html` +
 * `sheet.css` + `print.css` + Tajawal/Amiri `.woff2` fonts + SVG logo + watermark)
 * via loopback-only one-time render tokens so every PDF Fathy sends on WhatsApp
 * is 100% pixel-identical to clicking "تحميل PDF" inside the web app.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CHROMIUM_CANDIDATES = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
];

/**
 * Locate an installed Chromium / Chrome binary on Linux (Alpine Docker or Debian/Ubuntu host).
 */
export function findChromiumBinary(env = process.env) {
  const fromEnv = (env.CHROMIUM_PATH || env.CHROME_BIN || env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Build the Arabic PDF file name matching `quotationFileName()` in `src/state/actions.ts`.
 */
export function buildPdfFileName(quotation) {
  const client = String(quotation?.client || "")
    .replace(/[\\/:*?"<>|\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let isoDate;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value || String(new Date().getFullYear());
    const m = parts.find((p) => p.type === "month")?.value || "01";
    const d = parts.find((p) => p.type === "day")?.value || "01";
    isoDate = `${y}-${m}-${d}`;
  } catch {
    isoDate = new Date().toISOString().slice(0, 10);
  }
  return client ? `عرض سعر - ${client} - ${isoDate}.pdf` : `عرض سعر - ${isoDate}.pdf`;
}

/**
 * Serialize JSON safely for embedding inside an HTML `<script>` tag.
 */
export function escapeJsonForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export class QuotationPdfGenerator {
  constructor({ getPort, env = process.env } = {}) {
    this.getPort = typeof getPort === "function" ? getPort : () => 8000;
    this.chromiumPath = findChromiumBinary(env);
    /** @type {Map<string, { quotation: any, expiresAt: number }>} */
    this.renderTokens = new Map();
    /** Serialize headless Chromium runs to keep memory low in small Coolify containers */
    this.renderQueue = Promise.resolve();
  }

  isAvailable() {
    if (this.chromiumPath && fs.existsSync(this.chromiumPath)) return true;
    this.chromiumPath = findChromiumBinary();
    return Boolean(this.chromiumPath);
  }

  registerRenderToken(quotation, ttlMs = 60_000) {
    this.pruneExpiredTokens();
    const token = crypto.randomBytes(16).toString("hex");
    this.renderTokens.set(token, { quotation, expiresAt: Date.now() + ttlMs });
    return token;
  }

  getRenderToken(token) {
    if (!token) return null;
    const entry = this.renderTokens.get(token);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.renderTokens.delete(token);
      return null;
    }
    return entry.quotation;
  }

  deleteRenderToken(token) {
    if (token) this.renderTokens.delete(token);
  }

  pruneExpiredTokens() {
    const now = Date.now();
    for (const [key, entry] of this.renderTokens.entries()) {
      if (now > entry.expiresAt) {
        this.renderTokens.delete(key);
      }
    }
  }

  /**
   * Render a Star Belt Quotation to a crisp vector A4 PDF buffer using headless Chromium.
   */
  renderQuotationToPdf(quotation) {
    const run = this.renderQueue
      .catch(() => {})
      .then(() => this._renderOnce(quotation));
    this.renderQueue = run.catch(() => {});
    return run;
  }

  async _renderOnce(quotation) {
    if (!this.isAvailable()) {
      throw new Error("Chromium binary not found on server (install chromium or set CHROMIUM_PATH)");
    }

    const port = this.getPort();
    if (!port) {
      throw new Error("Server port unavailable for PDF rendering");
    }

    const token = this.registerRenderToken(quotation, 60_000);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "starbelt-pdf-"));
    const outPdfPath = path.join(tmpDir, "quotation.pdf");
    const targetUrl = `http://127.0.0.1:${port}/?renderToken=${encodeURIComponent(token)}`;
    const startedAt = Date.now();

    try {
      const args = [
        "--headless=new",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-pdf-header-footer",
        "--virtual-time-budget=3500",
        `--print-to-pdf=${outPdfPath}`,
        targetUrl,
      ];

      await execFileAsync(this.chromiumPath, args, {
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      });

      if (!fs.existsSync(outPdfPath)) {
        throw new Error("Chromium finished without creating PDF output file");
      }

      const buffer = fs.readFileSync(outPdfPath);
      if (buffer.length < 1000 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error(`Invalid PDF buffer produced (${buffer.length} bytes)`);
      }

      return {
        buffer,
        base64: buffer.toString("base64"),
        fileName: buildPdfFileName(quotation),
        byteLength: buffer.length,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      this.deleteRenderToken(token);
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  }
}
