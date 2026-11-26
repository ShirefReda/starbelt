/**
 * Server-side Star Belt Quotation Builder, Totals Engine & Supabase SmartCycle Bridge.
 *
 * Keeps exact schema parity with `src/state/quotation.ts`, `src/utils/totals.ts`,
 * and `src/services/supabase.ts` (`schemaVersion: 1`, `quotations` table) so
 * price offers created by Fathy AI on WhatsApp or via `/api/fathy/draft-quotation`
 * open seamlessly inside the web Quotation App via `/?quote=<id>`.
 */

import crypto from "node:crypto";

export const SCHEMA_VERSION = 1;

const ARABIC_DIGITS_MAP = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
  "٬": "",
  "٫": ".",
};

export function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

export function parseNumeric(val, fallback = 0) {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val !== "string") return fallback;
  const normalized = val
    .replace(/[٠-٩۰-۹٬٫]/g, (ch) => ARABIC_DIGITS_MAP[ch] ?? ch)
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  if (!normalized) return fallback;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
}

export function uid(prefix = "id") {
  const short = crypto.randomUUID().slice(0, 8);
  return `${prefix}_${short}`;
}

export function formatCairoDisplayDate(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(date);
    const day = parts.find((p) => p.type === "day")?.value || "01";
    const month = parts.find((p) => p.type === "month")?.value || "01";
    const year = parts.find((p) => p.type === "year")?.value || String(date.getFullYear());
    return `${day}/${month}/${year}`;
  } catch {
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${d}/${m}/${date.getFullYear()}`;
  }
}

export function generateQuotationNumber(date = new Date()) {
  const year = date.getFullYear();
  const suffix = String(Math.floor(1000 + Math.random() * 9000));
  return `SB-${year}-${suffix}`;
}

export function computeQuotationTotals(items = [], options = {}) {
  const subtotal = round2(
    items.reduce((sum, it) => sum + round2(parseNumeric(it?.qty, 0) * parseNumeric(it?.price, 0)), 0),
  );
  let discountAmount = 0;
  if (options.showDiscount) {
    if (options.discountType === "fixed") {
      const fixed = Math.max(0, parseNumeric(options.discountValue, 0));
      discountAmount = round2(Math.min(subtotal, fixed));
    } else {
      const percent = Math.max(0, parseNumeric(options.discountPercent, 0));
      discountAmount = round2((subtotal * percent) / 100);
      discountAmount = Math.min(subtotal, discountAmount);
    }
  }
  const taxableBase = round2(Math.max(0, subtotal - discountAmount));
  const vatRate = options.showVat ? Math.max(0, parseNumeric(options.vatRate, 14)) : 0;
  const vatAmount = round2((taxableBase * vatRate) / 100);
  const total = round2(taxableBase + vatAmount);
  return { subtotal, discountAmount, taxableBase, vatAmount, total };
}

/**
 * Construct a valid Star Belt Quotation object (`schemaVersion: 1`) from an AI draft JSON.
 */
export function buildQuotationFromDraft(draft = {}) {
  const now = new Date();
  const nowIso = now.toISOString();

  const rawItems = Array.isArray(draft.items) ? draft.items : [];
  const items = rawItems
    .map((it) => {
      if (!it || typeof it !== "object") return null;
      const name = String(it.name || it.description || it.item || "").trim();
      if (!name) return null;
      const qty = Math.max(0, parseNumeric(it.qty ?? it.quantity ?? 1, 1));
      const price = Math.max(0, parseNumeric(it.price ?? it.unitPrice ?? it.unit_price ?? 0, 0));
      return {
        id: uid("it"),
        name,
        qty: qty > 0 ? qty : 1,
        price,
      };
    })
    .filter(Boolean);

  if (items.length === 0) {
    items.push({ id: uid("it"), name: "صنف حسب الطلب", qty: 1, price: 0 });
  }

  const showVat = Boolean(draft.showVat ?? draft.includeVat ?? draft.vat ?? false);
  const vatRate = Math.max(0, parseNumeric(draft.vatRate ?? 14, 14)) || 14;
  const rawDiscountPercent = Math.max(0, parseNumeric(draft.discountPercent ?? 0, 0));
  const rawDiscountValue = Math.max(0, parseNumeric(draft.discountValue ?? 0, 0));
  const showDiscount = Boolean(
    draft.showDiscount || rawDiscountPercent > 0 || rawDiscountValue > 0,
  );
  const discountType =
    draft.discountType === "fixed" || (rawDiscountValue > 0 && rawDiscountPercent === 0)
      ? "fixed"
      : "percent";

  const options = {
    showNumberAndDate: Boolean(draft.showNumberAndDate ?? true),
    showVat,
    vatRate,
    showDiscount,
    discountType,
    discountPercent: discountType === "percent" ? rawDiscountPercent || 10 : 10,
    discountValue: discountType === "fixed" ? rawDiscountValue : 0,
    showWords: Boolean(draft.showWords ?? true),
    showValidity: Boolean(draft.showValidity ?? Boolean(draft.validityDays)),
    validityDays: Math.max(1, parseNumeric(draft.validityDays ?? 30, 30)),
    showWatermark: true,
  };

  let notes = [];
  if (Array.isArray(draft.notes) && draft.notes.length > 0) {
    notes = draft.notes
      .map((n) => (typeof n === "string" ? n.trim() : String(n?.text || "").trim()))
      .filter(Boolean)
      .map((text) => ({ id: uid("n"), text }));
  }
  if (notes.length === 0) {
    notes = [
      {
        id: uid("n"),
        text: showVat
          ? `السعر: شامل ضريبة القيمة المضافة (${vatRate}%).`
          : "السعر: غير شامل الضريبة.",
      },
    ];
  }

  const client = String(draft.client || draft.customer || draft.company || "").trim() || "عميل ستار بيلت";
  const attention = String(draft.attention || draft.contact || "").trim() || undefined;
  const approver = String(draft.approver || "").trim() || "تسنيم";
  const thankYou = String(draft.thankYou || "").trim() || "ولكم جزيل الشكر";
  const date =
    typeof draft.date === "string" && draft.date.trim()
      ? draft.date.trim()
      : formatCairoDisplayDate(now);

  const quotation = {
    id: typeof draft.id === "string" && draft.id.trim() ? draft.id.trim() : uid("q"),
    number:
      typeof draft.number === "string" && draft.number.trim()
        ? draft.number.trim()
        : generateQuotationNumber(now),
    createdAt: nowIso,
    updatedAt: nowIso,
    date,
    client,
    ...(attention ? { attention } : {}),
    items,
    notes,
    approver,
    thankYou,
    options,
    schemaVersion: SCHEMA_VERSION,
  };

  const totals = computeQuotationTotals(quotation.items, quotation.options);
  return { quotation, totals };
}

/**
 * Convert a Quotation to the exact Supabase `quotations` table row shape.
 */
export function toSupabaseQuotationRow(q, totals = computeQuotationTotals(q.items, q.options)) {
  const now = new Date().toISOString();
  return {
    id: q.id,
    number: q.number,
    client: String(q.client || "").trim(),
    attention: q.attention?.trim() || null,
    total: totals.total,
    items: q.items,
    notes: q.notes,
    options: q.options,
    approver: q.approver?.trim() || null,
    thank_you: q.thankYou?.trim() || null,
    quote_date: q.date || null,
    created_at: q.createdAt || now,
    updated_at: q.updatedAt || now,
    data: q,
  };
}

/**
 * Persist a quotation directly to Supabase REST API (`quotations` table).
 */
export async function saveQuotationToSupabaseServer(
  quotation,
  { supabaseUrl = "", supabaseAnonKey = "" } = {},
) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return { saved: false, error: "Supabase credentials not configured" };
  }
  const totals = computeQuotationTotals(quotation.items, quotation.options);
  const row = toSupabaseQuotationRow(quotation, totals);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/quotations?on_conflict=id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 240);
      return { saved: false, error: `HTTP ${res.status}: ${errText}` };
    }
    const savedRows = await res.json().catch(() => []);
    return { saved: true, row: Array.isArray(savedRows) ? savedRows[0] : row };
  } catch (err) {
    clearTimeout(timer);
    return { saved: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Parse a JSON object out of potentially markdown-fenced AI text.
 */
export function parseJsonObjectFromAi(rawText) {
  if (!rawText || typeof rawText !== "string") return null;
  const cleaned = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  } catch {
    // Fallback to scanning outermost braces
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const sliced = JSON.parse(cleaned.slice(start, end + 1));
    if (sliced && typeof sliced === "object" && !Array.isArray(sliced)) return sliced;
  } catch {
    return null;
  }
  return null;
}

/**
 * Extract `<CREATE_QUOTATION>{...}</CREATE_QUOTATION>` command from Fathy's reply
 * and return the cleaned surrounding message text.
 */
export function extractCreateQuotationCommand(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { found: false, draft: null, cleanedText: "" };
  }

  const re = /<CREATE_QUOTATION>([\s\S]*?)<\/CREATE_QUOTATION>/i;
  const match = rawText.match(re);
  if (!match) {
    return { found: false, draft: null, cleanedText: rawText.trim() };
  }

  const cleanedText = rawText.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
  const draft = parseJsonObjectFromAi(match[1]);
  if (!draft) {
    return {
      found: true,
      draft: null,
      cleanedText,
      parseError: "Failed to parse JSON inside <CREATE_QUOTATION>",
    };
  }

  return { found: true, draft, cleanedText };
}

/**
 * Sanitize optional LLM intro text before a server-rendered quotation card so a model
 * can NEVER duplicate or hallucinate a fake offer number/summary/link above the real card.
 */
export function sanitizeQuotationIntroText(rawIntro) {
  if (!rawIntro || typeof rawIntro !== "string") return "";
  // Cut off immediately if the model started writing its own card/summary/link
  const lines = rawIntro
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const safeLines = [];
  for (const line of lines) {
    if (
      /(?:📄|🔢|🏢|👤|📅|💰|🔗|☁️)/.test(line) ||
      /https?:\/\//i.test(line) ||
      /\bSB-\d{4}-/i.test(line) ||
      /(?:رقم\s*العرض|تم\s*تجهيز\s*عرض|الإجمالي\s*النهائي|الأصناف\s*:|افتح\s*العرض|محفوظ\s*تلقائياً)/i.test(
        line,
      )
    ) {
      break;
    }
    safeLines.push(line);
    if (safeLines.length >= 1) break; // Keep at most 1 brief intro line
  }

  const intro = safeLines.join(" ").trim();
  if (!intro || intro.length > 140) return "";
  return intro;
}

/**
 * Extract `<SEND_QUOTATION_PDF>{...}</SEND_QUOTATION_PDF>` command when the user asks Fathy
 * to send the PDF of an existing quotation already stored in Supabase.
 */
export function extractSendPdfCommand(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { found: false, query: null, cleanedText: "" };
  }

  const re = /<SEND_QUOTATION_PDF>([\s\S]*?)<\/SEND_QUOTATION_PDF>/i;
  const match = rawText.match(re);
  if (!match) {
    return { found: false, query: null, cleanedText: rawText.trim() };
  }

  const cleanedText = rawText.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
  const query = parseJsonObjectFromAi(match[1]);
  if (!query) {
    return {
      found: true,
      query: null,
      cleanedText,
      parseError: "Failed to parse JSON inside <SEND_QUOTATION_PDF>",
    };
  }
  return { found: true, query, cleanedText };
}

/**
 * Fetch an existing Star Belt quotation from Supabase by `id`, `number`, or `client` search.
 */
export async function fetchQuotationFromSupabaseServer(
  query = {},
  { supabaseUrl = "", supabaseAnonKey = "" } = {},
) {
  if (!supabaseUrl || !supabaseAnonKey) return null;
  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
    Accept: "application/json",
  };

  const tryFetch = async (filterQuery) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/quotations?select=*&${filterQuery}&order=updated_at.desc&limit=1`,
        { headers, signal: controller.signal },
      );
      clearTimeout(timer);
      if (!res.ok) return null;
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const row = rows[0];
      if (row?.data && typeof row.data === "object") {
        return row.data;
      }
      return buildQuotationFromDraft({
        id: row.id,
        number: row.number,
        date: row.quote_date,
        client: row.client,
        attention: row.attention,
        items: row.items,
        notes: row.notes,
        approver: row.approver,
        thankYou: row.thank_you,
        ...(row.options && typeof row.options === "object" ? row.options : {}),
      }).quotation;
    } catch {
      clearTimeout(timer);
      return null;
    }
  };

  const id = String(query.id || "").trim();
  if (id) {
    const found = await tryFetch(`id=eq.${encodeURIComponent(id)}`);
    if (found) return found;
  }

  const number = String(query.number || "").trim();
  if (number) {
    const found = await tryFetch(`number=ilike.${encodeURIComponent(`*${number}*`)}`);
    if (found) return found;
  }

  const client = String(query.client || "").trim();
  if (client) {
    const found = await tryFetch(`client=ilike.${encodeURIComponent(`*${client}*`)}`);
    if (found) return found;
  }

  return null;
}

