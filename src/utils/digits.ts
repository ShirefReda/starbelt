/**
 * Digit normalization for smart inputs.
 *
 * Accepts Western (0-9), Arabic-Indic (٠-٩) and Extended Arabic-Indic / Persian
 * (۰-۹) digits and converts everything to Western digits. Also normalizes the
 * Arabic decimal separator (٫) to "." and strips Arabic thousands separators.
 */

const ARABIC_INDIC_ZERO = 0x0660;
const EXT_ARABIC_INDIC_ZERO = 0x06f0;

/** Convert every digit character in a string to its Western equivalent. */
export function toWesternDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EXT_ARABIC_INDIC_ZERO && code <= EXT_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXT_ARABIC_INDIC_ZERO);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Sanitize free text typed into a numeric field.
 * Keeps digits and at most one decimal point; rejects everything else.
 * Returns the cleaned string (may be empty).
 */
export function sanitizeNumericInput(raw: string): string {
  // Normalize digits and separators first.
  let s = toWesternDigits(raw);
  s = s.replace(/[\u066B]/g, "."); // Arabic decimal separator -> "."
  s = s.replace(/[\u066C,\s\u00A0]/g, ""); // thousands separators & spaces

  // Keep only digits and dots, then collapse to a single dot.
  s = s.replace(/[^0-9.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  }
  // Drop a leading dot (".5" -> "0.5").
  if (s.startsWith(".")) s = "0" + s;
  return s;
}

/** Parse a sanitized numeric string into a finite number (0 when empty/invalid). */
export function parseNumeric(raw: string): number {
  const s = sanitizeNumericInput(raw);
  if (s === "" || s === ".") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Format a number for use as a plain input value (no grouping), trimming ".0". */
export function toInputValue(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "";
  return String(n);
}
