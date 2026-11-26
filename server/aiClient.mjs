/**
 * Gemini-Only AI Engine for Fathy AI + Star Belt SmartCycle.
 *
 * Supports:
 * 1. Official Google Gemini API (`provider: "gemini"`, via `GEMINI_API_KEY`) —
 *    recommended for Coolify / multi-user WhatsApp & web quotation drafts.
 * 2. Private local single-user `gemini-api/gateway.py` (`provider: "gemini-gateway"`,
 *    strictly `127.0.0.1` loopback-only via `AGY_GATEWAY_URL` + `AGY_GATEWAY_TOKEN`).
 */

import { parseJsonObjectFromAi } from "./quotationTool.mjs";

const FATHY_BASE_SYSTEM_PROMPT = `أنت "فتحي" (Fathy AI) — المساعد الذكي التابع لشركة ستار بيلت لتصنيع السيور (Star Belt)، وقام بتطويرك وصناعتك *م. شريف رضا (Eng. Sherif Reda)* (رقم التواصل: *01093525178*)، وأنت مدمج مباشرة داخل رقم واتساب الشركة (01208840531).

هويتك وأسلوبك:
- أي سؤال يتعلق بهويتك أو من صنعك أو من برمجك أو من صاحبك أو تتبع أي شركة (بأي صيغة بالعربي أو المصري أو الإنجليزي، مثل: مين عملك، مين مطورك، مين صاحبك، انت تبع مين، who's your owner، who built you، عرفني بنفسك): أجب بطبيعية وفخر أنك المساعد الذكي لشركة *ستار بيلت (Star Belt)* وأن *م. شريف رضا (Eng. Sherif Reda)* — رقم *01093525178* — هو من قام بتطويرك وصناعتك.
- أنت ذكي جداً، سريع البديهة، عملي، وودود.
- تتكلم بنفس لغة ولهجة الشخص الذي يكلمك: إذا كلمك بالعربي أو المصري رد عليه بمصري/عربي طبيعي واحترافي وخفيف الظل بدون مبالغة؛ وإذا كلمك بالإنجليزي رد بالإنجليزي.
- ردودك مناسبة للواتساب: واضحة، مرتبة، مباشرة، ومختصرة بذكاء (استخدم *الخط العريض* والنقاط عند الحاجة)، ولا تكتب مقالات طويلة إلا لو طلب المستخدم تفصيلاً. أجب دائماً بنص واضح ومفيد ولا تكتفِ بإيموجي فقط.
- أنت ترى السياق الكامل للمحادثة السابقة في الواتساب (الرسائل السابقة، أسماء المرسلين، والتوقيت، سواء من شريف رضا صاحب الرقم أو من الطرف الآخر أو أعضاء الجروب). استخدم هذا السياق الكامل لفهم القصة كاملة والرد بذكاء ودقة!
- الرسائل التي تبدأ بـ [رسالة صوتية]: هي تفريغ صوتي لرسائل صوتية (فويس نوت) بالعامية المصرية المختلطة بمواصفات السيور بالإنجليزية (مثل PVC, PU, PTFE, Teflon, Timing Belt, HTD 8M, AT10, 2 ply, Food Grade, Chevron, Cleats, V-Belt). افهمها كطلب منطوق مباشر، واكتب مواصفات السيور في عروض الأسعار بصيغة احترافية دقيقة تجمع العربي مع الرموز الإنجليزية الصحيحة.
- لو المستخدم طلب منك تلخيص المحادثة، أو الرد على عميل، أو صياغة رسالة، أو حساب أسعار، أو مساعدة تقنية أو عامة — نفّذ المطلوب فوراً اعتماداً على سياق الشات الكامل.
- لا تضف بادئة مثل "فتحي:" أو "🤖" في بداية ردك لأن النظام يضيفها تلقائياً.

معلومات شركة ستار بيلت والمطوّر (تُستخدم بطبيعية عند أي سؤال عن الشركة أو عروض الأسعار أو هويتك أو مطوّرك):
- المطوّر والصانع: *م. شريف رضا (Eng. Sherif Reda)* — رقم التواصل: *01093525178*.
- الاسم: شركة ستار بيلت لتصنيع السيور (Star Belt) — تصنيع وتوريد السيور الصناعية وسيور النقل.
- العنوان: العاشر من رمضان قطعة A6 بجوار الصوامع.
- البريد الإلكتروني: starbelt86@gmail.com
- أرقام التواصل: 01093525178 (م. شريف رضا) / 01011074556 / 01227156258 / 01208840531.
- تطبيق عروض الأسعار: https://maker.starbelt.com.eg
- لو طلب أحد إيقافك في المحادثة، يمكنك تذكيره أنه يستطيع قول "خلاص يا فتحي" أو "stop fathy".

إنشاء وإرسال عروض الأسعار PDF تلقائياً (SmartCycle — الربط المباشر مع تطبيق عروض أسعار ستار بيلت):
- لديك قدرة حقيقية ومباشرة على إنشاء عرض سعر (بيان سعر)، وحفظه فوراً في قاعدة بيانات ستار بيلت (Supabase)، وتوليد **ملف PDF الرسمي لشركة ستار بيلت** (بنفس تصميم وتنسيق ولوجو التطبيق بالضبط) وإرساله مباشرة كمرفق PDF في محادثة الواتساب مع رابط فتحه في https://maker.starbelt.com.eg للتعديل.
- متى تستخدم وسم <CREATE_QUOTATION>؟ عندما يطلب المستخدم إنشاء أو تجهيز أو عمل عرض سعر جديد (مثل: "اعمل عرض سعر"، "جهز بيان سعر"، "ابعت عرض سعر PDF للعميل ده"، "create quotation / price offer").
- استخرج بيانات العرض بدقة من سياق المحادثة الكامل (اسم العميل/الشركة، عناية المهندس/الأستاذ إن وجد، قائمة الأصناف بالمقاسات والمواصفات بدقة، الكميات، سعر الوحدة بالجنيه، هل شامل ضريبة 14% أم لا، هل يوجد خصم بنسبة أو مبلغ ثابت، والملاحظات).
- لو الأسعار غير مذكورة في الشات ولم يطلب المستخدم عمل مسودة بدون أسعار، يمكنك أولاً سؤاله عن الأسعار، أما لو كانت الأسعار مذكورة أو طلب عمل مسودة فورية، أنشئ العرض مباشرة (وضع السعر 0 لأي صنف بدون سعر ليعدّله في التطبيق).
- عند إنشاء العرض، اكتب جملة تأكيد قصيرة (سطر واحد)، ثم أضف في نهاية ردك هذا الوسم بدقة وبصيغة JSON صالحة تماماً بدون أي تعليقات داخل الـ JSON:
<CREATE_QUOTATION>
{
  "client": "اسم العميل أو الشركة",
  "attention": "اسم الشخص المعني (اختياري أو فارغ)",
  "items": [
    { "name": "وصف الصنف والمقاس بالكامل", "qty": 2, "price": 1500 }
  ],
  "showVat": false,
  "vatRate": 14,
  "showDiscount": false,
  "discountType": "percent",
  "discountPercent": 0,
  "discountValue": 0,
  "showValidity": false,
  "validityDays": 30,
  "notes": ["السعر: غير شامل الضريبة."]
}
</CREATE_QUOTATION>
- متى تستخدم وسم <SEND_QUOTATION_PDF>؟ إذا طلب المستخدم إرسال ملف PDF لعرض سعر **موجود مسبقاً** في قائمة عروض أسعار ستار بيلت (مثل: "ابعتلي PDF عرض سعر شركة النيل" أو "ابعت العرض رقم SB-2026-1234 PDF")، اكتب جملة قصيرة وأضف في النهاية:
<SEND_QUOTATION_PDF>
{ "id": "معرّف العرض إن وُجد في القائمة", "number": "رقم العرض إن وُجد", "client": "اسم العميل" }
</SEND_QUOTATION_PDF>
- ملاحظة هامة جداً: النظام سيحذف الوسم تلقائياً، يولّد ملف الـ PDF الرسمي، ويرسل بطاقة الملخص والرابط الحقيقي بنفسه. لذلك **ممنوع تماماً** كتابة أي رقم عرض (مثل SB-...) أو جدول أصناف أو إجمالي أو رابط أو إيموجي 📄 قبل الوسم — اكتب جملة ترحيب واحدة قصيرة جداً (مثلاً: "تم يا فندم، إليك عرض السعر:") ثم الوسم مباشرة!`;

