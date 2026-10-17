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
  let discountAmount = 0;
  if (options.showDiscount) {
    if (options.discountType === "fixed") {
      const fixed = Math.max(0, Number(options.discountValue) || 0);
      discountAmount = round2(Math.min(subtotal, fixed));
    } else {
      const percent = Math.max(0, Number(options.discountPercent) || 0);
      discountAmount = round2((subtotal * percent) / 100);
      discountAmount = Math.min(subtotal, discountAmount);
    }
  }
  const taxableBase = round2(Math.max(0, subtotal - discountAmount));
  const vatRate = options.showVat ? Math.max(0, Number(options.vatRate) || 0) : 0;
  const vatAmount = round2((taxableBase * vatRate) / 100);
  const total = round2(taxableBase + vatAmount);
  return { subtotal, discountAmount, taxableBase, vatAmount, total };
}
