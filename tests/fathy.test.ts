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
import { FathyAiClient, cleanAssistantReply } from "../server/aiClient.mjs";
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
  formatQuotationWhatsAppCard,
  parseJsonObjectFromAi,
} from "../server/quotationTool.mjs";

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
});
