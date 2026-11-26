/**
 * Chat context store & session manager for Fathy AI.
 *
 * Maintains:
 * 1. A passive rolling buffer of ALL WhatsApp messages per chat (even before Fathy is called)
 * 2. Live merging + deduplication with full Evolution API chat history
 * 3. Active conversation sessions per chat (with TTL so follow-ups respond immediately)
 * 4. Sent message ID registry (for strict self-loop prevention)
 * 5. Lightweight cached recent Star Belt quotations from Supabase
 */

import { extractMessageDetails, isFathyOwnMessage } from "./trigger.mjs";

const MAX_CHATS_IN_MEMORY = 500;
const MAX_SENT_IDS = 3000;
const MAX_PROCESSED_IDS = 3000;

function toUnixSeconds(ts) {
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
  }
  if (typeof ts === "string" && /^\d+$/.test(ts)) {
    const n = Number(ts);
    return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  }
  if (ts && typeof ts === "object" && typeof ts.low === "number") {
    return ts.low;
  }
  return Math.floor(Date.now() / 1000);
}

/**
 * Convert a raw Evolution API message record into a clean normalized entry.
 * @param {any} raw
 * @param {Set<string> | null} [sentMessageIds]
 */
export function normalizeMessageRecord(raw, sentMessageIds = null) {
  if (!raw || typeof raw !== "object") return null;

  const key = raw.key || {};
  const remoteJid = key.remoteJid || raw.remoteJid || "";
  const remoteJidAlt = key.remoteJidAlt || raw.remoteJidAlt || "";
  const id = key.id || raw.id || "";
  const fromMe = Boolean(key.fromMe ?? raw.fromMe);
  const participant = key.participant || raw.participant || "";
  const pushName = (raw.pushName || raw.notify || "").trim();
  const timestamp = toUnixSeconds(raw.messageTimestamp ?? raw.timestamp);

  const details = extractMessageDetails(raw);
  if (!details.text) return null;

  const isFathy = fromMe && isFathyOwnMessage(details.text, id, sentMessageIds);

  return {
    id: id || `${remoteJid}:${timestamp}:${details.text.slice(0, 24)}`,
    remoteJid,
    remoteJidAlt,
    fromMe,
    isFathy,
    participant,
    pushName,
    timestamp,
    text: details.text,
    quotedText: details.quotedText,
    quotedIsFathy: details.quotedIsFathy,
    mediaType: details.mediaType,
  };
}

function formatCairoTime(unixSeconds) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(unixSeconds * 1000));
  } catch {
    return "";
  }
}

export class ChatContextStore {
  constructor({
    sessionTtlMs = 15 * 60 * 1000,
    maxHistoryMessages = 150,
    maxContextChars = 60000,
    supabaseUrl = "",
    supabaseAnonKey = "",
  } = {}) {
    this.sessionTtlMs = sessionTtlMs;
    this.maxHistoryMessages = maxHistoryMessages;
    this.maxContextChars = maxContextChars;
    this.supabaseUrl = supabaseUrl;
    this.supabaseAnonKey = supabaseAnonKey;

    /** @type {Map<string, Array<ReturnType<typeof normalizeMessageRecord>>>} */
    this.buffers = new Map();
    /** @type {Map<string, { activatedAt: number, lastActiveAt: number, activatedBy: string }>} */
    this.sessions = new Map();
    /** @type {Set<string>} */
    this.sentMessageIds = new Set();
    /** @type {Set<string>} */
    this.processedWebhookIds = new Set();
    /** @type {{ fetchedAt: number, summary: string }} */
    this.quotationsCache = { fetchedAt: 0, summary: "" };
  }

  markSentByFathy(messageId) {
    if (!messageId) return;
    this.sentMessageIds.add(messageId);
    if (this.sentMessageIds.size > MAX_SENT_IDS) {
      const oldest = this.sentMessageIds.values().next().value;
      if (oldest) this.sentMessageIds.delete(oldest);
    }
  }

