/**
 * Client for the Evolution API — same envelope starbelt-main uses for
 * POST /message/sendMedia/{instance}: { number, mediatype, caption, media (base64), fileName }.
 *
 * Two modes:
 *  - Direct mode: Vite env defines VITE_EVOLUTION_BASE_URL / STARBELT_API_KEY / STARBELT_INSTANCE.
 *    The browser calls Evolution directly (requires CORS on the Evolution server).
 *  - Proxy mode: the quotation app is served by Coolify behind a Vite proxy or nginx rewrite
 *    /api/evolution -> {EVOLUTION_BASE_URL}. Kept for the common Coolify layout.
 */

export interface EvolutionConfig {
  baseUrl: string; // e.g. https://wa.lahza.eu.cc
  apiKey: string;
  instance: string; // e.g. starbelt
}

function envConfig(): EvolutionConfig | null {
  const baseUrl = (import.meta.env.VITE_EVOLUTION_BASE_URL as string | undefined)?.trim().replace(/\/$/, "") ?? "";
  const apiKey = (import.meta.env.VITE_STARBELT_API_KEY as string | undefined)?.trim() ?? "";
  const instance = (import.meta.env.VITE_STARBELT_INSTANCE as string | undefined)?.trim() ?? "starbelt";
  if (baseUrl && apiKey) return { baseUrl, apiKey, instance };
  return null;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let data: unknown = raw;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    // keep raw
  }
  if (!res.ok) {
    const msg = typeof data === "object" && data !== null && "message" in (data as Record<string, unknown>)
      ? String((data as Record<string, unknown>).message)
      : raw.slice(0, 400);
    throw new Error(msg || `Evolution ${res.status}`);
  }
  return data;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = String(reader.result ?? "");
      const b64 = dataUri.includes(",") ? dataUri.split(",").pop() ?? "" : dataUri;
      resolve(b64);
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Send the quotation blob as a document to one WhatsApp number.
 *
 * Mirrors starbelt-main's /api/send path + POST /message/sendMedia/{instance}
 * payload — same field names and same "no data-uri prefix" convention.
 */
export async function sendQuotationMedia(params: {
  normalizedNumber: string; // 20...
  blob: Blob;
  fileName: string;
  mimetype: string;
  caption: string;
  config: EvolutionConfig;
}): Promise<unknown> {
  const { normalizedNumber, blob, fileName, mimetype, caption, config } = params;
  const media = await blobToBase64(blob);

  // Try direct Evolution first; if that fails with a network/CORS error, fall
  // back to the proxied endpoint /api/evolution which some Coolify layouts expose.
  const payload = {
    number: normalizedNumber,
    mediatype: "document",
    mimetype,
    media,
    fileName,
    caption,
  };
  const path = `/message/sendMedia/${encodeURIComponent(config.instance)}`;
  const headers: Record<string, string> = { apikey: config.apiKey };

  try {
    return await postJson(`${config.baseUrl}${path}`, headers, payload);
  } catch (err) {
    if (config.baseUrl === envConfig()?.baseUrl) {
      try {
        return await postJson(`/api/evolution${path}`, headers, payload);
      } catch {
        throw err;
      }
    }
    throw err;
  }
}

export function resolveEvolutionConfig(): EvolutionConfig | null {
  const cfg = envConfig();
  if (cfg) return cfg;
  // Also accept Coolify-injected build args surfaced as Vite define (some setups set them at build time
  // into window.__EVOLUTION__). Keep this as a placeholder — no runtime secret leak.
  try {
    const win = (typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : {}) as Record<
      string,
      unknown
    >;
    const baseUrl =
      (typeof win.__EVOLUTION_BASE_URL === "string" ? String(win.__EVOLUTION_BASE_URL) : "") ??
      "".replace(/\/$/, "");
    const apiKey = typeof win.__STARBELT_API_KEY === "string" ? String(win.__STARBELT_API_KEY) : "";
    const instance = typeof win.__STARBELT_INSTANCE === "string" ? String(win.__STARBELT_INSTANCE) : "starbelt";
    if (baseUrl && apiKey) return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, instance: instance || "starbelt" };
  } catch {
    // ignore
  }
  return null;
}
