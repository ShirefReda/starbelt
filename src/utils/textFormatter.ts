/**
 * Typography and measurement text formatting utilities for Arabic price quotations.
 *
 * Resolves BiDi / RTL text collisions in html2canvas raster exports (PNG / WhatsApp / PDF)
 * where numbers directly touching Arabic units/letters (e.g. "50سم", "41متر", "2م*عرض")
 * trigger multi-rect word breaking in layout engines, causing glyph overlaps and mangled
 * disconnected characters in Canvas 2D rendering.
 */

const AR_LETTERS = "[\u0621-\u064A\u0671-\u06D3]";
const DIGITS = "[0-9\u0660-\u0669]";

/**
 * Formats Arabic quotation items, dimensions, and notes with proper typography spacing.
 *
 * Rules:
 * 1. Inserts spacing between numbers and following Arabic letters (e.g. "50سم" -> "50 سم", "41متر" -> "41 متر", "3.25م" -> "3.25 م").
 * 2. Inserts spacing between Arabic letters and following numbers (e.g. "عرض50" -> "عرض 50", "مقاس34" -> "مقاس 34").
 * 3. Spaces operators (* or ×) touching letters or numbers (e.g. "2م*عرض" -> "2 م * عرض", "2*50" -> "2 * 50").
 * 4. Normalizes dimension multiplication ("x" or "X" between digits) to standard "×" (e.g. "2x50" -> "2 × 50").
 * 5. Preserves English model identifiers (e.g. "EP200", "PU400", "NN200").
 * 6. Preserves intentional line breaks while trimming excessive horizontal whitespace.
 */
export function formatArabicMeasurements(text: string): string {
  if (!text) return text;

  let s = text;

  // 1. Digits (optionally decimal or %) directly followed by Arabic letters (e.g. 50سم -> 50 سم, 41متر -> 41 متر)
  s = s.replace(new RegExp(`(${DIGITS}+(?:[.,٫]${DIGITS}+)?%?)(?=${AR_LETTERS})`, "g"), "$1 ");

  // 2. Arabic letters directly followed by digits (e.g. عرض50 -> عرض 50, مقاس34 -> مقاس 34)
  s = s.replace(new RegExp(`(${AR_LETTERS})(?=${DIGITS})`, "g"), "$1 ");

  // 3. Multiplication/dimension operators (* or ×) touching letters or digits (e.g. 2م*عرض -> 2 م * عرض)
  s = s.replace(new RegExp(`(${AR_LETTERS}|${DIGITS})\\s*([*×])\\s*(${AR_LETTERS}|${DIGITS})`, "g"), "$1 $2 $3");

  // 4. "x" or "X" used as dimension multiplication between numbers (e.g. 2x50 -> 2 × 50)
  s = s.replace(new RegExp(`(${DIGITS})\\s*[xX]\\s*(${DIGITS})`, "g"), "$1 × $2");

  // 5. Clean up redundant horizontal spaces while preserving line breaks
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");

  return s;
}
