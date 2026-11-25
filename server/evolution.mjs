/**
 * Evolution API v2 client for Fathy AI (WhatsApp instance: starbelt / 201208840531).
 * Uses browser-like User-Agent to avoid Cloudflare 1010 blocks on wa.lahza.eu.cc.
 */

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class EvolutionClient {
  constructor({ baseUrl, apiKey, instance }) {
    this.baseUrl = (baseUrl || "").replace(/\/+$/, "");
    this.apiKey = apiKey || "";
    this.instance = instance || "starbelt";
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.apiKey && this.instance);
  }

  async request(method, path, body = undefined, timeoutMs = 20000) {
    if (!this.isConfigured()) {
      throw new Error("Evolution API is not configured (missing EVOLUTION_BASE_URL or STARBELT_API_KEY)");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers = {
        Accept: "application/json",
        "User-Agent": DEFAULT_USER_AGENT,
        apikey: this.apiKey,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const raw = await res.text();
      let data = raw;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        // keep raw text
      }

      if (!res.ok) {
        const msg =
          typeof data === "object" && data !== null && "message" in data
            ? JSON.stringify(data.message)
            : String(raw).slice(0, 300);
        throw new Error(`Evolution ${method} ${path} failed (${res.status}): ${msg}`);
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Check WhatsApp instance connection state ("open", "connecting", "close").
   */
  async getConnectionState() {
    const inst = encodeURIComponent(this.instance);
    return this.request("GET", `/instance/connectionState/${inst}`);
  }

  /**
   * Send "composing" (typing...) presence indicator so the user knows Fathy is immediately working.
   */
  async sendTyping(remoteJid, delayMs = 4000) {
    try {
      const inst = encodeURIComponent(this.instance);
      await this.request(
        "POST",
        `/chat/sendPresence/${inst}`,
        {
          number: remoteJid,
          delay: delayMs,
          presence: "composing",
        },
        8000,
      );
    } catch {
      // Non-critical: typing indicator failure must never block reply sending
    }
  }

  /**
   * Send a WhatsApp text message to a DM JID, LID, phone number, or Group JID.
   * Returns the sent message ID if available.
   */
  async sendText(remoteJid, text, quotedKey = null) {
    const inst = encodeURIComponent(this.instance);
    const payload = {
      number: remoteJid,
      text,
    };
    if (quotedKey && quotedKey.id) {
      payload.quoted = {
        key: {
          remoteJid: quotedKey.remoteJid || remoteJid,
          fromMe: Boolean(quotedKey.fromMe),
          id: quotedKey.id,
        },
      };
    }

    try {
      const res = await this.request("POST", `/message/sendText/${inst}`, payload, 25000);
      return {
        raw: res,
        messageId: res?.key?.id || res?.id || null,
      };
    } catch (err) {
      // Some Evolution builds reject `quoted` on certain JID types; retry cleanly without `quoted`
      if (payload.quoted) {
        delete payload.quoted;
        const res = await this.request("POST", `/message/sendText/${inst}`, payload, 25000);
        return {
          raw: res,
          messageId: res?.key?.id || res?.id || null,
        };
      }
      throw err;
    }
  }

  /**
   * Fetch FULL chat message history for a specific remoteJid from Evolution API v2.
   * Handles all Evolution v2 response shapes ({ messages: { records } }, { records }, or array).
   */
  async fetchChatHistory(remoteJid, maxMessages = 150) {
    if (!this.isConfigured() || !remoteJid) return [];
    const inst = encodeURIComponent(this.instance);
    const pageSize = Math.min(50, maxMessages);
    const maxPages = Math.max(1, Math.ceil(maxMessages / pageSize));
    const allRecords = [];

    for (let page = 1; page <= maxPages; page++) {
      try {
        const res = await this.request(
          "POST",
          `/chat/findMessages/${inst}`,
          {
            where: {
              key: {
                remoteJid,
              },
            },
            page,
            offset: pageSize,
          },
          15000,
        );

        let batch = [];
        if (Array.isArray(res)) {
          batch = res;
        } else if (Array.isArray(res?.messages?.records)) {
          batch = res.messages.records;
        } else if (Array.isArray(res?.records)) {
          batch = res.records;
        } else if (Array.isArray(res?.messages)) {
          batch = res.messages;
        }

        if (batch.length === 0) break;
        allRecords.push(...batch);

        if (batch.length < pageSize) break;
      } catch (err) {
        console.warn(
          `[Fathy] findMessages page ${page} for ${remoteJid} failed:`,
          err instanceof Error ? err.message : err,
        );
        break;
      }
    }

    return allRecords.slice(0, maxMessages);
  }

  /**
   * Inspect current webhook configuration for the instance.
   */
  async findWebhook() {
    const inst = encodeURIComponent(this.instance);
    return this.request("GET", `/webhook/find/${inst}`);
  }

  /**
   * Register / update Evolution API v2 webhook for MESSAGES_UPSERT so Fathy
   * receives every message in real time.
   */
  async setWebhook(webhookUrl) {
    const inst = encodeURIComponent(this.instance);
    const payload = {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        byEvents: false,
        webhookBase64: false,
        base64: false,
        events: ["MESSAGES_UPSERT"],
      },
    };
    return this.request("POST", `/webhook/set/${inst}`, payload, 15000);
  }
}
