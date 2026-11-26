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
import {
  buildQuotationFromDraft,
  buildQuotationShareUrl,
  computeQuotationTotals,
  extractCreateQuotationCommand,
  extractSendPdfCommand,
  fetchQuotationFromSupabaseServer,
  formatQuotationWhatsAppCard,
  sanitizeQuotationIntroText,
  saveQuotationToSupabaseServer,
} from "./quotationTool.mjs";

const QUOTATION_KEYWORDS_RE =
  /(?:عرض\s*سعر|عروض\s*الاسعار|بيان\s*سعر|سعر|اسعار|تسعير|فاتور|عميل|عملاء|ستار\s*بيلت|ستاربلت|سير|سيور|pdf|quotation|quote|price|invoice|starbelt)/i;

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
  /** @param {{ config: any, evolution: any, contextStore: any, aiClient: any, pdfGenerator?: any }} deps */
  constructor({ config, evolution, contextStore, aiClient, pdfGenerator = null }) {
    this.config = config;
    this.evolution = evolution;
    this.contextStore = contextStore;
    this.aiClient = aiClient;
    this.pdfGenerator = pdfGenerator;
    /** Per-chat serialized promise queue so back-to-back messages process in order */
    this.chatQueues = new Map();
    this.stats = {
      webhooksReceived: 0,
      messagesBuffered: 0,
      triggersHandled: 0,
      repliesSent: 0,
      quotationsCreated: 0,
      pdfsSent: 0,
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

    const { remoteJid, remoteJidAlt, text, fromMe, id, pushName, quotedIsFathy } = normalized;
    // Evolution API v2 @lid fix: prefer remoteJidAlt (@s.whatsapp.net) when replying to @lid chats
    const replyTarget =
      remoteJid.endsWith("@lid") && remoteJidAlt ? remoteJidAlt : remoteJid;

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
      await this.sendAndTrack(remoteJid, replyTarget, byeText, rawRecord.key);
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

    // Hard Rule #3 (`agy-server-brief.md`): the private single-user `agy` gateway may ONLY serve
    // the owner (`fromMe === true`). For other people / customers, use official GEMINI_API_KEY.
    if (
      typeof this.aiClient.isPrivateGatewayOnly === "function" &&
      this.aiClient.isPrivateGatewayOnly() &&
      !fromMe
    ) {
      console.warn(
        `[Fathy] Skipped third-party WhatsApp trigger in ${remoteJid}: private 127.0.0.1 agy gateway is owner-only. Set GEMINI_API_KEY for customer chats.`,
      );
      return { skipped: true, reason: "private_gateway_owner_only" };
    }

    this.stats.triggersHandled++;
    this.contextStore.activateSession(remoteJid, pushName || (fromMe ? "owner" : ""));

    // Immediately show "typing..." indicator on WhatsApp
    void this.evolution.sendTyping(replyTarget, 5000);

    // Pull FULL chat context from Evolution API (both primary JID and alt JID if @lid) + merge with passive buffer
    const primaryEvoHistory = await this.evolution.fetchChatHistory(
      remoteJid,
      this.config.maxHistoryMessages,
    );
    const altEvoHistory =
      remoteJidAlt && remoteJidAlt !== remoteJid
        ? await this.evolution.fetchChatHistory(
            remoteJidAlt,
            Math.min(50, this.config.maxHistoryMessages),
          )
        : [];
    const fullHistory = this.contextStore.mergeHistory(
      remoteJid,
      [...primaryEvoHistory, ...altEvoHistory],
      normalized,
      remoteJidAlt,
    );

    // Build LLM messages from the ENTIRE merged conversation history
    const llmMessages = this.contextStore.buildLlmMessages(fullHistory, {
      remoteJid: replyTarget,
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
      `[Fathy] Triggered in ${remoteJid} (replyTo=${replyTarget}, ${isGroup ? "group" : "dm"}, fromMe=${fromMe}) | context=${fullHistory.length} msgs (${llmMessages.length} turns)`,
    );

    const aiResult = await this.aiClient.generateReply({
      messages: llmMessages,
      isGroup,
      remoteJid: replyTarget,
      quotationsSummary,
    });

    // SmartCycle: detect & execute <CREATE_QUOTATION> or <SEND_QUOTATION_PDF> commands
    let finalReplyText = aiResult.text;
    let createdQuotation = null;
    let pdfSentInfo = null;
    let quotationForPdf = null;
    let totalsForPdf = null;
    let savedToCloudForCard = true;
    let introTextForPdf = "";

    const quoteCmd = extractCreateQuotationCommand(aiResult.text);
    const sendPdfCmd = !quoteCmd.found ? extractSendPdfCommand(aiResult.text) : { found: false, query: null, cleanedText: "" };

    if (quoteCmd.found && quoteCmd.draft) {
      const { quotation, totals } = buildQuotationFromDraft(quoteCmd.draft);
      const saveRes = await saveQuotationToSupabaseServer(quotation, {
        supabaseUrl: this.config.supabaseUrl,
        supabaseAnonKey: this.config.supabaseAnonKey,
      });
      if (!saveRes.saved) {
        console.warn(`[Fathy SmartCycle] Supabase save failed for ${quotation.id}:`, saveRes.error);
      } else {
        this.contextStore.quotationsCache = { fetchedAt: 0, summary: "" };
      }

      const publicBaseUrl = this.config.publicBaseUrl || "https://maker.starbelt.com.eg";
      const shareUrl = buildQuotationShareUrl(quotation.id, publicBaseUrl);

      this.stats.quotationsCreated++;
      createdQuotation = {
        id: quotation.id,
        number: quotation.number,
        client: quotation.client,
        total: totals.total,
        shareUrl,
        savedToCloud: saveRes.saved,
      };
      quotationForPdf = quotation;
      totalsForPdf = totals;
      savedToCloudForCard = saveRes.saved;
      introTextForPdf = sanitizeQuotationIntroText(quoteCmd.cleanedText);

      const card = formatQuotationWhatsAppCard(quotation, totals, publicBaseUrl, {
        savedToCloud: saveRes.saved,
      });
      finalReplyText = [introTextForPdf, card].filter(Boolean).join("\n\n");
      console.log(
        `[Fathy SmartCycle] Created quotation ${quotation.number} (${quotation.id}) for "${quotation.client}" total=${totals.total} saved=${saveRes.saved}`,
      );
    } else if (quoteCmd.found && quoteCmd.cleanedText) {
      console.warn(`[Fathy SmartCycle] Ignored malformed <CREATE_QUOTATION>: ${quoteCmd.parseError}`);
      finalReplyText = quoteCmd.cleanedText;
    } else if (sendPdfCmd.found && sendPdfCmd.query) {
      const existing = await fetchQuotationFromSupabaseServer(sendPdfCmd.query, {
        supabaseUrl: this.config.supabaseUrl,
        supabaseAnonKey: this.config.supabaseAnonKey,
      });
      if (existing) {
        const totals = computeQuotationTotals(existing.items || [], existing.options || {});
        const publicBaseUrl = this.config.publicBaseUrl || "https://maker.starbelt.com.eg";
        quotationForPdf = existing;
        totalsForPdf = totals;
        savedToCloudForCard = true;
        introTextForPdf = sanitizeQuotationIntroText(sendPdfCmd.cleanedText);
        const card = formatQuotationWhatsAppCard(existing, totals, publicBaseUrl, {
          savedToCloud: true,
        });
        finalReplyText = [introTextForPdf, card].filter(Boolean).join("\n\n");
      } else {
        finalReplyText =
          [
            sendPdfCmd.cleanedText,
            "لم أجد عرض السعر المطلوب في سجل ستار بيلت السحابي. يمكنك إرسال رقم العرض أو اسم العميل بدقة أو طلب إنشاء عرض جديد.",
          ]
            .filter(Boolean)
            .join("\n\n");
      }
    } else if (sendPdfCmd.found && sendPdfCmd.cleanedText) {
      finalReplyText = sendPdfCmd.cleanedText;
    }

    // If we have a quotation and headless Chromium PDF rendering is available, send the official Star Belt A4 PDF itself!
    if (
      quotationForPdf &&
      totalsForPdf &&
      this.pdfGenerator &&
      typeof this.pdfGenerator.renderQuotationToPdf === "function" &&
      (!this.pdfGenerator.isAvailable || this.pdfGenerator.isAvailable()) &&
      typeof this.evolution.sendDocument === "function"
    ) {
      try {
        void this.evolution.sendTyping(replyTarget, 6000);
        const pdf = await this.pdfGenerator.renderQuotationToPdf(quotationForPdf);
        const publicBaseUrl = this.config.publicBaseUrl || "https://maker.starbelt.com.eg";
        const card = formatQuotationWhatsAppCard(quotationForPdf, totalsForPdf, publicBaseUrl, {
          savedToCloud: savedToCloudForCard,
        });
        const fullCaption = this.formatOutgoingReply(
          [introTextForPdf, card].filter(Boolean).join("\n\n"),
        );
        // WhatsApp document captions safely fit ~1000 chars; if longer, put concise summary on PDF + full text after
        if (fullCaption.length <= 1020) {
          await this.sendDocumentAndTrack(
            remoteJid,
            replyTarget,
            {
              base64: pdf.base64,
              fileName: pdf.fileName,
              caption: fullCaption,
              mimetype: "application/pdf",
            },
            rawRecord.key,
          );
        } else {
          const shareUrl = buildQuotationShareUrl(quotationForPdf.id, publicBaseUrl);
          const shortCaption = this.formatOutgoingReply(
            `📄 *عرض سعر شركة ستار بيلت*\n🏢 العميل: *${quotationForPdf.client}*\n🔢 رقم العرض: ${quotationForPdf.number}\n🔗 للتعديل: ${shareUrl}`,
          );
          await this.sendDocumentAndTrack(
            remoteJid,
            replyTarget,
            {
              base64: pdf.base64,
              fileName: pdf.fileName,
              caption: shortCaption,
              mimetype: "application/pdf",
            },
            rawRecord.key,
          );
          const chunks = splitWhatsAppMessage(finalReplyText, 3500);
          for (let i = 0; i < chunks.length; i++) {
            await this.sendAndTrack(
              remoteJid,
              replyTarget,
              `${chunks[i]}${FATHY_SIGNATURE_MARKER}`,
              null,
            );
          }
        }
        this.stats.pdfsSent++;
        pdfSentInfo = {
          fileName: pdf.fileName,
          byteLength: pdf.byteLength,
          durationMs: pdf.durationMs,
        };
        console.log(
          `[Fathy SmartCycle] Sent official A4 PDF "${pdf.fileName}" (${pdf.byteLength} bytes in ${pdf.durationMs}ms) to ${replyTarget}`,
        );
      } catch (pdfErr) {
        console.warn(
          `[Fathy SmartCycle] PDF render/send failed, falling back to WhatsApp text card:`,
          pdfErr instanceof Error ? pdfErr.message : pdfErr,
        );
      }
    }

    // Standard text reply (or fallback if PDF render/send did not happen)
    if (!pdfSentInfo) {
      const chunks = splitWhatsAppMessage(finalReplyText, 3500);
      for (let i = 0; i < chunks.length; i++) {
        const formatted =
          i === 0
            ? this.formatOutgoingReply(chunks[i])
            : `${chunks[i]}${FATHY_SIGNATURE_MARKER}`;
        await this.sendAndTrack(remoteJid, replyTarget, formatted, i === 0 ? rawRecord.key : null);
      }
    }

    this.stats.repliesSent++;
    this.stats.lastReplyAt = new Date().toISOString();

    console.log(
      `[Fathy] Replied in ${replyTarget} via ${aiResult.provider}/${aiResult.model} in ${aiResult.latencyMs}ms`,
    );

    return {
      replied: true,
      provider: aiResult.provider,
      model: aiResult.model,
      latencyMs: aiResult.latencyMs,
      contextMessages: fullHistory.length,
      ...(createdQuotation ? { createdQuotation } : {}),
      ...(pdfSentInfo ? { pdfSent: pdfSentInfo } : {}),
    };
  }

  async sendAndTrack(bufferJid, replyTarget, formattedText, quotedKey) {
    let sent;
    try {
      sent = await this.evolution.sendText(replyTarget, formattedText, quotedKey);
    } catch (err) {
      // Fallback: if replyTarget differed from bufferJid (e.g. @lid vs @s.whatsapp.net), retry with bufferJid
      if (replyTarget !== bufferJid) {
        sent = await this.evolution.sendText(bufferJid, formattedText, quotedKey);
      } else {
        throw err;
      }
    }
    if (sent?.messageId) {
      this.contextStore.markSentByFathy(sent.messageId);
    }
    // Also record Fathy's reply immediately into the rolling buffer
    this.contextStore.recordMessage({
      id: sent?.messageId || `fathy:${Date.now()}`,
      remoteJid: bufferJid,
      remoteJidAlt: replyTarget !== bufferJid ? replyTarget : "",
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

  async sendDocumentAndTrack(bufferJid, replyTarget, docPayload, quotedKey) {
    let sent;
    try {
      sent = await this.evolution.sendDocument(replyTarget, { ...docPayload, quotedKey });
    } catch (err) {
      if (replyTarget !== bufferJid) {
        sent = await this.evolution.sendDocument(bufferJid, { ...docPayload, quotedKey });
      } else {
        throw err;
      }
    }
    if (sent?.messageId) {
      this.contextStore.markSentByFathy(sent.messageId);
    }
    this.contextStore.recordMessage({
      id: sent?.messageId || `fathy-pdf:${Date.now()}`,
      remoteJid: bufferJid,
      remoteJidAlt: replyTarget !== bufferJid ? replyTarget : "",
      fromMe: true,
      isFathy: true,
      participant: "",
      pushName: "فتحي",
      timestamp: Math.floor(Date.now() / 1000),
      // Store compact 1-line summary in context buffer (saves Groq tokens & prevents LLM mimicking old cards)
      text: `[أرسل فتحي ملف PDF: ${docPayload.fileName}]`,
      quotedText: "",
      quotedIsFathy: false,
      mediaType: "document",
    });
    return sent;
  }

  getHealthSummary() {
    return {
      ok: true,
      agent: "Fathy AI (فتحي)",
      ownerNumber: this.config.ownerNumber,
      pdf: {
        available: Boolean(this.pdfGenerator?.isAvailable?.()),
      },
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
