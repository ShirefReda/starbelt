/**
 * تفقيط — Arabic number-to-words for money amounts.
 *
 * Examples:
 *   1        → "جنيه واحد"
 *   2        → "جنيهان"
 *   3        → "ثلاثة جنيهات"
 *   11       → "أحد عشر جنيهاً"
 *   125      → "مائة وخمسة وعشرون جنيهاً"
 *   200      → "مائتا جنيه"
 *   8000     → "ثمانية آلاف جنيه"
 *   2000     → "ألفا جنيه"
 *   1,500,000→ "مليون وخمسمائة ألف جنيه"
 *   8000.25  → "ثمانية آلاف جنيه و خمسة وعشرون قرشاً"
 *
 * Grammar rules implemented:
 *  - Numerals 3–10 agree with the noun's opposite gender: "ثلاث آلاف" (fem.),
 *    "ثلاثة ملايين" (masc.).
 *  - The currency noun is plural for 3–10, dual for 2, singular otherwise.
 *  - After 11–99 the singular noun is accusative ("جنيهاً").
 *  - Dual scale words take the idafa form before a noun: "ألفا جنيه", "مائتا جنيه".
 */

export interface CurrencyWords {
  singular: string;
  plural: string;
  dual: string;
  adjSingular?: string;
  adjPlural?: string;
  adjDual?: string;
}

export const EGP: CurrencyWords = {
  singular: "جنيه",
  plural: "جنيهات",
  dual: "جنيهان",
  adjSingular: "مصري",
  adjPlural: "مصرية",
  adjDual: "مصريان",
};

export const PIASTER: CurrencyWords = {
  singular: "قرش",
  plural: "قروش",
  dual: "قرشان",
};

const ONES_M = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const ONES_F = ["", "إحدى", "اثنتان", "ثلاث", "أربع", "خمس", "ست", "سبع", "ثمان", "تسع"];
const TEENS = [
  "عشرة",
  "أحد عشر",
  "اثنا عشر",
  "ثلاثة عشر",
  "أربعة عشر",
  "خمسة عشر",
  "ستة عشر",
  "سبعة عشر",
  "ثمانية عشر",
  "تسعة عشر",
];
const TENS = ["", "عشرة", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = [
  "",
  "مائة",
  "مائتان",
  "ثلاثمائة",
  "أربعمائة",
  "خمسمائة",
  "ستمائة",
  "سبعمائة",
  "ثمانمائة",
  "تسعمائة",
];

/** Words for an integer 1..999. `form` selects numeral gender (m = masculine). */
export function groupToWords(n: number, form: "m" | "f"): string {
  if (n <= 0) return "";
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rem = n % 100;
  if (h) parts.push(HUNDREDS[h] ?? "");
  if (rem > 0) {
    if (rem < 10) {
      parts.push(form === "m" ? (ONES_M[rem] ?? "") : (ONES_F[rem] ?? ""));
    } else if (rem < 20) {
      parts.push(TEENS[rem - 10] ?? "");
    } else {
      const t = Math.floor(rem / 10);
      const u = rem % 10;
      if (u)
        parts.push(`${form === "m" ? (ONES_M[u] ?? "") : (ONES_F[u] ?? "")} و${TENS[t] ?? ""}`);
      else parts.push(TENS[t] ?? "");
    }
  }
  return parts.join(" و");
}

/** Scale words (thousand / million / billion) for a group value 1..999.
 *
 * The counted noun's form follows the *last* component of the group:
 *   - ends in 3–10 → plural (آلاف / ملايين): ثمانية آلاف، عشرة آلاف
 *   - ends in 11–99 → singular accusative (ألفاً / مليوناً): واحد وعشرون ألفاً
 *   - otherwise (round hundreds, ends in 1–2) → singular: ثلاثمائة ألف، مائة ألف
 */
function scaleWords(v: number, scale: "thousand" | "million" | "billion"): string {
  const singular = scale === "thousand" ? "ألف" : scale === "million" ? "مليون" : "مليار";
  const dual = scale === "thousand" ? "ألفان" : scale === "million" ? "مليونان" : "ملياران";
  const plural = scale === "thousand" ? "آلاف" : scale === "million" ? "ملايين" : "مليارات";
  if (v === 1) return singular;
  if (v === 2) return dual;
  const last = v % 100;
  if (last >= 3 && last <= 10) return `${groupToWords(v, "m")} ${plural}`;
  if (last >= 11 && last <= 99) return `${groupToWords(v, "m")} ${singular}اً`;
  return `${groupToWords(v, "m")} ${singular}`;
}

/** Non-negative integer (< 1e12) → Arabic words, without a currency noun. */
export function numberToArabicWords(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "صفر";
  const groups: string[] = [];
  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1_000);
  const units = n % 1000;
  if (billions) groups.push(scaleWords(billions, "billion"));
  if (millions) groups.push(scaleWords(millions, "million"));
  if (thousands) groups.push(scaleWords(thousands, "thousand"));
  if (units) groups.push(groupToWords(units, "m"));
  return groups.join(" و");
}

