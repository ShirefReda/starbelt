/**
 * Fathy AI WhatsApp Agent Orchestrator.
 *
 * Handles Evolution API MESSAGES_UPSERT webhooks for WhatsApp number 01208840531 (instance: starbelt):
 * 1. Passively buffers EVERY message across chats for instant full-context awareness.
 * 2. Detects triggers ("fathy", "FATHY", "فتحي", "فتحى", "يا فتحي") or active DM follow-ups or replies to Fathy.
 * 3. Pulls FULL chat history directly from Evolution API + merges passive buffer + Star Belt quotations context.
 * 4. Calls the multi-provider AI fallback engine and immediately replies on WhatsApp.
 * 5. Prevents infinite self-loops and concurrent race conditions per chat.
 */

import {
  FATHY_SIGNATURE_MARKER,
  isFathyOwnMessage,
  isFathyStopCommand,
  isFathyTrigger,
} from "./trigger.mjs";
import { normalizeMessageRecord } from "./contextStore.mjs";

const QUOTATION_KEYWORDS_RE =
  /(?:عرض\s*سعر|عروض\s*الاسعار|بيان\s*سعر|سعر|اسعار|تسعير|فاتور|عميل|عملاء|ستار\s*بيلت|ستاربلت|سير|سيور|quotation|quote|price|invoice|starbelt)/i;

/**
 * Split very long WhatsApp messages cleanly at paragraph/line boundaries (WhatsApp stays crisp under ~3500 chars).
 */
