/**
 * Number formatting for the UI and the sheet.
 * Western digits, thousands separators, up to two decimals, no forced decimals.
 */

const moneyFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const intFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

/** Round to 2 decimals to avoid float dust (e.g. 0.1+0.2). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** "8,000" / "8,000.5" — grouping, no forced decimals. */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return moneyFormatter.format(round2(n));
}

/** Integer formatting for quantities / counts. */
export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return intFormatter.format(Math.round(n));
}