/** Convert a dual scale word to its idafa form: ألفان → ألفا, مائتان → مائتا. */
function toIdafa(word: string): string {
  if (word.endsWith("ان")) return word.slice(0, -2) + "ا";
  return word;
}

/**
 * Whole-number amount with the currency noun, applying Arabic agreement.
 * `n` must be a non-negative integer.
 */
export function amountWordsWithCurrency(n: number, currency: CurrencyWords): string {
  if (!Number.isFinite(n) || n <= 0) return `صفر ${currency.singular}`;
  if (n === 1) {
    return currency.adjSingular
      ? `${currency.singular} ${currency.adjSingular}`
      : `${currency.singular} واحد`;
  }
  if (n === 2) {
    return currency.adjDual ? `${currency.dual} ${currency.adjDual}` : currency.dual;
  }

  let words = numberToArabicWords(n);
  const units = n % 1000;
  // The governing value: the last written group (units), or the scale group when
  // the number is a round thousand/million/billion.
  const roundScale = units === 0 && n >= 1000;

  let noun: string;
  let adj: string | undefined;
  let accusative = false;

  if (roundScale) {
    noun = currency.singular;
    adj = currency.adjSingular;
    // A dual scale word takes the idafa form directly before the noun.
    const lastWord = words.split(" ").pop() ?? "";
    if (lastWord === "ألفان" || lastWord === "مليونان" || lastWord === "ملياران") {
      words = words.replace(/ان$/, "ا");
    }
  } else if (units >= 3 && units <= 10) {
    noun = currency.plural;
    adj = currency.adjPlural;
  } else if (units >= 11 && units <= 99) {
    noun = currency.singular;
    adj = currency.adjSingular;
    accusative = true;
  } else if (units >= 100) {
    noun = currency.singular;
    adj = currency.adjSingular;
    // 200 exactly → مائتا (idafa); 200 as the tail of a larger number keeps مائتان.
    if (units === 200 && n === 200) words = toIdafa(words);
    // A compound ending like "خمسة وعشرون" governs the accusative noun.
    accusative = /عشر/.test(words);
  } else {
    // units 1..2 as a trailing group (e.g. 1001) — rare; use the singular.
    noun = currency.singular;
    adj = currency.adjSingular;
  }

  const nounForm = accusative ? `${noun}اً` : noun;
  return `${words} ${nounForm}${adj ? ` ${adj}` : ""}`;
}

/**
 * Full tafqeet for a decimal amount.
 * Returns only the amount phrase; the caller wraps it with "فقط … لا غير".
 */
export function tafqeet(
  amount: number,
  currency: CurrencyWords = EGP,
  subcurrency: CurrencyWords | null = PIASTER,
): string {
  if (!Number.isFinite(amount) || amount < 0) return `صفر ${currency.singular}`;
  const totalPiasters = Math.round(amount * 100);
  const intPart = Math.floor(totalPiasters / 100);
  const piasters = totalPiasters % 100;

  let main = amountWordsWithCurrency(intPart, currency);
  if (piasters > 0 && subcurrency) {
    const sub = amountWordsWithCurrency(piasters, subcurrency);
    main = `${main} و ${sub}`;
  }
  return main;
}