  isDuplicateWebhook(messageId) {
    if (!messageId) return false;
    if (this.processedWebhookIds.has(messageId)) return true;
    this.processedWebhookIds.add(messageId);
    if (this.processedWebhookIds.size > MAX_PROCESSED_IDS) {
      const oldest = this.processedWebhookIds.values().next().value;
      if (oldest) this.processedWebhookIds.delete(oldest);
    }
    return false;
  }

  /**
   * Passively record any message into the chat's rolling buffer so Fathy always has live context.
   */
  recordMessage(normalizedMsg) {
    if (!normalizedMsg || !normalizedMsg.remoteJid) return;
    const jid = normalizedMsg.remoteJid;

    if (!this.buffers.has(jid)) {
      if (this.buffers.size >= MAX_CHATS_IN_MEMORY) {
        const oldestKey = this.buffers.keys().next().value;
        if (oldestKey) this.buffers.delete(oldestKey);
      }
      this.buffers.set(jid, []);
    }

    const list = this.buffers.get(jid);
    if (!list.some((m) => m.id === normalizedMsg.id)) {
      list.push(normalizedMsg);
      if (list.length > this.maxHistoryMessages) {
        list.splice(0, list.length - this.maxHistoryMessages);
      }
    }
  }

  activateSession(remoteJid, activatedBy = "") {
    const now = Date.now();
    const existing = this.sessions.get(remoteJid);
    this.sessions.set(remoteJid, {
      activatedAt: existing?.activatedAt || now,
      lastActiveAt: now,
      activatedBy: activatedBy || existing?.activatedBy || "",
    });
  }

  deactivateSession(remoteJid) {
    this.sessions.delete(remoteJid);
  }

  isSessionActive(remoteJid) {
    const session = this.sessions.get(remoteJid);
    if (!session) return false;
    if (Date.now() - session.lastActiveAt > this.sessionTtlMs) {
      this.sessions.delete(remoteJid);
      return false;
    }
    return true;
  }

  getActiveSessionCount() {
    const now = Date.now();
    let count = 0;
    for (const [jid, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt <= this.sessionTtlMs) {
        count++;
      } else {
        this.sessions.delete(jid);
      }
    }
    return count;
  }

  /**
   * Merge live Evolution API history + passive in-memory buffer, deduplicate,
   * sort chronologically, and return the full conversation history.
   * Accepts messages matching either remoteJid or remoteJidAlt (for WhatsApp @lid chats).
   * @param {string} remoteJid
   * @param {any[]} [evolutionRawRecords]
   * @param {any} [latestMsg]
   * @param {string} [remoteJidAlt]
   */
  mergeHistory(remoteJid, evolutionRawRecords = [], latestMsg = null, remoteJidAlt = "") {
    const allowedJids = new Set([remoteJid, remoteJidAlt].filter(Boolean));
    const byId = new Map();

    // 1. Evolution API historical records
    for (const raw of evolutionRawRecords) {
      const norm = normalizeMessageRecord(raw, this.sentMessageIds);
      if (norm && (allowedJids.has(norm.remoteJid) || allowedJids.has(norm.remoteJidAlt))) {
        byId.set(norm.id, norm);
      }
    }

    // 2. Passive rolling buffer (check both primary and alt JIDs)
    for (const jidKey of allowedJids) {
      const buffered = this.buffers.get(jidKey) || [];
      for (const item of buffered) {
        byId.set(item.id, item);
      }
    }

    // 3. Ensure latest triggering message is included
    if (latestMsg && (allowedJids.has(latestMsg.remoteJid) || allowedJids.has(latestMsg.remoteJidAlt))) {
      byId.set(latestMsg.id, latestMsg);
    }

    const sorted = Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
    const trimmed = sorted.slice(-this.maxHistoryMessages);

    // Sync merged history back into buffer so follow-ups stay lightning-fast
    this.buffers.set(remoteJid, trimmed);
    return trimmed;
  }

