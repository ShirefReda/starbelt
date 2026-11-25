import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");

/**
 * Load key=value pairs from .env file without overriding existing process.env
 * (so Coolify environment variables always take precedence).
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

const DEFAULT_UNOROUTER_MODELS = [
  "gemini-3.6-flash:free",
  "gpt-4o:free",
  "gpt-6-luna:free",
  "mistral-small:free",
  "nemotron-3-ultra-550b-a55b:free",
  "deepseek-v4.1-flash:free",
  "llama-3.1-8b:free",
  "qwen2.5-coder-32b:free",
  "minimax-m3.1-flash:free",
  "glm-5.3-flash:free",
  "gemma-4-31b-it:free",
];

const DEFAULT_LOGFARE_MODELS = [
  "deepseek-v4.1-flash",
  "openai/gpt-6-luna",
  "logfare/auto",
  "qwen-3.8-27b",
  "tencent/hy4",
  "minimax-m3.1-flash",
  "grok-4.7",
  "kimi-k3.1-pro",
  "glm-5.3-flash",
];

/**
 * Build an interleaved multi-provider AI route list.
 * Interleaving UnoRouter (1 req/min per free model, 1M context Gemini/Luna/GPT-4o)
 * with Logfare (40 req/min Premium, GPT-6 Luna / DeepSeek / Step-5) ensures instant
 * responses even during rapid back-to-back WhatsApp conversations.
 */
export function buildProviderChain(env = process.env) {
  const unorouterKey = (env.UNOROUTER_API_KEY || "").trim();
  const unorouterUrl = (env.UNOROUTER_BASE_URL || "https://api.unorouter.com/v1")
    .trim()
    .replace(/\/+$/, "");

  const logfareKey = (env.LOGFARE_API_KEY || "").trim();
  const logfareUrl = (env.LOGFARE_BASE_URL || "https://logfare.ai/v1")
    .trim()
    .replace(/\/+$/, "");

  const genericKey = (env.OPENAI_API_KEY || env.AI_API_KEY || "").trim();
  const genericUrl = (env.OPENAI_BASE_URL || env.AI_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");

  const unorouterModels =
    splitCsv(env.UNOROUTER_MODELS || env.TOP_10_FREE_MODELS).length > 0
      ? splitCsv(env.UNOROUTER_MODELS || env.TOP_10_FREE_MODELS)
      : DEFAULT_UNOROUTER_MODELS;

  const logfareModels =
    splitCsv(env.LOGFARE_MODELS).length > 0
      ? splitCsv(env.LOGFARE_MODELS)
      : [
          ...(env.LOGFARE_PRIMARY_MODEL ? [env.LOGFARE_PRIMARY_MODEL.trim()] : []),
          ...splitCsv(env.LOGFARE_FALLBACK_MODELS),
        ].filter(Boolean);

  const effectiveLogfareModels =
    logfareModels.length > 0 ? Array.from(new Set(logfareModels)) : DEFAULT_LOGFARE_MODELS;

  const chain = [];
  const seen = new Set();

  const pushRoute = (provider, baseUrl, apiKey, model, defaultCooldownSec) => {
    if (!apiKey || !baseUrl || !model) return;
    const key = `${provider}:${model}`;
    if (seen.has(key)) return;
    seen.add(key);
    chain.push({ provider, baseUrl, apiKey, model, defaultCooldownSec });
  };

  // Interleave UnoRouter (ultra-fast 2-4s non-reasoning models) with Logfare (Premium 40 req/min reasoning models)
  // Parallel racing in aiClient pairs 1 UnoRouter + 1 Logfare route simultaneously so the fastest responder wins!
  const maxLen = Math.max(unorouterModels.length, effectiveLogfareModels.length);
  for (let i = 0; i < maxLen; i++) {
    if (unorouterKey && unorouterModels[i]) {
      pushRoute("unorouter", unorouterUrl, unorouterKey, unorouterModels[i], 65);
    }
    if (logfareKey && effectiveLogfareModels[i]) {
      pushRoute("logfare", logfareUrl, logfareKey, effectiveLogfareModels[i], 20);
    }
  }

  // Fallback to generic OPENAI_API_KEY / AI_API_KEY if neither dedicated key was configured
  if (chain.length === 0 && genericKey && genericUrl) {
    const isLogfareGeneric = genericUrl.toLowerCase().includes("logfare.ai");
    const explicitModels = splitCsv(
      env.MODEL_FALLBACK_CHAIN || env.FALLBACK_MODELS || env.AI_MODEL_PRIMARY,
    );
    const genericModels =
      explicitModels.length > 0
        ? explicitModels
        : isLogfareGeneric
          ? DEFAULT_LOGFARE_MODELS
          : [env.PRIMARY_MODEL || env.MODEL || "gemini-3.6-flash:free"];
    for (const model of genericModels) {
      pushRoute(isLogfareGeneric ? "logfare" : "openai-compat", genericUrl, genericKey, model, 30);
    }
  }

  return chain;
}

export function getConfig(env = process.env) {
  const port = Number.parseInt(env.PORT || "8000", 10) || 8000;
  const evolutionBaseUrl = (
    env.EVOLUTION_BASE_URL ||
    env.VITE_EVOLUTION_BASE_URL ||
    "https://wa.lahza.eu.cc"
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
