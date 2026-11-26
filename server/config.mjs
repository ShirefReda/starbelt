import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");

/**
 * Load key=value pairs from .env file without overriding existing process.env
 * (so Coolify / systemd environment variables always take precedence).
 */
export function loadLocalEnv(envPath = path.join(ROOT_DIR, ".env")) {
  if (!fs.existsSync(envPath)) return;
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn("[Fathy] Failed to read local .env:", err instanceof Error ? err.message : err);
  }
}

loadLocalEnv();

function splitCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const DEFAULT_GROQ_MODELS = [
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
];
const DEFAULT_GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const DEFAULT_GATEWAY_MODEL = "gemini-3.8-flash-medium";

/**
 * Normalize Groq base URL so `https://api.groq.com`, `https://api.groq.com/openai`,
 * and `https://api.groq.com/openai/v1` all resolve cleanly to `https://api.groq.com/openai/v1`.
 */
export function normalizeGroqBaseUrl(rawUrl) {
  const cleaned = String(rawUrl || "https://api.groq.com/openai/v1")
    .trim()
    .replace(/\/+$/, "");
  if (!cleaned) return "https://api.groq.com/openai/v1";
  if (/\/v1$/i.test(cleaned)) return cleaned;
  if (/\/openai$/i.test(cleaned)) return `${cleaned}/v1`;
  return `${cleaned}/openai/v1`;
}

/**
 * Strictly verify that the private `agy` gateway URL is loopback-only
 * (`127.0.0.1`, `localhost`, or `[::1]`) per `agy-server-brief.md` Hard Rule #4.
 */
