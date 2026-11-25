/**
 * Multi-provider OpenAI-compatible AI engine for Fathy AI.
 *
 * Features:
 * - Interleaved fallback across UnoRouter (Top 10 smartest free models) + Logfare (Premium 40 req/min)
 * - Automatic per-model cooldown tracking on HTTP 429 / 503 (never wastes time retrying rate-limited routes)
 * - Clean extraction of final text (strips reasoning tags if leaked into content)
 */

const FATHY_BASE_SYSTEM_PROMPT = `أنت "فتحي" (Fathy AI) — المساعد الذكي المدمج مباشرة داخل رقم واتساب شريف رضا (01208840531) التابع لشركة ستار بيلت لتصنيع السيور (Star Belt).

هويتك وأسلوبك:
- أنت ذكي جداً، سريع البديهة، عملي، وودود.
- تتكلم بنفس لغة ولهجة الشخص الذي يكلمك: إذا كلمك بالعربي أو المصري رد عليه بمصري/عربي طبيعي واحترافي وخفيف الظل بدون مبالغة؛ وإذا كلمك بالإنجليزي رد بالإنجليزي.
- ردودك مناسبة للواتساب: واضحة، مرتبة، مباشرة، ومختصرة بذكاء (استخدم *الخط العريض* والنقاط عند الحاجة)، ولا تكتب مقالات طويلة إلا لو طلب المستخدم تفصيلاً.
- أنت ترى السياق الكامل للمحادثة السابقة في الواتساب (الرسائل السابقة، أسماء المرسلين، والتوقيت، سواء من شريف رضا صاحب الرقم أو من الطرف الآخر أو أعضاء الجروب). استخدم هذا السياق الكامل لفهم القصة كاملة والرد بذكاء ودقة!
- لو المستخدم طلب منك تلخيص المحادثة، أو الرد على عميل، أو صياغة رسالة، أو حساب أسعار، أو مساعدة تقنية أو عامة — نفّذ المطلوب فوراً اعتماداً على سياق الشات الكامل.
- لا تضف بادئة مثل "فتحي:" أو "🤖" في بداية ردك لأن النظام يضيفها تلقائياً.

معلومات شركة ستار بيلت (للاستخدام فقط عند السؤال عن الشركة أو عروض الأسعار):
- الاسم: شركة ستار بيلت لتصنيع السيور (Star Belt) — تصنيع وتوريد السيور الصناعية وسيور النقل.
- العنوان: العاشر من رمضان قطعة A6 بجوار الصوامع.
- البريد الإلكتروني: starbelt86@gmail.com
- أرقام التواصل: 01011074556 / 01227156258 / 01208840531 (شريف رضا - الإدارة).
- تطبيق عروض الأسعار: https://maker.starbelt.com.eg
- لو طلب أحد إيقافك في المحادثة، يمكنك تذكيره أنه يستطيع قول "خلاص يا فتحي" أو "stop fathy".`;

/**
 * Strip leaked chain-of-thought tags (e.g. <think>...</think>) and tidy whitespace.
 */
export function cleanAssistantReply(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*🤖?\s*\*?فتحي(?:\s*AI)?\s*:?\*?\s*/i, "")
    .trim();
}

export class FathyAiClient {
  constructor(providers = []) {
    this.providers = providers;
    /** @type {Map<string, number>} key -> unix ms until cooldown ends */
    this.cooldowns = new Map();
    this.lastSuccess = null;
  }

  getRouteKey(route) {
    return `${route.provider}:${route.model}`;
  }

  isInCooldown(route, now = Date.now()) {
    const until = this.cooldowns.get(this.getRouteKey(route)) || 0;
    return until > now;
  }

  setCooldown(route, seconds) {
    const sec = Math.max(5, Math.min(300, Number(seconds) || route.defaultCooldownSec || 30));
    this.cooldowns.set(this.getRouteKey(route), Date.now() + sec * 1000);
  }