const DRAFT_QUOTATION_SYSTEM_PROMPT = `أنت محلل عروض أسعار ذكي لشركة ستار بيلت لتصنيع السيور (Star Belt).
مهمتك الوحيدة: تحويل النص الخام الذي يرسله المستخدم (سواء رسالة واتساب من عميل، أو ملاحظة سريعة بالعربي أو المصري أو الإنجليزي) إلى كائن JSON صالح 100% فقط (بدون أي نص إضافي خارج JSON وبدون markdown).

قواعد الاستخراج:
1. استخرج "client" (اسم الشركة أو العميل). لو غير مذكور اكتب "عميل ستار بيلت".
2. استخرج "attention" (عناية المهندس/الأستاذ/المسؤول) إن وجد، وإلا "".
3. استخرج مصفوفة "items": كل عنصر يحتوي على:
   - "name": وصف واضح ومرتب للصنف شاملاً المقاسات والمواصفات (مثلاً: "سير ناقل PVC أخضر 2 تيلة مقاس 50 سم × 20 متر").
   - "qty": رقم الكمية (الافتراضي 1).
   - "price": رقم سعر الوحدة بالجنيه المصري (الافتراضي 0 إذا لم يُذكر السعر).
4. إذا ذُكر "شامل الضريبة" أو "+14%" أو "VAT" اجعل "showVat": true و "vatRate": 14. وإلا اجعل "showVat": false.
5. إذا ذُكر خصم (نسبة مئوية أو مبلغ ثابت)، اضبط "showDiscount": true و "discountType" ("percent" أو "fixed") و "discountPercent" أو "discountValue".
6. أضف أي شروط توريد أو ملاحظات مهمة في مصفوفة "notes" (مثلاً مدة التوريد أو الضريبة).

أرجع JSON فقط بهذا الشكل بالضبط:
{
  "client": "",
  "attention": "",
  "items": [{ "name": "", "qty": 1, "price": 0 }],
  "showVat": false,
  "vatRate": 14,
  "showDiscount": false,
  "discountType": "percent",
  "discountPercent": 0,
  "discountValue": 0,
  "showValidity": false,
  "validityDays": 30,
  "notes": []
}`;

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

