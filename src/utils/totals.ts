/**
 * Pure totals math for a quotation. Kept separate from UI so it is trivially
 * unit-testable and reusable by the PDF exporter.
 */

import type { QuoteItem, QuoteOptions } from "../state/quotation";
import { round2 } from "../utils/money";

export interface Totals {
  subtotal: number;
  discountAmount: number;
  taxableBase: number;
  vatAmount: number;
  total: number;
}

export function lineTotal(item: QuoteItem): number {
  return round2(item.qty * item.price);
}

export function computeTotals(items: QuoteItem[], options: QuoteOptions): Totals {
  const subtotal = round2(items.reduce((sum, it) => sum + lineTotal(it), 0));
  const discountPercent = options.showDiscount ? options.discountPercent : 0;
  const discountAmount = round2((subtotal * discountPercent) / 100);
  const taxableBase = round2(subtotal - discountAmount);
  const vatRate = options.showVat ? options.vatRate : 0;
  const vatAmount = round2((taxableBase * vatRate) / 100);
  const total = round2(taxableBase + vatAmount);
  return { subtotal, discountAmount, taxableBase, vatAmount, total };
}