export function buildQuotationShareUrl(quotationId, publicBaseUrl = "https://maker.starbelt.com.eg") {
  const base = String(publicBaseUrl || "https://maker.starbelt.com.eg").replace(/\/+$/, "");
  return `${base}/?quote=${encodeURIComponent(quotationId)}`;
}

function formatMoney(n) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number(n || 0));
}

/**
 * Build a crisp Arabic WhatsApp summary card with clickable deep-link to the web Quotation App.
 */
export function formatQuotationWhatsAppCard(
  quotation,
  totals,
  publicBaseUrl = "https://maker.starbelt.com.eg",
  { savedToCloud = true } = {},
) {
  const shareUrl = buildQuotationShareUrl(quotation.id, publicBaseUrl);
  const lines = [
    `📄 *تم تجهيز عرض السعر بنجاح!*`,
    `🔢 *رقم العرض:* ${quotation.number}`,
    `🏢 *العميل:* ${quotation.client}`,
  ];
  if (quotation.attention) {
    lines.push(`👤 *عناية:* ${quotation.attention}`);
  }
  lines.push(`📅 *التاريخ:* ${quotation.date || ""}`, ``, `*الأصناف:*`);

  quotation.items.forEach((it, idx) => {
    const lineSum = round2(it.qty * it.price);
    const pricePart =
      it.price > 0
        ? ` — الكمية: ${it.qty} × ${formatMoney(it.price)} = *${formatMoney(lineSum)} ج.م*`
        : ` — الكمية: ${it.qty} *(السعر للتعديل في التطبيق)*`;
    lines.push(`${idx + 1}. ${it.name}${pricePart}`);
  });

  lines.push(``);
  if (totals.discountAmount > 0) {
    lines.push(`• الإجمالي قبل الخصم: ${formatMoney(totals.subtotal)} ج.م`);
    lines.push(`• الخصم: -${formatMoney(totals.discountAmount)} ج.م`);
  }
  if (quotation.options?.showVat && totals.vatAmount > 0) {
    lines.push(
      `• ضريبة القيمة المضافة (${quotation.options.vatRate}%): ${formatMoney(totals.vatAmount)} ج.م`,
    );
  }
  lines.push(`💰 *الإجمالي النهائي:* *${formatMoney(totals.total)} ج.م*`);

  lines.push(
    ``,
    `🔗 *افتح العرض في تطبيق ستار بيلت للتعديل أو تحميل PDF وإرساله:*`,
    shareUrl,
  );
  if (savedToCloud) {
    lines.push(`☁️ _محفوظ تلقائياً في سجل عروض أسعار ستار بيلت السحابي._`);
  }

  return lines.join("\n");
}
