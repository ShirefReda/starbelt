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
- ردودك مناسبة للواتساب: واضحة، مرتبة، مباشرة، ومختصرة بذكاء (استخدم *الخط العريض* والنقاط عند الحاجة)، ولا تكتب مقالات طويلة إلا لو طلب المستخدم تفصيلاً. أجب دائماً بنص واضح ومفيد ولا تكتفِ بإيموجي فقط.
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
    // Reasoning models on Logfare need more time; Requesty & UnoRouter are fast (15s timeout)
    const isLogfare = route.provider === "logfare";
    const isRequesty = route.provider === "requesty";
    const timeoutMs = isLogfare ? 25000 : isRequesty ? 15000 : 14000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
      const requestBody = {
        model: route.model,
        messages: fullMessages,
        temperature: 0.65,
        max_tokens: isLogfare ? 4096 : isRequesty ? 2048 : 1500,
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
          // Concurrency 429 on Requesty recovers quickly (~5s), rate-limit 429 uses header or default
          const isConcurrencyLimit = /concurrent/i.test(errText);
          this.setCooldown(
            route,
            isConcurrencyLimit
              ? 6
              : Number.isFinite(retryHeader) && retryHeader > 0
                ? retryHeader
                : route.defaultCooldownSec,
          );
        } else if (
          res.status === 400 ||
          res.status === 402 ||
          res.status === 404 ||
          res.status === 410 ||
          res.status === 422
        ) {
          this.setCooldown(route, 300);
        }
        throw new Error(`${route.provider}/${route.model}: HTTP ${res.status} (${errText})`);
      }

      const data = await res.json();
      const choice = data?.choices?.[0];
      const rawContent = choice?.message?.content;
      const cleaned = cleanAssistantReply(rawContent);

      // Reject empty or single-emoji-only replies (no letters or digits at all)
      const hasMeaningfulText = /[a-zA-Z0-9\u0600-\u06FF]/.test(cleaned);
      if (!cleaned || !hasMeaningfulText) {
        this.setCooldown(route, 20);
        throw new Error(`${route.provider}/${route.model}: empty or emoji-only content`);
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
   * Call AI providers strictly in priority order (Requesty on top, then UnoRouter & Logfare)
   * with 1 concurrent request per provider (respects Requesty's free concurrency=1 limit)
   * and a hard total deadline so a chat queue can never stall.
   */
  async generateReply({ messages, isGroup = false, remoteJid = "", quotationsSummary = "" }) {
    if (!this.providers || this.providers.length === 0) {
      throw new Error(
        "No AI providers configured. Set REQUESTY_API_KEY, UNOROUTER_API_KEY, or LOGFARE_API_KEY.",
      );
    }

    const systemPrompt = this.buildSystemPrompt({ isGroup, remoteJid, quotationsSummary });
    const fullMessages = [{ role: "system", content: systemPrompt }, ...messages];

    const now = Date.now();
    const deadlineAt = now + 50_000;
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
    const maxAttempts = Math.min(ordered.length, 8);

    for (let i = 0; i < maxAttempts; i++) {
      if (Date.now() > deadlineAt) {
        errors.push("overall_deadline_exceeded");
        break;
      }
      const route = ordered[i];
      try {
        return await this.callSingleRoute(route, fullMessages);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Fathy AI] Fallback from ${route.provider}/${route.model}: ${msg}`);
        errors.push(msg);
      }
    }

    throw new Error(`All AI providers failed: ${errors.slice(0, 6).join(" | ")}`);
  }
}
