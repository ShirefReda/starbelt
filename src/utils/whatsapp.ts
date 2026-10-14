/**
 * WhatsApp helpers — same normalization rules as starbelt-main's
 * normalize_egyptian_number, so any number staff type matches the
 * Evolution API's expectations.
 *
 * Media helpers live in src/utils/quoteMedia.ts now; this module keeps only
 * number normalization so existing imports stay valid.
 */

export function normalizeEgyptianNumber(raw: string): string {
  let v = String(raw ?? "").trim();
  v = v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  v = v.replace(/[\s().-]/g, "");
  if (v.startsWith("00")) v = v.slice(2);
  else if (v.startsWith("+")) v = v.slice(1);
  if (v.startsWith("01") && v.length === 11) v = `20${v.slice(1)}`;
  else if (v.startsWith("1") && v.length === 10) v = `20${v}`;
  if (!/^20\d{10}$/.test(v)) throw new Error("أدخل رقمًا مصريًا صحيحًا مثل 01012345678 أو +201012345678");
  return v;
}

export function isValidEgyptianNumber(raw: string): boolean {
  try {
    normalizeEgyptianNumber(raw);
    return true;
  } catch {
    return false;
  }
}

export function fileNameForQuote(client: string): string {
  const safe = client.trim().replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  const date = new Date().toISOString().slice(0, 10);
  return safe ? `عرض سعر - ${safe} - ${date}.png` : `عرض سعر - ${date}.png`;
}
