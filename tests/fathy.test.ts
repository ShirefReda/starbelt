import { describe, it, expect, vi } from "vitest";
import {
  FATHY_SIGNATURE_MARKER,
  extractMessageDetails,
  isFathyOwnMessage,
  isFathyStopCommand,
  isFathyTrigger,
  normalizeForTrigger,
} from "../server/trigger.mjs";
import { ChatContextStore, normalizeMessageRecord } from "../server/contextStore.mjs";
import { FathyAiClient, cleanAssistantReply, fitMessagesToBudget } from "../server/aiClient.mjs";
import { FathyAgent, splitWhatsAppMessage } from "../server/fathyAgent.mjs";
import {
  buildProviderChain,
  isLoopbackGatewayUrl,
  normalizeGroqBaseUrl,
} from "../server/config.mjs";
import {
  buildQuotationFromDraft,
  buildQuotationShareUrl,
  computeQuotationTotals,
  extractCreateQuotationCommand,
  extractSendPdfCommand,
  formatQuotationWhatsAppCard,
  parseJsonObjectFromAi,
  sanitizeQuotationIntroText,
} from "../server/quotationTool.mjs";
import { buildPdfFileName, escapeJsonForScript } from "../server/pdfGenerator.mjs";
import {
  FathySttClient,
  STARBELT_STT_KEYTERMS,
  extensionForAudioMime,
  normalizeBilingualBeltTranscript,
} from "../server/sttClient.mjs";

describe("Fathy AI Trigger & Normalization", () => {
  it("normalizes Arabic variants, diacritics, and repeated letters", () => {
    expect(normalizeForTrigger("فَتحىىى")).toBe("فتحي");
    expect(normalizeForTrigger("FATHYYY")).toBe("fathy");
    expect(normalizeForTrigger("يا فتحى")).toBe("يا فتحي");
  });

  it("matches all English and Arabic Fathy calls accurately", () => {
    const positives = [
      "fathy",
      "FATHY",
      "Fathy help me summarize this chat",
      "hey @fathy what is the price?",
      "fathi, check this",
      "FATHYYY!",
      "فتحي",
      "فتحى",
      "يا فتحي رد على العميل ده",
      "يا فتحى لخصلي الكلام اللي فوق",
      "يافتحي احسبلي الإجمالي",
      "وفتحي كمان شوف السعر",
      "فتحىىى فينك؟",
      "مساء الخير فتحي؟",
    ];
    for (const text of positives) {
      expect(isFathyTrigger(text), `Expected "${text}" to trigger Fathy`).toBe(true);
    }
  });

  it("does not trigger on unrelated messages", () => {
    const negatives = [
      "صباح الخير يا هندسة",
      "عايزين سير 50 سم",
      "hello world",
      "father is coming",
      "sympathy",
      "مفتاح الباب",
      "الفتح المبين",
    ];
    for (const text of negatives) {
      expect(isFathyTrigger(text), `Expected "${text}" NOT to trigger Fathy`).toBe(false);
    }
  });

  it("detects Arabic and English stop commands", () => {
    expect(isFathyStopCommand("خلاص يا فتحي")).toBe(true);
    expect(isFathyStopCommand("اسكت يا فتحى")).toBe(true);
    expect(isFathyStopCommand("stop fathy")).toBe(true);
    expect(isFathyStopCommand("fathy off")).toBe(true);
    expect(isFathyStopCommand("يا فتحي احسب السعر")).toBe(false);
  });

  it("detects Fathy's own outgoing messages to prevent infinite loops", () => {
    const sentIds = new Set(["MSG-999"]);
    expect(isFathyOwnMessage("أي رسالة", "MSG-999", sentIds)).toBe(true);
    expect(isFathyOwnMessage(`أهلاً بك${FATHY_SIGNATURE_MARKER}`, "OTHER", sentIds)).toBe(true);
    expect(isFathyOwnMessage("🤖 *فتحي:*\nأهلاً بك", "OTHER", sentIds)).toBe(true);
    expect(isFathyOwnMessage("يا فتحي رد عليه", "USER-1", sentIds)).toBe(false);
  });

  it("extracts text, captions, and quoted replies from Baileys/Evolution payloads", () => {
    expect(extractMessageDetails({ message: { conversation: "ازيك يا فتحي" } }).text).toBe(
      "ازيك يا فتحي",
    );

    const quoted = extractMessageDetails({
      message: {
        extendedTextMessage: {
          text: "وضح النقطة دي",
          contextInfo: {
            quotedMessage: {
              conversation: `🤖 *فتحي:*\nالسعر 500 جنيه${FATHY_SIGNATURE_MARKER}`,
            },
          },
        },
      },
    });
    expect(quoted.text).toBe("وضح النقطة دي");
    expect(quoted.quotedText).toContain("السعر 500 جنيه");
    expect(quoted.quotedIsFathy).toBe(true);

    const ephemeral = extractMessageDetails({
      message: {
        ephemeralMessage: {
          message: {
            imageMessage: { caption: "فتحي شوف الصورة دي" },
          },
        },
      },
    });
    expect(ephemeral.text).toBe("[صورة] فتحي شوف الصورة دي");
    expect(ephemeral.mediaType).toBe("image");
  });
});