  /**
   * Build LLM chat messages array from the full chronological WhatsApp history,
   * respecting maxContextChars while preserving the most recent messages in full.
   */
  buildLlmMessages(history, { remoteJid, isGroup }) {
    const formatted = [];
    let totalChars = 0;

    // Walk backwards so we always keep the newest messages if context exceeds maxContextChars
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      const timeStr = formatCairoTime(msg.timestamp);
      const role = msg.isFathy ? "assistant" : "user";

      let content = msg.text;
      if (role === "user") {
        let speaker;
        if (msg.fromMe) {
          speaker = "شريف رضا (صاحب الرقم 01208840531)";
        } else if (msg.pushName) {
          speaker = msg.pushName;
        } else if (msg.participant) {
          speaker = msg.participant.replace(/@.+$/, "");
        } else {
          speaker = isGroup ? "عضو في الجروب" : remoteJid.replace(/@.+$/, "");
        }

        const quotePrefix = msg.quotedText
          ? `[رداً على رسالة: "${msg.quotedText.slice(0, 160)}"]\n`
          : "";
        content = `[${speaker}${timeStr ? ` | ${timeStr}` : ""}]:\n${quotePrefix}${msg.text}`;
      } else {
        // Strip Fathy visual prefix from assistant history turns so the model doesn't double-prefix
        content = msg.text
          .replace(/[\u200B\u200C]/g, "")
          .replace(/^🤖\s*\*?فتحي(?:\s*AI)?:\*?\s*\n?/, "")
          .trim();
      }

      if (totalChars + content.length > this.maxContextChars && formatted.length > 0) {
        break;
      }
      totalChars += content.length;
      formatted.push({ role, content });
    }

    formatted.reverse();

    // Coalesce consecutive user messages cleanly so models requiring alternating roles never fail
    const coalesced = [];
    for (const item of formatted) {
      const prev = coalesced[coalesced.length - 1];
      if (prev && prev.role === item.role) {
        prev.content = `${prev.content}\n\n${item.content}`;
      } else {
        coalesced.push({ ...item });
      }
    }

    return coalesced;
  }

  /**
   * Fetch recent Star Belt quotations from Supabase (cached for 60s) when the conversation
   * mentions quotations, prices, or clients, giving Fathy live Star Belt business context.
   */
  async getRecentQuotationsSummary() {
    if (!this.supabaseUrl || !this.supabaseAnonKey) return "";
    const now = Date.now();
    if (now - this.quotationsCache.fetchedAt < 60_000 && this.quotationsCache.summary) {
      return this.quotationsCache.summary;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const url = `${this.supabaseUrl}/rest/v1/quotations?select=id,number,client,attention,total,quote_date,items&order=updated_at.desc&limit=15`;
      const res = await fetch(url, {
        headers: {
          apikey: this.supabaseAnonKey,
          Authorization: `Bearer ${this.supabaseAnonKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) return "";
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) return "";

      const lines = rows.map((r) => {
        const itemCount = Array.isArray(r.items) ? r.items.length : 0;
        const itemNames = Array.isArray(r.items)
          ? r.items
              .slice(0, 3)
              .map((it) => it?.name)
              .filter(Boolean)
              .join("، ")
          : "";
        return `- [id=${r.id || "?"}] عرض رقم ${r.number || "?"} | العميل: ${r.client || "غير محدد"}${r.attention ? ` (عناية: ${r.attention})` : ""} | الإجمالي: ${r.total ?? 0} ج.م | التاريخ: ${r.quote_date || "-"} | أصناف (${itemCount}): ${itemNames}`;
      });

      const summary = lines.join("\n");
      this.quotationsCache = { fetchedAt: now, summary };
      return summary;
    } catch {
      return "";
    }
  }
}