export function splitWhatsAppMessage(text, maxLen = 3500) {
  if (!text || text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = remaining.lastIndexOf(" ", maxLen);
    if (splitAt < maxLen * 0.3) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export class FathyAgent {
  constructor({ config, evolution, contextStore, aiClient }) {
    this.config = config;
    this.evolution = evolution;
    this.contextStore = contextStore;
    this.aiClient = aiClient;
    /** Per-chat serialized promise queue so back-to-back messages process in order */
    this.chatQueues = new Map();
    this.stats = {
      webhooksReceived: 0,
      messagesBuffered: 0,
      triggersHandled: 0,
      repliesSent: 0,
      errors: 0,
      lastEventAt: null,
      lastReplyAt: null,
      lastError: null,
    };
  }

  /**
   * Format Fathy's outgoing reply with clean WhatsApp header + invisible loop-guard marker.
   */
  formatOutgoingReply(replyText) {
    return `🤖 *فتحي:*\n${replyText}${FATHY_SIGNATURE_MARKER}`;
  }

  /**
   * Entry point for incoming Evolution API webhook JSON payloads.
   */
  async handleWebhookPayload(payload) {
    this.stats.webhooksReceived++;
    this.stats.lastEventAt = new Date().toISOString();

    if (!payload || typeof payload !== "object") {
      return { handled: false, reason: "empty_payload" };
    }

    const event = String(payload.event || "").toLowerCase();
    // Accept messages.upsert (v2) or MESSAGES_UPSERT (v1/v2 uppercase)
    if (event && event !== "messages.upsert" && event !== "messages_upsert") {
      return { handled: false, reason: `ignored_event:${event}` };
    }

    // Verify instance matches if specified
    if (
      payload.instance &&
      this.config.evolutionInstance &&
      String(payload.instance) !== this.config.evolutionInstance
    ) {
      return { handled: false, reason: `wrong_instance:${payload.instance}` };
    }

    const rawList = Array.isArray(payload.data)
      ? payload.data
      : payload.data
        ? [payload.data]
        : [];

    const results = [];
    for (const rawRecord of rawList) {
      const r = await this.enqueueMessage(rawRecord);
      results.push(r);
    }

    return { handled: true, count: results.length, results };
  }

  enqueueMessage(rawRecord) {
    const remoteJid = rawRecord?.key?.remoteJid || rawRecord?.remoteJid || "";
    if (!remoteJid || remoteJid === "status@broadcast" || remoteJid.endsWith("@newsletter")) {
      return Promise.resolve({ skipped: true, reason: "broadcast_or_empty" });
    }

    const prev = this.chatQueues.get(remoteJid) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => this.processSingleMessage(rawRecord))
      .catch((err) => {
        this.stats.errors++;
        this.stats.lastError = err instanceof Error ? err.message : String(err);
        console.error(`[Fathy] Error processing message for ${remoteJid}:`, err);
        return { error: this.stats.lastError };
      });

    this.chatQueues.set(remoteJid, next);
    next.finally(() => {
      if (this.chatQueues.get(remoteJid) === next) {
        this.chatQueues.delete(remoteJid);
      }
    });

    return next;
  }

  async processSingleMessage(rawRecord) {
    const rawId = rawRecord?.key?.id || rawRecord?.id || "";

    // Deduplicate webhook retries
    if (this.contextStore.isDuplicateWebhook(rawId)) {
      return { skipped: true, reason: "duplicate_webhook" };
    }

    const normalized = normalizeMessageRecord(rawRecord, this.contextStore.sentMessageIds);
    if (!normalized || !normalized.text) {
      return { skipped: true, reason: "non_text_or_empty" };
    }

    const { remoteJid, text, fromMe, id, pushName, quotedIsFathy } = normalized;

    // Always buffer passively so full chat context stays up-to-date
    this.contextStore.recordMessage(normalized);
    this.stats.messagesBuffered++;

    // CRITICAL LOOP GUARD: Never respond to Fathy's own outgoing messages!
    if (fromMe && isFathyOwnMessage(text, id, this.contextStore.sentMessageIds)) {
      return { skipped: true, reason: "fathy_own_message" };
    }

    const isGroup = remoteJid.endsWith("@g.us");
    const triggeredByName = isFathyTrigger(text);
    const stopRequested = isFathyStopCommand(text);
    const sessionActive = this.contextStore.isSessionActive(remoteJid);

    // Handle explicit stop / sleep command
    if (stopRequested && (sessionActive || triggeredByName)) {
      this.contextStore.deactivateSession(remoteJid);
      const byeText = this.formatOutgoingReply(
        "تمام، أنا هاقف دلوقتي 👌 وقت ما تحتاجني تاني نادي عليّا بـ *فتحي* أو *Fathy* وهكون معاك فوراً.",
      );
      await this.sendAndTrack(remoteJid, byeText, rawRecord.key);
      return { replied: true, action: "session_deactivated" };
    }

    // Decide whether Fathy should respond to this message:
    // 1. Someone explicitly called "fathy" / "FATHY" / "فتحي" / "فتحى" -> ALWAYS respond & activate session!
    // 2. Someone replied/quoted one of Fathy's messages -> ALWAYS respond!
    // 3. In a 1-on-1 DM where Fathy was already called recently (within TTL) -> continue responding naturally!
    const shouldRespond =
      triggeredByName || quotedIsFathy || (!isGroup && sessionActive);

    if (!shouldRespond) {
      return { skipped: true, reason: "buffered_sleeping" };
    }

    this.stats.triggersHandled++;
    this.contextStore.activateSession(remoteJid, pushName || (fromMe ? "owner" : ""));

    // Immediately show "typing..." indicator on WhatsApp
    void this.evolution.sendTyping(remoteJid, 5000);

    // Pull FULL chat context from Evolution API + merge with passive buffer
    const evoHistory = await this.evolution.fetchChatHistory(
      remoteJid,
      this.config.maxHistoryMessages,
    );
    const fullHistory = this.contextStore.mergeHistory(remoteJid, evoHistory, normalized);

    // Build LLM messages from the ENTIRE merged conversation history
    const llmMessages = this.contextStore.buildLlmMessages(fullHistory, {
      remoteJid,
      isGroup,
    });

    // Attach live Star Belt quotations summary from Supabase if conversation mentions prices/quotations
    const recentTextSample = fullHistory
      .slice(-6)
      .map((m) => m.text)
      .join(" ");
    const quotationsSummary = QUOTATION_KEYWORDS_RE.test(recentTextSample)
      ? await this.contextStore.getRecentQuotationsSummary()
      : "";

    console.log(
      `[Fathy] Triggered in ${remoteJid} (${isGroup ? "group" : "dm"}, fromMe=${fromMe}) | context=${fullHistory.length} msgs (${llmMessages.length} turns)`,
    );

    const aiResult = await this.aiClient.generateReply({
      messages: llmMessages,
      isGroup,
      remoteJid,
      quotationsSummary,
    });

    const chunks = splitWhatsAppMessage(aiResult.text, 3500);
    for (let i = 0; i < chunks.length; i++) {
      const formatted =
        i === 0
          ? this.formatOutgoingReply(chunks[i])
          : `${chunks[i]}${FATHY_SIGNATURE_MARKER}`;
      await this.sendAndTrack(remoteJid, formatted, i === 0 ? rawRecord.key : null);
    }

    this.stats.repliesSent++;
    this.stats.lastReplyAt = new Date().toISOString();

    console.log(
      `[Fathy] Replied in ${remoteJid} via ${aiResult.provider}/${aiResult.model} in ${aiResult.latencyMs}ms`,
    );

    return {
      replied: true,
      provider: aiResult.provider,
      model: aiResult.model,
      latencyMs: aiResult.latencyMs,
      contextMessages: fullHistory.length,
    };
  }

  async sendAndTrack(remoteJid, formattedText, quotedKey) {
    const sent = await this.evolution.sendText(remoteJid, formattedText, quotedKey);
    if (sent?.messageId) {
      this.contextStore.markSentByFathy(sent.messageId);
    }
    // Also record Fathy's reply immediately into the rolling buffer
    this.contextStore.recordMessage({
      id: sent?.messageId || `fathy:${Date.now()}`,
      remoteJid,
      fromMe: true,
      isFathy: true,
      participant: "",
      pushName: "فتحي",
      timestamp: Math.floor(Date.now() / 1000),
      text: formattedText,
      quotedText: "",
      quotedIsFathy: false,
      mediaType: null,
    });
    return sent;
  }

  getHealthSummary() {
    return {
      ok: true,
      agent: "Fathy AI (فتحي)",
      ownerNumber: this.config.ownerNumber,
      evolution: {
        configured: this.evolution.isConfigured(),
        baseUrl: this.config.evolutionBaseUrl,
        instance: this.config.evolutionInstance,
        webhookUrl: this.config.webhookUrl,
      },
      ai: {
        configuredRoutes: this.config.providers.length,
        providers: Array.from(new Set(this.config.providers.map((p) => p.provider))),
        topModels: this.config.providers.slice(0, 6).map((p) => `${p.provider}/${p.model}`),
        lastSuccess: this.aiClient.lastSuccess,
      },
      context: {
        bufferedChats: this.contextStore.buffers.size,
        activeSessions: this.contextStore.getActiveSessionCount(),
        maxHistoryMessages: this.config.maxHistoryMessages,
      },
      stats: this.stats,
    };
  }
}
