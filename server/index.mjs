/**
 * Unified Production Server for Star Belt Quotations + Fathy AI WhatsApp Agent.
 *
 * Runs on PORT (default 8000, matching Coolify):
 * - Serves the built Vite SPA (`dist/`) with gzip, immutable asset caching, and SPA fallback
 * - Receives Evolution API webhooks at `POST /api/fathy/webhook` (and `/webhook`, `/api/webhook`)
 * - Exposes Fathy AI health, webhook setup, and test endpoints under `/api/fathy/*`
 * - Proxies `/api/evolution/*` to Evolution API (gives the Quotation App a CORS-free send path)
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { getConfig, ROOT_DIR } from "./config.mjs";
import { EvolutionClient } from "./evolution.mjs";
import { ChatContextStore } from "./contextStore.mjs";
import { FathyAiClient } from "./aiClient.mjs";
import { FathyAgent } from "./fathyAgent.mjs";
import { escapeJsonForScript, QuotationPdfGenerator } from "./pdfGenerator.mjs";
import { FathySttClient } from "./sttClient.mjs";
import {
  buildQuotationFromDraft,
  buildQuotationShareUrl,
  saveQuotationToSupabaseServer,
} from "./quotationTool.mjs";

const DIST_DIR = path.join(ROOT_DIR, "dist");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

const COMPRESSIBLE_EXTS = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".svg",
  ".xml",
  ".txt",
  ".webmanifest",
]);

function readJsonBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function serveStaticFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const baseName = path.basename(filePath);

  let cacheControl = "public, max-age=3600";
  if (baseName === "index.html" || baseName === "sw.js") {
    cacheControl = "no-cache, no-store, must-revalidate";
  } else if (filePath.includes(`${path.sep}assets${path.sep}`) || ext === ".woff2") {
    cacheControl = "public, max-age=31536000, immutable";
  }

  fs.readFile(filePath, (err, buffer) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const acceptEncoding = String(req.headers["accept-encoding"] || "");
    const shouldGzip =
      COMPRESSIBLE_EXTS.has(ext) && buffer.length >= 256 && acceptEncoding.includes("gzip");

    if (shouldGzip) {
      zlib.gzip(buffer, (zErr, compressed) => {
        if (zErr) {
          res.writeHead(200, { "Content-Type": contentType, "Cache-Control": cacheControl });
          res.end(buffer);
          return;
        }
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Encoding": "gzip",
          Vary: "Accept-Encoding",
          "Cache-Control": cacheControl,
        });
        res.end(compressed);
      });
    } else {
      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": cacheControl });
      res.end(buffer);
    }
  });
}

export function createAppServer(customEnv = process.env) {
  const config = getConfig(customEnv);
  const evolution = new EvolutionClient({
    baseUrl: config.evolutionBaseUrl,
    apiKey: config.evolutionApiKey,
    instance: config.evolutionInstance,
  });
  const contextStore = new ChatContextStore({
    sessionTtlMs: config.sessionTtlMs,
    maxHistoryMessages: config.maxHistoryMessages,
    maxContextChars: config.maxContextChars,
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
  });
  const aiClient = new FathyAiClient(config.providers);
  const sttClient = new FathySttClient(config.stt);
  let activePort = config.port;
  const pdfGenerator = new QuotationPdfGenerator({
    getPort: () => activePort,
    env: customEnv,
  });
  const fathy = new FathyAgent({ config, evolution, contextStore, aiClient, pdfGenerator, sttClient });

  const server = http.createServer(async (req, res) => {
    const method = (req.method || "GET").toUpperCase();
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    // CORS preflight for API routes
    if (method === "OPTIONS" && pathname.startsWith("/api/")) {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      });
      res.end();
      return;
    }

    // ---- 1. Fathy AI Webhook (Evolution API MESSAGES_UPSERT) ----
    if (
      method === "POST" &&
      (pathname === "/api/fathy/webhook" ||
        pathname === "/api/webhook" ||
        pathname === "/webhook" ||
        pathname === "/webhook/evolution")
    ) {
      try {
        const payload = await readJsonBody(req);
        // Respond 200 immediately so Evolution API never times out, process async
        sendJson(res, 200, { ok: true, received: true });
        void fathy.handleWebhookPayload(payload).catch((err) => {
          console.error("[Fathy] Async webhook error:", err);
        });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // ---- 2. Fathy AI Health & Status ----
    if (
      method === "GET" &&
      (pathname === "/api/fathy/health" || pathname === "/api/health")
    ) {
      const summary = fathy.getHealthSummary();
      if (parsedUrl.searchParams.get("checkEvolution") === "1" && evolution.isConfigured()) {
        try {
          const state = await evolution.getConnectionState();
          const webhook = await evolution.findWebhook().catch(() => null);
          summary.evolution.connectionState = state;
          summary.evolution.remoteWebhook = webhook;
        } catch (err) {
          summary.evolution.connectionError = err instanceof Error ? err.message : String(err);
        }
      }
      sendJson(res, 200, summary);
      return;
    }

    // ---- 3. Register / Refresh Evolution Webhook ----
    if (method === "POST" && pathname === "/api/fathy/setup-webhook") {
      try {
        const body = await readJsonBody(req).catch(() => ({}));
        const targetUrl =
          typeof body.url === "string" && body.url.trim()
            ? body.url.trim()
            : config.webhookUrl;
        const result = await evolution.setWebhook(targetUrl);
        sendJson(res, 200, {
          ok: true,
          instance: config.evolutionInstance,
          webhookUrl: targetUrl,
          result,
        });
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // ---- 4. Direct AI Test Endpoint (for diagnostics / verification) ----
    if (method === "POST" && pathname === "/api/fathy/test") {
      try {
        const body = await readJsonBody(req);
        const prompt = String(body.message || "ازيك يا فتحي، عرّف نفسك في سطرين").trim();
        const history = Array.isArray(body.history)
          ? body.history
          : [{ role: "user", content: `[شريف رضا (صاحب الرقم 01208840531)]:\n${prompt}` }];
        const result = await aiClient.generateReply({
          messages: history,
          isGroup: Boolean(body.isGroup),
          remoteJid: String(body.remoteJid || `${config.ownerNumber}@s.whatsapp.net`),
        });
        sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // ---- 4b. SmartCycle In-App Quotation Draft Generator (POST /api/fathy/draft-quotation) ----
    if (method === "POST" && pathname === "/api/fathy/draft-quotation") {
      try {
        const body = await readJsonBody(req);
        const rawText = String(body.text || body.prompt || "").trim();
        if (!rawText) {
          sendJson(res, 400, { ok: false, error: "يرجى كتابة أو لصق تفاصيل الطلب أولاً." });
          return;
        }
        const quotationsSummary = await contextStore.getRecentQuotationsSummary();
        const aiDraft = await aiClient.generateQuotationDraft({
          prompt: rawText,
          quotationsSummary,
        });
        const { quotation, totals } = buildQuotationFromDraft(aiDraft.draft);

        let savedToSupabase = false;
        let saveError = undefined;
        if (body.saveToSupabase !== false) {
          const saveRes = await saveQuotationToSupabaseServer(quotation, {
            supabaseUrl: config.supabaseUrl,
            supabaseAnonKey: config.supabaseAnonKey,
          });
          savedToSupabase = saveRes.saved;
          if (saveRes.saved) {
            contextStore.quotationsCache = { fetchedAt: 0, summary: "" };
          } else {
            saveError = saveRes.error;
          }
        }

        const shareUrl = buildQuotationShareUrl(quotation.id, config.publicBaseUrl);
        fathy.stats.quotationsCreated++;

        sendJson(res, 200, {
          ok: true,
          quotation,
          totals,
          shareUrl,
          savedToSupabase,
          ...(saveError ? { saveError } : {}),
          provider: aiDraft.provider,
          model: aiDraft.model,
          latencyMs: aiDraft.latencyMs,
        });
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // ---- 4c. Direct Server-Side Vector A4 PDF Render (POST /api/fathy/render-pdf) ----
    if (method === "POST" && pathname === "/api/fathy/render-pdf") {
      try {
        const body = await readJsonBody(req);
        const { quotation } =
          body.quotation && typeof body.quotation === "object"
            ? { quotation: body.quotation }
            : buildQuotationFromDraft(body);
        const pdf = await pdfGenerator.renderQuotationToPdf(quotation);
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="starbelt-quotation.pdf"; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
          "Content-Length": String(pdf.byteLength),
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(pdf.buffer);
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // ---- 4d. Bilingual Voice-to-Text Endpoint (POST /api/fathy/transcribe) ----
    if (method === "POST" && pathname === "/api/fathy/transcribe") {
      try {
        const body = await readJsonBody(req, 25 * 1024 * 1024);
        const rawB64 = String(body.audioBase64 || body.audio || "").trim();
        if (!rawB64) {
          sendJson(res, 400, { ok: false, error: "لم يتم إرسال ملف صوتي." });
          return;
        }
        const cleanB64 = rawB64.includes(",") ? rawB64.split(",").pop() || "" : rawB64;
        const audioBuffer = Buffer.from(cleanB64, "base64");
        const mimetype = String(body.mimetype || "audio/webm").trim();
        const result = await sttClient.transcribeAudio(audioBuffer, { mimetype });
        fathy.stats.voiceNotesTranscribed++;
        sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        sendJson(res, 500, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // ---- 5. Evolution API Reverse Proxy for Quotation App (/api/evolution/*) ----
    if (pathname.startsWith("/api/evolution/")) {
      if (!evolution.isConfigured()) {
        sendJson(res, 503, { ok: false, error: "Evolution API is not configured on server" });
        return;
      }
      try {
        const subPath = pathname.slice("/api/evolution".length);
        const body = method === "POST" || method === "PUT" ? await readJsonBody(req, 25 * 1024 * 1024) : undefined;
        const upstream = await evolution.request(method, subPath, body, 45000);
        sendJson(res, 200, upstream);
      } catch (err) {
        sendJson(res, 502, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    // ---- 6. Static Vite SPA (dist/) with fallback to index.html ----
    if (method !== "GET" && method !== "HEAD") {
      sendJson(res, 404, { ok: false, error: "Route not found" });
      return;
    }

    // Loopback-only headless PDF render token injection (`GET /?renderToken=<token>`)
    const renderToken = parsedUrl.searchParams.get("renderToken");
    if (renderToken && (pathname === "/" || pathname === "/index.html")) {
      const remoteAddr = String(req.socket?.remoteAddress || "");
      const isLoopback =
        remoteAddr === "127.0.0.1" ||
        remoteAddr === "::1" ||
        remoteAddr === "::ffff:127.0.0.1";
      const renderQuotation = isLoopback ? pdfGenerator.getRenderToken(renderToken) : null;
      const indexPath = path.join(DIST_DIR, "index.html");
      if (renderQuotation && fs.existsSync(indexPath)) {
        const html = fs.readFileSync(indexPath, "utf8");
        const injectScript = `<script>window.__FATHY_PRINT_QUOTATION__=${escapeJsonForScript(renderQuotation)};</script>`;
        const injected = html.includes("</head>")
          ? html.replace("</head>", `${injectScript}</head>`)
          : `${injectScript}${html}`;
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(injected);
        return;
      }
    }

    const decodedPath = decodeURIComponent(pathname);
    const safeRel = path.normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, "");
    let candidate = path.join(DIST_DIR, safeRel === "/" ? "index.html" : safeRel);

    // Prevent path traversal outside dist/
    if (!candidate.startsWith(DIST_DIR)) {
      candidate = path.join(DIST_DIR, "index.html");
    }

    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      serveStaticFile(req, res, candidate);
      return;
    }

    // SPA fallback
    const indexPath = path.join(DIST_DIR, "index.html");
    if (fs.existsSync(indexPath)) {
      serveStaticFile(req, res, indexPath);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("App not built yet. Run npm run build first.");
  });

  server.on("listening", () => {
    const addr = server.address();
    if (addr && typeof addr === "object" && addr.port) {
      activePort = addr.port;
    }
  });

  return { server, config, evolution, contextStore, aiClient, pdfGenerator, sttClient, fathy };
}

// Start server when executed directly
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const { server, config, evolution } = createAppServer(process.env);
  server.listen(config.port, "0.0.0.0", () => {
    console.log(
      `[StarBelt + Fathy AI] Listening on http://0.0.0.0:${config.port}`,
    );
    console.log(
      `[Fathy AI] WhatsApp instance="${config.evolutionInstance}" owner=${config.ownerNumber} | AI routes=${config.providers.length} | webhook=${config.webhookUrl}`,
    );

    if (config.autoRegisterWebhook && evolution.isConfigured() && config.webhookUrl) {
      // Auto-register Evolution API webhook on startup (non-blocking)
      setTimeout(async () => {
        try {
          await evolution.setWebhook(config.webhookUrl);
          console.log(
            `[Fathy AI] Evolution webhook auto-configured -> ${config.webhookUrl}`,
          );
        } catch (err) {
          console.warn(
            `[Fathy AI] Auto webhook registration failed (can retry via POST /api/fathy/setup-webhook):`,
            err instanceof Error ? err.message : err,
          );
        }
      }, 3000);
    }
  });
}