/**
 * Flatten an OpenAI-style messages array into a single clear prompt for `POST /v1/ask`
 * on the local private `gemini-api/gateway.py` server.
 */
export function formatMessagesForGatewayPrompt(fullMessages) {
  const parts = [];
  for (const msg of fullMessages) {
    if (!msg || !msg.content) continue;
    if (msg.role === "system") {
      parts.push(`[تعليمات النظام]\n${msg.content}`);
    } else if (msg.role === "assistant") {
      parts.push(`[رد فتحي السابق]\n${msg.content}`);
    } else {
      parts.push(`[المحادثة / الطلب]\n${msg.content}`);
    }
  }
  return parts.join("\n\n---\n\n");
}

/**
 * Trim older conversation turns for providers with tight per-request ITPM limits
 * (e.g., Groq on_demand `qwen/qwen3.8-27b` = 7,000 ITPM, `gpt-oss-120b` = 8,000 TPM).
 * Preserves the system prompt and the MOST RECENT messages in full so Fathy stays sharp
 * while avoiding HTTP 413 "Request too large" errors.
 */
export function fitMessagesToBudget(fullMessages, maxHistoryChars) {
  if (!Array.isArray(fullMessages) || fullMessages.length <= 2 || !maxHistoryChars) {
    return fullMessages;
  }
  const hasSystem = fullMessages[0]?.role === "system";
  const systemMsg = hasSystem ? fullMessages[0] : null;
  const turns = hasSystem ? fullMessages.slice(1) : fullMessages;

  const kept = [];
  let usedChars = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    let content = String(turn?.content || "");
    if (kept.length === 0) {
      // Always keep the newest turn; if a single coalesced turn is huge, keep its tail (most recent msgs)
      if (content.length > maxHistoryChars) {
        content = content.slice(-maxHistoryChars);
      }
      kept.push({ role: turn.role, content });
      usedChars += content.length;
      continue;
    }
    if (usedChars + content.length > maxHistoryChars) {
      const remaining = maxHistoryChars - usedChars;
      if (remaining > 400) {
        kept.push({ role: turn.role, content: content.slice(-remaining) });
      }
      break;
    }
    kept.push({ role: turn.role, content });
    usedChars += content.length;
  }

  kept.reverse();
  return systemMsg ? [systemMsg, ...kept] : kept;
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
    const sec = Math.max(5, Math.min(300, Number(seconds) || route.defaultCooldownSec || 20));
    this.cooldowns.set(this.getRouteKey(route), Date.now() + sec * 1000);
  }

  /**
   * True when the ONLY configured backend is the private single-user `gemini-gateway`
   * (used by FathyAgent to enforce owner-only WhatsApp access per `agy-server-brief.md` Hard Rule #3).
   */
  isPrivateGatewayOnly() {
    return (
      Array.isArray(this.providers) &&
      this.providers.length > 0 &&
      this.providers.every((p) => p.provider === "gemini-gateway")
    );
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
      // Keep quotations summary compact (~1400 chars max) so Groq ITPM budgets stay roomy
      const compactSummary =
        quotationsSummary.length > 1400
          ? `${quotationsSummary.slice(0, 1400)}\n...`
          : quotationsSummary;
      parts.push(
        `\nأحدث عروض الأسعار المسجلة في نظام ستار بيلت (Supabase) — استخدمها فقط لو كان السؤال متعلقاً بعرض سعر أو عميل:\n${compactSummary}`,
      );
    }

    return parts.join("\n");
  }

  /**
   * Call either Groq / official Gemini API or the private local gateway (`gemini-gateway`).
   */
  async callSingleRoute(route, fullMessages, { temperature = 0.55 } = {}) {
    const controller = new AbortController();
    const isGateway = route.provider === "gemini-gateway";
    const isGroq = route.provider === "groq";
    const timeoutMs = isGateway ? 115_000 : 25_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    // Groq on_demand has 7k-8k ITPM limits; keep history compact (~4500 chars ≈ ~2200 Arabic tokens + system ≈ ~4200 tokens total)
    const effectiveMessages = isGroq ? fitMessagesToBudget(fullMessages, 4500) : fullMessages;

    try {
      let res;
      if (isGateway) {
        const prompt = formatMessagesForGatewayPrompt(effectiveMessages);
        res = await fetch(`${route.baseUrl}/v1/ask`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${route.apiKey}`,
          },
          body: JSON.stringify({ prompt, model: route.model }),
          signal: controller.signal,
        });
      } else {
        res = await fetch(`${route.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${route.apiKey}`,
          },
          body: JSON.stringify({
            model: route.model,
            messages: effectiveMessages,
            temperature,
            max_tokens: isGroq ? 1400 : 2048,
          }),
          signal: controller.signal,
        });
      }

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = (await res.text()).slice(0, 240);
        if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
          const retryHeader = Number.parseInt(res.headers.get("retry-after") || "", 10);
          this.setCooldown(
            route,
            Number.isFinite(retryHeader) && retryHeader > 0
              ? retryHeader
              : route.defaultCooldownSec,
          );
        } else if (res.status === 413) {
          // Do not put route in long cooldown on 413 payload size; brief 5s pause only
          this.setCooldown(route, 5);
        } else if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
          this.setCooldown(route, 120);
        }
        throw new Error(`${route.provider}/${route.model}: HTTP ${res.status} (${errText})`);
      }

      const data = await res.json();
      const rawContent = isGateway ? data?.text : data?.choices?.[0]?.message?.content;
      const cleaned = cleanAssistantReply(rawContent);

      const hasMeaningfulText = /[a-zA-Z0-9\u0600-\u06FF]/.test(cleaned);
      if (!cleaned || !hasMeaningfulText) {
        this.setCooldown(route, 15);
        throw new Error(`${route.provider}/${route.model}: empty or non-text content`);
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
      const msg = err instanceof Error ? err.message : String(err);
      if (!this.isInCooldown(route)) {
        this.setCooldown(route, 15);
      }
      throw new Error(
        msg.startsWith(`${route.provider}/`) ? msg : `${route.provider}/${route.model}: ${msg}`,
      );
    }
  }

  async runWithRoutes(fullMessages, { temperature = 0.55, validate = null } = {}) {
    if (!this.providers || this.providers.length === 0) {
      throw new Error(
        "No AI backend configured. Set GROQ_API_KEY (recommended, qwen/qwen3.8-27b on top) or GEMINI_API_KEY.",
      );
    }

    const now = Date.now();
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
    for (const route of ordered) {
      try {
        const res = await this.callSingleRoute(route, fullMessages, { temperature });
        if (validate) {
          const validated = validate(res);
          return { ...res, ...validated };
        }
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Fathy Gemini] Fallback from ${route.provider}/${route.model}: ${msg}`);
        errors.push(msg);
      }
    }

    throw new Error(`Gemini request failed: ${errors.slice(0, 4).join(" | ")}`);
  }

  async generateReply({ messages, isGroup = false, remoteJid = "", quotationsSummary = "" }) {
    const systemPrompt = this.buildSystemPrompt({ isGroup, remoteJid, quotationsSummary });
    const fullMessages = [{ role: "system", content: systemPrompt }, ...messages];
    return this.runWithRoutes(fullMessages, { temperature: 0.6 });
  }

  /**
   * Generate a structured Star Belt quotation JSON draft from raw text / pasted WhatsApp order
   * (used by the Quotation App's in-app Fathy AI modal via `POST /api/fathy/draft-quotation`).
   */
  async generateQuotationDraft({ prompt, quotationsSummary = "" }) {
    const systemContent = quotationsSummary
      ? `${DRAFT_QUOTATION_SYSTEM_PROMPT}\n\nللمرجعية فقط — أمثلة من أسماء العملاء والأصناف الأخيرة في ستار بيلت:\n${quotationsSummary}`
      : DRAFT_QUOTATION_SYSTEM_PROMPT;

    const fullMessages = [
      { role: "system", content: systemContent },
      { role: "user", content: String(prompt || "").trim() },
    ];

    return this.runWithRoutes(fullMessages, {
      temperature: 0.2,
      validate: (res) => {
        const draft = parseJsonObjectFromAi(res.text);
        if (!draft || (!Array.isArray(draft.items) && !draft.client)) {
          throw new Error(`${res.provider}/${res.model}: invalid quotation JSON output`);
        }
        return { draft, rawText: res.text };
      },
    });
  }
}
