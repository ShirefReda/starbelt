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
import { buildProviderChain } from "../server/config.mjs";

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

  it("cleans thinking tags, splits long WhatsApp messages, and builds interleaved provider chain", () => {
    expect(cleanAssistantReply("<think>internal thoughts</think> أهلاً بك!")).toBe("أهلاً بك!");
    expect(splitWhatsAppMessage("A".repeat(4000), 1500).length).toBeGreaterThanOrEqual(3);

    const chain = buildProviderChain({
      UNOROUTER_API_KEY: "sk-test",
      LOGFARE_API_KEY: "lfu-test",
    });
    expect(chain.length).toBeGreaterThan(10);
    expect(chain[0]?.provider).toBe("unorouter");
    expect(chain[0]?.model).toBe("gemini-3.6-flash:free");
    expect(chain[1]?.provider).toBe("logfare");
    expect(chain[1]?.model).toBe("openai/gpt-6-luna");
  });

  it("tracks per-model cooldowns in FathyAiClient", () => {
    const client = new FathyAiClient([
      {
        provider: "unorouter",
        baseUrl: "https://api.unorouter.com/v1",
        apiKey: "k",
        model: "gemini-3.6-flash:free",
        defaultCooldownSec: 65,
      },
    ]);
    const route = client.providers[0];
    expect(client.isInCooldown(route)).toBe(false);
    client.setCooldown(route, 60);
    expect(client.isInCooldown(route)).toBe(true);
  });
});