describe("Fathy AI Full Chat Context & Orchestration", () => {
  it("merges Evolution history + passive buffer chronologically and shares FULL context with AI", async () => {
    const store = new ChatContextStore({ maxHistoryMessages: 100 });
    const jid = "201012345678@s.whatsapp.net";

    const evoHistory = [
      {
        key: { id: "m1", remoteJid: jid, fromMe: false },
        pushName: "م. أحمد",
        messageTimestamp: 1700000100,
        message: { conversation: "سلام عليكم عايزين سير 60 سم بطول 20 متر" },
      },
      {
        key: { id: "m2", remoteJid: jid, fromMe: true },
        messageTimestamp: 1700000200,
        message: { conversation: "وعليكم السلام، حاضر يا هندسة هبعتلك السعر حالاً" },
      },
    ];

    const triggerRaw = {
      key: { id: "m3", remoteJid: jid, fromMe: false },
      pushName: "م. أحمد",
      messageTimestamp: 1700000300,
      message: { conversation: "يا فتحي لخصلي الطلب اللي فوق" },
    };

    const latest = normalizeMessageRecord(triggerRaw, store.sentMessageIds);
    const merged = store.mergeHistory(jid, evoHistory, latest);
    expect(merged).toHaveLength(3);
    expect(merged.map((m: { id: string }) => m.id)).toEqual(["m1", "m2", "m3"]);

    const llmMsgs = store.buildLlmMessages(merged, { remoteJid: jid, isGroup: false });
    const combinedContext = llmMsgs.map((m: { content: string }) => m.content).join("\n");
    expect(combinedContext).toContain("سير 60 سم بطول 20 متر");
    expect(combinedContext).toContain("شريف رضا");
    expect(combinedContext).toContain("يا فتحي لخصلي الطلب اللي فوق");
  });

  it("handles webhook trigger, fetches full history, replies once, and ignores self-echo", async () => {
    const jid = "201099999999@s.whatsapp.net";
    const sentTexts: Array<{ jid: string; text: string }> = [];

    const mockEvolution = {
      isConfigured: () => true,
      sendTyping: vi.fn().mockResolvedValue(undefined),
      fetchChatHistory: vi.fn().mockResolvedValue([
        {
          key: { id: "old-1", remoteJid: jid, fromMe: false },
          pushName: "عميل ستار بيلت",
          messageTimestamp: 1700000010,
          message: { conversation: "عايز عرض سعر 3 سيور" },
        },
      ]),
      sendText: vi.fn().mockImplementation(async (to: string, text: string) => {
        sentTexts.push({ jid: to, text });
        return { messageId: `BOT-${sentTexts.length}` };
      }),
    };

    const capturedLlmPayloads: unknown[] = [];
    const mockAiClient = {
      lastSuccess: null,
      generateReply: vi.fn().mockImplementation(async (args: unknown) => {
        capturedLlmPayloads.push(args);
        return {
          text: "تم يا فندم، طلبك هو عرض سعر لـ 3 سيور.",
          provider: "logfare",
          model: "openai/gpt-6-luna",
          latencyMs: 1200,
        };
      }),
    };

    const store = new ChatContextStore({ sessionTtlMs: 60_000 });
    const agent = new FathyAgent({
      config: { evolutionInstance: "starbelt", maxHistoryMessages: 100, providers: [] },
      evolution: mockEvolution,
      contextStore: store,
      aiClient: mockAiClient,
    });

    // 1. Unrelated message -> buffered silently, NO reply
    const r1 = await agent.handleWebhookPayload({
      event: "messages.upsert",
      instance: "starbelt",
      data: {
        key: { id: "u-1", remoteJid: jid, fromMe: false },
        pushName: "عميل ستار بيلت",
        messageTimestamp: 1700000020,
        message: { conversation: "المقاس 40 في 1500" },
      },
    });
    expect(r1.results?.[0]?.skipped).toBe(true);
    expect(sentTexts).toHaveLength(0);

    // 2. User calls "FATHY" -> immediately wakes up with FULL context (old-1 + u-1 + u-2)
    const r2 = await agent.handleWebhookPayload({
      event: "messages.upsert",
      instance: "starbelt",
      data: {
        key: { id: "u-2", remoteJid: jid, fromMe: false },
        pushName: "عميل ستار بيلت",
        messageTimestamp: 1700000030,
        message: { conversation: "FATHY لخصلي اللي قلته" },
      },
    });
    expect(r2.results?.[0]?.replied).toBe(true);
    expect(sentTexts).toHaveLength(1);
    expect(sentTexts[0]?.text).toContain("🤖 *فتحي:*");
    expect(sentTexts[0]?.text).toContain(FATHY_SIGNATURE_MARKER);

    const aiArgs = capturedLlmPayloads[0] as { messages: Array<{ content: string }> };
    const fullSentContext = aiArgs.messages.map((m) => m.content).join("\n");
    expect(fullSentContext).toContain("عرض سعر 3 سيور");
    expect(fullSentContext).toContain("المقاس 40 في 1500");
    expect(fullSentContext).toContain("FATHY لخصلي اللي قلته");

    // 3. Echo of Fathy's own sent message comes back via webhook -> MUST be ignored!
    const r3 = await agent.handleWebhookPayload({
      event: "messages.upsert",
      instance: "starbelt",
      data: {
        key: { id: "BOT-1", remoteJid: jid, fromMe: true },
        messageTimestamp: 1700000031,
        message: { conversation: sentTexts[0]?.text },
      },
    });
    expect(r3.results?.[0]?.skipped).toBe(true);
    expect(sentTexts).toHaveLength(1);

    // 4. Follow-up message in DM while session is active -> responds immediately without repeating "Fathy"!
    const r4 = await agent.handleWebhookPayload({
      event: "messages.upsert",
      instance: "starbelt",
      data: {
        key: { id: "u-3", remoteJid: jid, fromMe: false },
        pushName: "عميل ستار بيلت",
        messageTimestamp: 1700000040,
        message: { conversation: "وضيف عليهم ضريبة 14%" },
      },
    });
    expect(r4.results?.[0]?.replied).toBe(true);
    expect(sentTexts).toHaveLength(2);

    // 5. Stop command -> deactivates session gracefully
    const r5 = await agent.handleWebhookPayload({
      event: "messages.upsert",
      instance: "starbelt",
      data: {
        key: { id: "u-4", remoteJid: jid, fromMe: false },
        pushName: "عميل ستار بيلت",
        messageTimestamp: 1700000050,
        message: { conversation: "خلاص يا فتحي" },
      },
    });
    expect(r5.results?.[0]?.action).toBe("session_deactivated");
    expect(store.isSessionActive(jid)).toBe(false);
  });

  it("cleans thinking tags, splits long WhatsApp messages, and puts Groq qwen/qwen3.8-27b on top", () => {
    expect(cleanAssistantReply("<think>internal thoughts</think> أهلاً بك!")).toBe("أهلاً بك!");
    expect(splitWhatsAppMessage("A".repeat(4000), 1500).length).toBeGreaterThanOrEqual(3);

    // Groq base URL normalization
    expect(normalizeGroqBaseUrl("https://api.groq.com")).toBe("https://api.groq.com/openai/v1");
    expect(normalizeGroqBaseUrl("https://api.groq.com/openai")).toBe("https://api.groq.com/openai/v1");
    expect(normalizeGroqBaseUrl("https://api.groq.com/openai/v1/")).toBe("https://api.groq.com/openai/v1");

    // Groq MUST be #1 on top even when Gemini is also configured
    const groqTopChain = buildProviderChain({
      GROQ_API_KEY: "gsk-test-key",
      GROQ_BASE_URL: "https://api.groq.com",
      GEMINI_API_KEY: "AIza-test-key",
    });
    expect(groqTopChain[0]?.provider).toBe("groq");
    expect(groqTopChain[0]?.model).toBe("qwen/qwen3.8-27b");
    expect(groqTopChain[0]?.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(groqTopChain[1]?.provider).toBe("groq");
    expect(groqTopChain[1]?.model).toBe("openai/gpt-oss-120b");

    // Official Gemini API key alone
    const geminiApiChain = buildProviderChain({
      GEMINI_API_KEY: "AIza-test-key",
    });
    expect(geminiApiChain[0]?.provider).toBe("gemini");
    expect(geminiApiChain[0]?.model).toBe("gemini-2.5-flash");
    expect(geminiApiChain[1]?.provider).toBe("gemini");
    expect(geminiApiChain[1]?.model).toBe("gemini-2.5-flash-lite");

    // Private loopback agy gateway (127.0.0.1 only)
    const localGatewayChain = buildProviderChain({
      AGY_GATEWAY_URL: "http://127.0.0.1:8787",
      AGY_GATEWAY_TOKEN: "a".repeat(40),
    });
    expect(localGatewayChain).toHaveLength(1);
    expect(localGatewayChain[0]?.provider).toBe("gemini-gateway");
    expect(localGatewayChain[0]?.model).toBe("gemini-3.8-flash-medium");

    // Public/non-loopback gateway URL MUST be rejected (Hard Rule #4)
    expect(isLoopbackGatewayUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackGatewayUrl("http://localhost:8787")).toBe(true);
    expect(isLoopbackGatewayUrl("https://evil.example.com")).toBe(false);
    expect(isLoopbackGatewayUrl("http://0.0.0.0:8787")).toBe(false);
    const rejectedPublic = buildProviderChain({
      AGY_GATEWAY_URL: "https://public.example.com",
      AGY_GATEWAY_TOKEN: "a".repeat(40),
    });
    expect(rejectedPublic).toHaveLength(0);

    // Old third-party providers (Requesty/UnoRouter/Logfare) are completely removed
    const legacyIgnored = buildProviderChain({
      REQUESTY_API_KEY: "rqsty-old",
      UNOROUTER_API_KEY: "sk-old",
      LOGFARE_API_KEY: "lfu-old",
    });
    expect(legacyIgnored).toHaveLength(0);
  });

  it("routes replies to remoteJidAlt when incoming message uses WhatsApp @lid", async () => {
    const sentTargets: string[] = [];
    const mockEvolution = {
      isConfigured: () => true,
      sendTyping: vi.fn().mockResolvedValue(undefined),
      fetchChatHistory: vi.fn().mockResolvedValue([]),
      sendText: vi.fn().mockImplementation(async (to: string) => {
        sentTargets.push(to);
        return { messageId: "LID-REPLY-1" };
      }),
    };
    const mockAiClient = {
      lastSuccess: null,
      generateReply: vi.fn().mockResolvedValue({
        text: "أهلاً بك يا هندسة!",
        provider: "logfare",
        model: "openai/gpt-6-luna",
        latencyMs: 900,
      }),
    };
    const store = new ChatContextStore();
    const agent = new FathyAgent({
      config: { evolutionInstance: "starbelt", maxHistoryMessages: 50, providers: [] },
      evolution: mockEvolution,
      contextStore: store,
      aiClient: mockAiClient,
    });

    await agent.handleWebhookPayload({
      event: "messages.upsert",
      instance: "starbelt",
      data: {
        key: {
          id: "lid-msg-1",
          remoteJid: "83515756548312@lid",
          remoteJidAlt: "201012345678@s.whatsapp.net",
          fromMe: false,
        },
        pushName: "م. شريف",
        messageTimestamp: 1700000100,
        message: { conversation: "يا فتحي ازيك" },
      },
    });

    expect(sentTargets).toEqual(["201012345678@s.whatsapp.net"]);
  });

  it("tracks per-model cooldowns and private-gateway owner-only mode in FathyAiClient", () => {
    const client = new FathyAiClient([
      {
        provider: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        apiKey: "k",
        model: "gemini-2.5-flash",
        defaultCooldownSec: 20,
      },
    ]);
    const route = client.providers[0];
    expect(client.isInCooldown(route)).toBe(false);
    client.setCooldown(route, 60);
    expect(client.isInCooldown(route)).toBe(true);
    expect(client.isPrivateGatewayOnly()).toBe(false);

    const gwOnly = new FathyAiClient([
      {
        provider: "gemini-gateway",
        baseUrl: "http://127.0.0.1:8787",
        apiKey: "a".repeat(40),
        model: "gemini-3.8-flash-medium",
        defaultCooldownSec: 10,
      },
    ]);
    expect(gwOnly.isPrivateGatewayOnly()).toBe(true);
  });

  it("enforces owner-only WhatsApp guard when running on private 127.0.0.1 agy gateway", async () => {
    const mockEvolution = {
      isConfigured: () => true,
      sendTyping: vi.fn().mockResolvedValue(undefined),
      fetchChatHistory: vi.fn().mockResolvedValue([]),
      sendText: vi.fn().mockResolvedValue({ messageId: "GW-1" }),
    };
    const mockAiClient = {
      lastSuccess: null,
      isPrivateGatewayOnly: () => true,
      generateReply: vi.fn().mockResolvedValue({
        text: "تم يا شريف!",
        provider: "gemini-gateway",
        model: "gemini-3.8-flash-medium",
        latencyMs: 500,
      }),
    };
    const store = new ChatContextStore();
    const agent = new FathyAgent({
      config: { evolutionInstance: "starbelt", maxHistoryMessages: 50, providers: [] },
      evolution: mockEvolution,
      contextStore: store,
      aiClient: mockAiClient,
    });

    // External sender (`fromMe: false`) MUST be blocked when only private agy gateway is configured
    const blocked = await agent.handleWebhookPayload({
      event: "messages.upsert",
      instance: "starbelt",
      data: {
        key: { id: "ext-1", remoteJid: "201099999999@s.whatsapp.net", fromMe: false },
        messageTimestamp: 1700000100,
        message: { conversation: "يا فتحي ازيك" },
      },
    });
    expect(blocked.results?.[0]?.skipped).toBe(true);
    expect(blocked.results?.[0]?.reason).toBe("private_gateway_owner_only");
    expect(mockAiClient.generateReply).not.toHaveBeenCalled();

    // Owner (`fromMe: true`) IS allowed
    const allowed = await agent.handleWebhookPayload({
      event: "messages.upsert",
      instance: "starbelt",
      data: {
        key: { id: "own-1", remoteJid: "201099999999@s.whatsapp.net", fromMe: true },
        messageTimestamp: 1700000105,
        message: { conversation: "يا فتحي لخصلي الكلام" },
      },
    });
    expect(allowed.results?.[0]?.replied).toBe(true);
    expect(mockAiClient.generateReply).toHaveBeenCalledTimes(1);
  });
});

describe("SmartCycle Quotation Builder & WhatsApp End-to-End Integration", () => {
  it("builds a schema-valid Quotation with Arabic-Indic numbers, discount, and 14% VAT", () => {
    const { quotation, totals } = buildQuotationFromDraft({
      client: "شركة النيل للأغذية",
      attention: "م. كريم",
      items: [
        { name: "سير ناقل PVC أخضر 50 سم × 12 متر", qty: "٢", price: "4,000" },
        { name: "سير تايمنج", qty: 2, price: 1000 },
      ],
      showDiscount: true,
      discountType: "percent",
      discountPercent: 10,
      showVat: true,
      vatRate: 14,
    });

    expect(quotation.schemaVersion).toBe(1);
    expect(quotation.id).toMatch(/^q_/);
    expect(quotation.number).toMatch(/^SB-\d{4}-\d{4}$/);
    expect(quotation.client).toBe("شركة النيل للأغذية");
    expect(quotation.attention).toBe("م. كريم");
    expect(quotation.items).toHaveLength(2);
    expect(quotation.items[0]?.qty).toBe(2);
    expect(quotation.items[0]?.price).toBe(4000);
    // subtotal = 10,000; 10% discount = 1,000; taxable = 9,000; 14% VAT = 1,260; total = 10,260
    expect(totals.subtotal).toBe(10000);
    expect(totals.discountAmount).toBe(1000);
    expect(totals.taxableBase).toBe(9000);
    expect(totals.vatAmount).toBe(1260);
    expect(totals.total).toBe(10260);

    const recomputed = computeQuotationTotals(quotation.items, quotation.options);
    expect(recomputed).toEqual(totals);
  });

  it("extracts <CREATE_QUOTATION> commands cleanly and strips raw tags", () => {
    const aiText = `حاضر يا هندسة، جهزتلك عرض السعر فوراً:
<CREATE_QUOTATION>
\`\`\`json
{
  "client": "مصنع الرواد",
  "items": [{ "name": "سير مطاط 60 سم", "qty": 3, "price": 2500 }],
  "showVat": false
}
\`\`\`
</CREATE_QUOTATION>`;

    const parsed = extractCreateQuotationCommand(aiText);
    expect(parsed.found).toBe(true);
    expect(parsed.cleanedText).toBe("حاضر يا هندسة، جهزتلك عرض السعر فوراً:");
    expect(parsed.draft?.client).toBe("مصنع الرواد");
    expect(parsed.draft?.items).toHaveLength(1);

    const malformed = extractCreateQuotationCommand("تمام <CREATE_QUOTATION>{bad json</CREATE_QUOTATION>");
    expect(malformed.found).toBe(true);
    expect(malformed.draft).toBeNull();
    expect(malformed.cleanedText).toBe("تمام");

    expect(parseJsonObjectFromAi('```json\n{"client":"Test","items":[]}\n```')).toEqual({
      client: "Test",
      items: [],
    });
  });

  it("executes SmartCycle end-to-end: WhatsApp trigger -> AI <CREATE_QUOTATION> -> Supabase save -> deep-link card", async () => {
    const jid = "201055555555@s.whatsapp.net";
    const sentTexts: string[] = [];
    const savedRows: Array<Record<string, unknown>> = [];

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/rest/v1/quotations")) {
        if ((init?.method || "GET").toUpperCase() === "POST") {
          const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
          savedRows.push(body);
          return new Response(JSON.stringify([body]), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return origFetch(url, init);
    }) as unknown as typeof fetch;

    try {
      const mockEvolution = {
        isConfigured: () => true,
        sendTyping: vi.fn().mockResolvedValue(undefined),
        fetchChatHistory: vi.fn().mockResolvedValue([]),
        sendText: vi.fn().mockImplementation(async (_to: string, text: string) => {
          sentTexts.push(text);
          return { messageId: "SMART-1" };
        }),
      };

      const mockAiClient = {
        lastSuccess: null,
        generateReply: vi.fn().mockResolvedValue({
          text: `تم يا هندسة!\n<CREATE_QUOTATION>{"client":"شركة الشروق","items":[{"name":"سير 50 سم × 10 متر","qty":2,"price":3000}],"showVat":true,"vatRate":14}</CREATE_QUOTATION>`,
          provider: "requesty",
          model: "google/gemma-4-31b-it",
          latencyMs: 850,
        }),
      };

      const store = new ChatContextStore({
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "anon-key",
      });
      const agent = new FathyAgent({
        config: {
          evolutionInstance: "starbelt",
          maxHistoryMessages: 50,
          publicBaseUrl: "https://maker.starbelt.com.eg",
          supabaseUrl: "https://example.supabase.co",
          supabaseAnonKey: "anon-key",
          providers: [],
        },
        evolution: mockEvolution,
        contextStore: store,
        aiClient: mockAiClient,
      });

      const res = await agent.handleWebhookPayload({
        event: "messages.upsert",
        instance: "starbelt",
        data: {
          key: { id: "quote-req-1", remoteJid: jid, fromMe: false },
          pushName: "م. شريف",
          messageTimestamp: 1700000500,
          message: { conversation: "يا فتحي اعمل عرض سعر لشركة الشروق 2 سير 50 سم × 10 متر بسعر 3000 شامل ضريبة" },
        },
      });

      const firstResult = res.results?.[0] as {
        replied?: boolean;
        createdQuotation?: { id: string; total: number; shareUrl: string; savedToCloud: boolean };
      };
      expect(firstResult?.replied).toBe(true);
      expect(firstResult?.createdQuotation?.savedToCloud).toBe(true);
      expect(firstResult?.createdQuotation?.total).toBe(6840);
      expect(savedRows).toHaveLength(1);
      expect(savedRows[0]?.client).toBe("شركة الشروق");
      expect(savedRows[0]?.total).toBe(6840);

      // Verify WhatsApp reply contains the clickable deep-link and NEVER leaks raw <CREATE_QUOTATION> tags
      expect(sentTexts).toHaveLength(1);
      expect(sentTexts[0]).not.toContain("<CREATE_QUOTATION>");
      expect(sentTexts[0]).toContain("https://maker.starbelt.com.eg/?quote=");
      expect(sentTexts[0]).toContain("6,840");
      expect(agent.stats.quotationsCreated).toBe(1);

      const expectedUrl = buildQuotationShareUrl(
        firstResult.createdQuotation!.id,
        "https://maker.starbelt.com.eg",
      );
      expect(sentTexts[0]).toContain(expectedUrl);

      const card = formatQuotationWhatsAppCard(
        {
          id: "q_test1234",
          number: "SB-2026-1234",
          client: "عميل تجريبي",
          date: "26/11/2026",
          items: [{ id: "it_1", name: "سير", qty: 1, price: 500 }],
          options: { showVat: false, vatRate: 14 },
        },
        { subtotal: 500, discountAmount: 0, taxableBase: 500, vatAmount: 0, total: 500 },
        "https://maker.starbelt.com.eg",
      );
      expect(card).toContain("https://maker.starbelt.com.eg/?quote=q_test1234");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("renders & sends the official PDF document on WhatsApp when creating or resending a quotation", async () => {
    const jid = "201077777777@s.whatsapp.net";
    const sentDocs: Array<{ to: string; fileName: string; mimetype: string; base64: string; caption: string }> = [];

    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/rest/v1/quotations")) {
        if ((init?.method || "GET").toUpperCase() === "POST") {
          const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
          return new Response(JSON.stringify([body]), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify([
            {
              id: "q_existing1",
              number: "SB-2026-9999",
              client: "شركة النيل",
              data: {
                id: "q_existing1",
                number: "SB-2026-9999",
                client: "شركة النيل",
                date: "26/11/2026",
                items: [{ id: "it_1", name: "سير 50 سم", qty: 2, price: 1500 }],
                notes: [],
                approver: "تسنيم",
                thankYou: "ولكم جزيل الشكر",
                options: { showVat: false, vatRate: 14, showDiscount: false, discountType: "percent", discountPercent: 0, discountValue: 0, showNumberAndDate: true, showWords: true, showValidity: false, validityDays: 30, showWatermark: true },
                schemaVersion: 1,
              },
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return origFetch(url, init);
    }) as unknown as typeof fetch;

    try {
      const mockEvolution = {
        isConfigured: () => true,
        sendTyping: vi.fn().mockResolvedValue(undefined),
        fetchChatHistory: vi.fn().mockResolvedValue([]),
        sendText: vi.fn().mockResolvedValue({ messageId: "TXT-1" }),
        sendDocument: vi.fn().mockImplementation(async (to: string, payload: { fileName: string; mimetype: string; base64: string; caption: string }) => {
          sentDocs.push({ to, ...payload });
          return { messageId: `PDF-${sentDocs.length}` };
        }),
      };

      const mockPdfGen = {
        isAvailable: () => true,
        renderQuotationToPdf: vi.fn().mockImplementation(async (q: { client: string }) => ({
          buffer: Buffer.from("%PDF-1.4 mock-starbelt-pdf"),
          base64: Buffer.from("%PDF-1.4 mock-starbelt-pdf").toString("base64"),
          fileName: buildPdfFileName(q),
          byteLength: 42000,
          durationMs: 1100,
        })),
      };

      const mockAiClient = {
        lastSuccess: null,
        generateReply: vi
          .fn()
          .mockResolvedValueOnce({
            text: `جهزتلك عرض السعر وبعتلك الـ PDF حالاً:\n<CREATE_QUOTATION>{"client":"مصنع الأمل","items":[{"name":"سير 40 سم","qty":2,"price":2000}],"showVat":false}</CREATE_QUOTATION>`,
            provider: "groq",
            model: "qwen/qwen3.8-27b",
            latencyMs: 600,
          })
          .mockResolvedValueOnce({
            text: `اتفضل ملف PDF عرض سعر شركة النيل:\n<SEND_QUOTATION_PDF>{"id":"q_existing1","client":"شركة النيل"}</SEND_QUOTATION_PDF>`,
            provider: "groq",
            model: "qwen/qwen3.8-27b",
            latencyMs: 500,
          }),
      };

      const agent = new FathyAgent({
        config: {
          evolutionInstance: "starbelt",
          maxHistoryMessages: 50,
          publicBaseUrl: "https://maker.starbelt.com.eg",
          supabaseUrl: "https://example.supabase.co",
          supabaseAnonKey: "anon-key",
          providers: [],
        },
        evolution: mockEvolution,
        contextStore: new ChatContextStore({
          supabaseUrl: "https://example.supabase.co",
          supabaseAnonKey: "anon-key",
        }),
        aiClient: mockAiClient,
        pdfGenerator: mockPdfGen,
      });

      // 1. Create new quotation -> sends real PDF document directly on WhatsApp!
      const r1 = await agent.handleWebhookPayload({
        event: "messages.upsert",
        instance: "starbelt",
        data: {
          key: { id: "pdf-req-1", remoteJid: jid, fromMe: false },
          messageTimestamp: 1700000600,
          message: { conversation: "يا فتحي اعمل عرض سعر لمصنع الأمل 2 سير 40 سم بـ 2000" },
        },
      });
      expect((r1.results?.[0] as { pdfSent?: { fileName: string } })?.pdfSent?.fileName).toContain("مصنع الأمل");
      expect(sentDocs).toHaveLength(1);
      expect(sentDocs[0]?.mimetype).toBe("application/pdf");
      expect(sentDocs[0]?.caption).toContain("https://maker.starbelt.com.eg/?quote=");
      expect(sentDocs[0]?.caption).not.toContain("<CREATE_QUOTATION>");

      // 2. Resend existing quotation PDF via <SEND_QUOTATION_PDF>
      const parsedCmd = extractSendPdfCommand('تمام <SEND_QUOTATION_PDF>{"id":"q_existing1"}</SEND_QUOTATION_PDF>');
      expect(parsedCmd.found).toBe(true);
      expect(parsedCmd.query?.id).toBe("q_existing1");

      const r2 = await agent.handleWebhookPayload({
        event: "messages.upsert",
        instance: "starbelt",
        data: {
          key: { id: "pdf-req-2", remoteJid: jid, fromMe: false },
          messageTimestamp: 1700000610,
          message: { conversation: "يا فتحي ابعتلي PDF عرض سعر شركة النيل" },
        },
      });
      expect((r2.results?.[0] as { pdfSent?: { fileName: string } })?.pdfSent?.fileName).toContain("شركة النيل");
      expect(sentDocs).toHaveLength(2);
      expect(agent.stats.pdfsSent).toBe(2);
      expect(escapeJsonForScript({ x: "</script>" })).not.toContain("</script>");

      // Sanitizer strips hallucinated duplicate cards/fake SB numbers before the real server card
      const hallucinated = `تم إنشاء عرض السعر لعميل شركة الاختبار.
📄 تم تجهيز عرض السعر بنجاح!
🔢 رقم العرض: SB-2026-9999
https://maker.starbelt.com.eg/?quote=SB-2026-9999`;
      expect(sanitizeQuotationIntroText(hallucinated)).toBe("تم إنشاء عرض السعر لعميل شركة الاختبار.");

      // Groq ITPM budget trimmer preserves system prompt + newest turns within budget
      const bigHistory = [
        { role: "system", content: "SYSTEM" },
        { role: "user", content: "OLD_MSG ".repeat(800) },
        { role: "assistant", content: "OLD_REPLY ".repeat(400) },
        { role: "user", content: "LATEST_USER_REQUEST" },
      ];
      const trimmed = fitMessagesToBudget(bigHistory, 4500);
      expect(trimmed[0]?.role).toBe("system");
      expect(trimmed[trimmed.length - 1]?.content).toBe("LATEST_USER_REQUEST");
      const historyChars = trimmed
        .slice(1)
        .reduce((s: number, m: { content: string }) => s + m.content.length, 0);
      expect(historyChars).toBeLessThanOrEqual(4500);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("Bilingual Voice-to-Text (Egyptian Arabic + English Belt Specs)", () => {
  it("validates Star Belt ElevenLabs keyterms glossary constraints and normalizes mixed Arabic/English belt specs", () => {
    // ElevenLabs constraints: <= 100 terms (no 20s min penalty), <= 50 chars, <= 5 words, no <>[]{}\
    expect(STARBELT_STT_KEYTERMS.length).toBeGreaterThan(50);
    expect(STARBELT_STT_KEYTERMS.length).toBeLessThanOrEqual(100);
    for (const term of STARBELT_STT_KEYTERMS) {
      expect(term.length).toBeLessThanOrEqual(50);
      expect(term.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
      expect(term).not.toMatch(/[<>[\]{}\\]/);
    }

    expect(extensionForAudioMime("audio/ogg; codecs=opus")).toBe("ogg");
    expect(extensionForAudioMime("audio/webm;codecs=opus")).toBe("webm");

    const normalized = normalizeBilingualBeltTranscript(
      "يا فتحي عايزين سير بي في سي أخضر تو بلاي و سير تايمنج بيلت اتش تي دي 8M و سير بي يو فود جريد",
    );
    expect(normalized).toContain("PVC");
    expect(normalized).toContain("2 ply");
    expect(normalized).toContain("Timing Belt");
    expect(normalized).toContain("HTD 8M");
    expect(normalized).toContain("PU");
    expect(normalized).toContain("Food Grade");
  });

  it("calls ElevenLabs Scribe v3 with ar+en secondary_language_codes, digits, and keyterms, and falls back to Groq Whisper", async () => {
    const capturedCalls: Array<{ url: string; headers: Record<string, string>; formFields: Record<string, string[]> }> = [];
    const origFetch = globalThis.fetch;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      const fields: Record<string, string[]> = {};
      if (form && typeof form.forEach === "function") {
        form.forEach((val, key) => {
          fields[key] = fields[key] || [];
          fields[key].push(typeof val === "string" ? val : `[Blob:${val.type}]`);
        });
      }
      capturedCalls.push({
        url: String(url),
        headers: (init?.headers || {}) as Record<string, string>,
        formFields: fields,
      });

      if (String(url).includes("elevenlabs.io")) {
        return new Response(
          JSON.stringify({
            text: "يا فتحي اعمل عرض سعر 2 سير PVC أخضر 2 ply عرض 50 سم في 12 متر",
            language_code: "ar",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          text: "عايز سير Timing Belt HTD 8M",
          language: "arabic",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      const stt = new FathySttClient({
        elevenLabsApiKey: "xi-test-key",
        elevenLabsModel: "scribe_v3",
        useKeyterms: true,
        groqApiKey: "gsk-test-key",
      });

      const fakeAudio = Buffer.alloc(512, 0x4f);
      const res = await stt.transcribeAudio(fakeAudio, { mimetype: "audio/ogg; codecs=opus" });
      expect(res.provider).toBe("elevenlabs");
      expect(res.model).toBe("scribe_v3");
      expect(res.text).toContain("PVC");
      expect(res.text).toContain("2 ply");

      expect(capturedCalls[0]?.url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
      expect(capturedCalls[0]?.headers["xi-api-key"]).toBe("xi-test-key");
      expect(capturedCalls[0]?.formFields.model_id).toEqual(["scribe_v3"]);
      expect(capturedCalls[0]?.formFields.language_code).toEqual(["ar"]);
      expect(capturedCalls[0]?.formFields.secondary_language_codes).toEqual(["en"]);
      expect(capturedCalls[0]?.formFields.numbers_format).toEqual(["digits"]);
      expect(capturedCalls[0]?.formFields.keyterms?.length).toBe(STARBELT_STT_KEYTERMS.length);

      // Groq-only fallback (when ELEVENLABS_API_KEY is not set)
      const groqOnly = new FathySttClient({ groqApiKey: "gsk-test-key" });
      const groqRes = await groqOnly.transcribeAudio(fakeAudio, { mimetype: "audio/ogg" });
      expect(groqRes.provider).toBe("groq");
      expect(groqRes.model).toBe("whisper-large-v3");
      expect(groqRes.text).toContain("Timing Belt HTD 8M");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("transcribes an incoming WhatsApp voice note in Egyptian Arabic + English and triggers Fathy automatically", async () => {
    const jid = "201088888888@s.whatsapp.net";
    const sentTexts: string[] = [];

    const mockEvolution = {
      isConfigured: () => true,
      sendTyping: vi.fn().mockResolvedValue(undefined),
      fetchChatHistory: vi.fn().mockResolvedValue([]),
      getMediaBase64: vi.fn().mockResolvedValue({
        buffer: Buffer.alloc(600, 0x55),
        mimetype: "audio/ogg; codecs=opus",
      }),
      sendText: vi.fn().mockImplementation(async (_to: string, text: string) => {
        sentTexts.push(text);
        return { messageId: "VOICE-REPLY-1" };
      }),
    };

    const mockStt = {
      isConfigured: () => true,
      getConfiguredProviders: () => ["elevenlabs/scribe_v3"],
      lastSuccess: null,
      transcribeAudio: vi.fn().mockResolvedValue({
        text: "يا فتحي عايزين عرض سعر لـ 2 سير PVC أخضر 2 ply عرض 50 سم في 10 متر",
        provider: "elevenlabs",
        model: "scribe_v3",
        languageCode: "ar",
        latencyMs: 720,
      }),
    };

    const capturedPrompts: string[] = [];
    const mockAiClient = {
      lastSuccess: null,
      generateReply: vi.fn().mockImplementation(async (args: { messages: Array<{ content: string }> }) => {
        capturedPrompts.push(args.messages.map((m) => m.content).join("\n"));
        return {
          text: "تمام يا فندم، سمعت رسالتك الصوتية بوضوح!",
          provider: "groq",
          model: "qwen/qwen3.8-27b",
          latencyMs: 420,
        };
      }),
    };

    const agent = new FathyAgent({
      config: { evolutionInstance: "starbelt", maxHistoryMessages: 50, transcribeAudio: true, maxAudioSeconds: 180, providers: [] },
      evolution: mockEvolution,
      contextStore: new ChatContextStore(),
      aiClient: mockAiClient,
      sttClient: mockStt,
    });

    const res = await agent.handleWebhookPayload({
      event: "messages.upsert",
      instance: "starbelt",
      data: {
        key: { id: "voice-msg-1", remoteJid: jid, fromMe: false },
        pushName: "م. شريف",
        messageTimestamp: 1700000900,
        message: {
          audioMessage: {
            ptt: true,
            seconds: 8,
            mimetype: "audio/ogg; codecs=opus",
          },
        },
      },
    });

    const first = res.results?.[0] as { replied?: boolean; voiceTranscript?: { text: string; provider: string } };
    expect(first?.replied).toBe(true);
    expect(first?.voiceTranscript?.provider).toBe("elevenlabs");
    expect(first?.voiceTranscript?.text).toContain("PVC أخضر 2 ply");
    expect(capturedPrompts[0]).toContain("[رسالة صوتية]:");
    expect(capturedPrompts[0]).toContain("PVC أخضر 2 ply");
    expect(agent.stats.voiceNotesTranscribed).toBe(1);
    expect(sentTexts).toHaveLength(1);
  });
});