export function isLoopbackGatewayUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Build the prioritized AI route list:
 * 1. VERY TOP: Groq (`GROQ_API_KEY`, default #1 model `qwen/qwen3.8-27b`, sub-second inference)
 * 2. Official Google Gemini API (`GEMINI_API_KEY`) — optional fallback for cloud/multi-user
 * 3. Private single-user local `gemini-api/gateway.py` (`AGY_GATEWAY_URL` + `AGY_GATEWAY_TOKEN`),
 *    strictly loopback-only (`127.0.0.1`) for single-user personal operation.
 */
export function buildProviderChain(env = process.env) {
  const chain = [];
  const seen = new Set();

  const pushRoute = (provider, baseUrl, apiKey, model, defaultCooldownSec) => {
    if (!apiKey || !baseUrl || !model) return;
    const key = `${provider}:${model}`;
    if (seen.has(key)) return;
    seen.add(key);
    chain.push({ provider, baseUrl, apiKey, model, defaultCooldownSec });
  };

  // 1. VERY TOP: Groq (`qwen/qwen3.8-27b` first, then `openai/gpt-oss-120b`, `openai/gpt-oss-20b`)
  const groqKey = (env.GROQ_API_KEY || "").trim();
  const groqUrl = normalizeGroqBaseUrl(env.GROQ_BASE_URL || "https://api.groq.com/openai/v1");
  const groqModels =
    splitCsv(env.GROQ_MODELS).length > 0 ? splitCsv(env.GROQ_MODELS) : DEFAULT_GROQ_MODELS;

  if (groqKey) {
    for (const model of groqModels) {
      pushRoute("groq", groqUrl, groqKey, model, 20);
    }
  }

  // 2. Official Google Gemini API (AI Studio / Vertex OpenAI-compatible endpoint)
  const geminiKey = (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
  const geminiUrl = (
    env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai"
  )
    .trim()
    .replace(/\/+$/, "");
  const geminiModels =
    splitCsv(env.GEMINI_MODELS).length > 0 ? splitCsv(env.GEMINI_MODELS) : DEFAULT_GEMINI_MODELS;

  if (geminiKey) {
    for (const model of geminiModels) {
      pushRoute("gemini", geminiUrl, geminiKey, model, 20);
    }
  }

  // 3. Private local single-user Gemini gateway (`gemini-api/gateway.py` on 127.0.0.1)
  const gatewayToken = (
    env.AGY_GATEWAY_TOKEN ||
    env.GEMINI_GATEWAY_TOKEN ||
    env.GATEWAY_TOKEN ||
    ""
  ).trim();
  const gatewayUrl = (
    env.AGY_GATEWAY_URL ||
    env.GEMINI_GATEWAY_URL ||
    (gatewayToken ? "http://127.0.0.1:8787" : "")
  )
    .trim()
    .replace(/\/+$/, "");
  const gatewayModel = (
    env.AGY_GATEWAY_MODEL ||
    env.AGY_MODEL ||
    DEFAULT_GATEWAY_MODEL
  ).trim();

  if (gatewayToken && gatewayUrl) {
    if (isLoopbackGatewayUrl(gatewayUrl)) {
      pushRoute("gemini-gateway", gatewayUrl, gatewayToken, gatewayModel, 10);
    } else {
      console.warn(
        `[Fathy] Ignoring non-loopback AGY_GATEWAY_URL ("${gatewayUrl}"). Private agy gateway must bind to 127.0.0.1 only; use GROQ_API_KEY or GEMINI_API_KEY for public/cloud deployments.`,
      );
    }
  }

  return chain;
}

export function getConfig(env = process.env) {
  const port = Number.parseInt(env.PORT || "8000", 10) || 8000;
  const evolutionBaseUrl = (
    env.EVOLUTION_BASE_URL ||
    env.VITE_EVOLUTION_BASE_URL ||
    "https://wa.starbelt.com.eg"
  )
    .trim()
    .replace(/\/+$/, "");
  const evolutionApiKey = (
    env.STARBELT_API_KEY ||
    env.VITE_STARBELT_API_KEY ||
    env.EVOLUTION_API_KEY ||
    ""
  ).trim();
  const evolutionInstance = (
    env.STARBELT_INSTANCE ||
    env.VITE_STARBELT_INSTANCE ||
    "starbelt"
  ).trim();
  const ownerNumber = (env.FATHY_OWNER_NUMBER || env.STARBELT_SENDER || "201208840531")
    .trim()
    .replace(/^\+/, "");
  const publicBaseUrl = (
    env.APP_PUBLIC_URL ||
    env.COOLIFY_URL ||
    "https://maker.starbelt.com.eg"
  )
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");
  const webhookUrl = (
    env.FATHY_WEBHOOK_URL || `${publicBaseUrl}/api/fathy/webhook`
  ).trim();
  const autoRegisterWebhook = (env.FATHY_AUTO_WEBHOOK || "true").toLowerCase() !== "false";
  const sessionTtlMinutes = Number.parseFloat(env.FATHY_SESSION_TTL_MINUTES || "15") || 15;
  const maxHistoryMessages = Number.parseInt(env.FATHY_MAX_HISTORY_MESSAGES || "150", 10) || 150;
  const maxContextChars = Number.parseInt(env.FATHY_MAX_CONTEXT_CHARS || "60000", 10) || 60000;
  const supabaseUrl = (
    env.SUPABASE_URL ||
    env.VITE_SUPABASE_URL ||
    "https://xzbjxhuvjbiucbtjwpbv.supabase.co"
  )
    .trim()
    .replace(/\/+$/, "");
  const supabaseAnonKey = (
    env.SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_ANON_KEY ||
    "sb_publishable_QRmU1-08UfRJaAbmiAXCgw_Xvwmd86K"
  ).trim();

  return {
    port,
    evolutionBaseUrl,
    evolutionApiKey,
    evolutionInstance,
    ownerNumber,
    publicBaseUrl,
    webhookUrl,
    autoRegisterWebhook,
    sessionTtlMs: sessionTtlMinutes * 60 * 1000,
    maxHistoryMessages,
    maxContextChars,
    supabaseUrl,
    supabaseAnonKey,
    providers: buildProviderChain(env),
  };
}