  buildSystemPrompt({ isGroup, remoteJid, quotationsSummary }) {
    const cairoNow = new Intl.DateTimeFormat("ar-EG", {
      timeZone: "Africa/Cairo",
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date());

    const parts = [
      FATHY_BASE_SYSTEM_PROMPT,
      `\nالوقت الحالي في القاهرة: ${cairoNow}`,
      `نوع المحادثة الحالية: ${isGroup ? "جروب واتساب" : "محادثة خاصة (DM)"} (${remoteJid})`,
    ];

    if (quotationsSummary) {
      parts.push(
        `\nأحدث عروض الأسعار المسجلة في نظام ستار بيلت (Supabase) — استخدمها فقط لو كان السؤال متعلقاً بعرض سعر أو عميل:\n${quotationsSummary}`,
      );
    }

    return parts.join("\n");
  }

  /**
   * Call a single provider route with timeout + automatic cooldown handling.
   */
  async callSingleRoute(route, fullMessages, externalSignal) {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    // Reasoning models on Logfare need more time & token headroom than fast UnoRouter flash models
    const isLogfare = route.provider === "logfare";
    const timeoutMs = isLogfare ? 32000 : 16000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const requestBody = {
        model: route.model,
        messages: fullMessages,
        temperature: 0.65,
        max_tokens: isLogfare ? 4096 : 1500,
      };
      if (isLogfare) {
        requestBody.reasoning_effort = "low";
      }

      const res = await fetch(`${route.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${route.apiKey}`,
          "User-Agent": "Mozilla/5.0",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = (await res.text()).slice(0, 220);
        if (res.status === 429 || res.status === 503 || res.status === 502) {
          const retryHeader = Number.parseInt(res.headers.get("retry-after") || "", 10);
          this.setCooldown(
            route,
            Number.isFinite(retryHeader) && retryHeader > 0
              ? retryHeader
              : route.defaultCooldownSec,
          );
        } else if (res.status === 400 || res.status === 404 || res.status === 422) {
          this.setCooldown(route, 180);
        }
        throw new Error(`${route.provider}/${route.model}: HTTP ${res.status} (${errText})`);
      }

      const data = await res.json();
      const choice = data?.choices?.[0];
      const rawContent = choice?.message?.content;
      const cleaned = cleanAssistantReply(rawContent);

      if (!cleaned) {
        this.setCooldown(route, 30);
        throw new Error(`${route.provider}/${route.model}: empty content`);
      }

      const latencyMs = Date.now() - startedAt;
      this.lastSuccess = {
        provider: route.provider,
        model: route.model,
        latencyMs,
        at: new Date().toISOString(),
      };

      return {
        text: cleaned,
        provider: route.provider,
        model: route.model,
        latencyMs,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (externalSignal?.aborted) {
        throw new Error(`${route.provider}/${route.model}: cancelled (sibling won)`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (!this.isInCooldown(route)) {
        this.setCooldown(route, 25);
      }
      throw new Error(msg.startsWith(`${route.provider}/`) ? msg : `${route.provider}/${route.model}: ${msg}`);
    } finally {
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  /**
   * Call AI providers in parallel pairs (e.g. 1 Logfare + 1 UnoRouter raced simultaneously)
   * with automatic cooldown skipping and instant cancellation of the slower sibling.
   */
  async generateReply({ messages, isGroup = false, remoteJid = "", quotationsSummary = "" }) {
    if (!this.providers || this.providers.length === 0) {
      throw new Error(
        "No AI providers configured. Set UNOROUTER_API_KEY and/or LOGFARE_API_KEY in environment variables.",
      );
    }

    const systemPrompt = this.buildSystemPrompt({ isGroup, remoteJid, quotationsSummary });
    const fullMessages = [{ role: "system", content: systemPrompt }, ...messages];

    const now = Date.now();
    // Try non-cooled-down routes first; if all are in cooldown, try the ones whose cooldown expires soonest
    const ready = this.providers.filter((r) => !this.isInCooldown(r, now));
    const ordered =
      ready.length > 0
        ? ready
        : [...this.providers].sort(
            (a, b) =>
              (this.cooldowns.get(this.getRouteKey(a)) || 0) -
              (this.cooldowns.get(this.getRouteKey(b)) || 0),
          );

    const errors = [];
    const batchSize = 2;

    for (let i = 0; i < ordered.length; i += batchSize) {
      const batch = ordered.slice(i, i + batchSize);
      const batchAbort = new AbortController();

      try {
        const winner = await Promise.any(
          batch.map((route) => this.callSingleRoute(route, fullMessages, batchAbort.signal)),
        );
        batchAbort.abort();
        return winner;
      } catch (aggErr) {
        batchAbort.abort();
        if (aggErr && Array.isArray(aggErr.errors)) {
          for (const e of aggErr.errors) {
            errors.push(e instanceof Error ? e.message : String(e));
          }
        } else {
          errors.push(aggErr instanceof Error ? aggErr.message : String(aggErr));
        }
      }
    }

    throw new Error(`All AI providers failed: ${errors.slice(0, 6).join(" | ")}`);
  }
}
