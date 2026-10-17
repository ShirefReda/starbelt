import { describe, it, expect } from "vitest";
import { computeTotals, lineTotal } from "../src/utils/totals";
import { defaultOptions, type QuoteItem, type QuoteOptions } from "../src/state/quotation";

const item = (qty: number, price: number): QuoteItem => ({
  id: Math.random().toString(36).slice(2),
  name: "صنف",
  qty,
  price,
});

const opts = (over: Partial<QuoteOptions> = {}): QuoteOptions => ({ ...defaultOptions, ...over });

describe("lineTotal", () => {
  it("multiplies qty by price", () => {
    expect(lineTotal(item(3, 100))).toBe(300);
  });
  it("rounds float dust to 2 decimals", () => {
    expect(lineTotal(item(3, 0.1))).toBe(0.3);
  });
});

describe("computeTotals", () => {
  it("sums lines with no VAT or discount", () => {
    const t = computeTotals([item(1, 8000)], opts());
    expect(t.subtotal).toBe(8000);
    expect(t.total).toBe(8000);
    expect(t.vatAmount).toBe(0);
  });

  it("adds VAT on the taxable base", () => {
    const t = computeTotals([item(2, 1000)], opts({ showVat: true, vatRate: 14 }));
    expect(t.subtotal).toBe(2000);
    expect(t.vatAmount).toBe(280);
    expect(t.total).toBe(2280);
  });

  it("applies discount before VAT", () => {
    const t = computeTotals(
      [item(1, 1000)],
      opts({ showVat: true, vatRate: 14, showDiscount: true, discountPercent: 10 }),
    );
    expect(t.discountAmount).toBe(100);
    expect(t.taxableBase).toBe(900);
    expect(t.vatAmount).toBe(126);
    expect(t.total).toBe(1026);
  });

  it("applies fixed amount discount before VAT", () => {
    const t = computeTotals(
      [item(1, 1000)],
      opts({ showVat: true, vatRate: 14, showDiscount: true, discountType: "fixed", discountValue: 200 }),
    );
    expect(t.discountAmount).toBe(200);
    expect(t.taxableBase).toBe(800);
    expect(t.vatAmount).toBe(112);
    expect(t.total).toBe(912);
  });

  it("applies fixed amount discount without VAT", () => {
    const t = computeTotals(
      [item(1, 1500)],
      opts({ showDiscount: true, discountType: "fixed", discountValue: 300 }),
    );
    expect(t.discountAmount).toBe(300);
    expect(t.total).toBe(1200);
  });

  it("clamps fixed discount to subtotal so total cannot be negative", () => {
    const t = computeTotals(
      [item(1, 500)],
      opts({ showDiscount: true, discountType: "fixed", discountValue: 800 }),
    );
    expect(t.discountAmount).toBe(500);
    expect(t.taxableBase).toBe(0);
    expect(t.total).toBe(0);
  });

  it("clamps percentage discount to subtotal", () => {
    const t = computeTotals(
      [item(1, 1000)],
      opts({ showDiscount: true, discountType: "percent", discountPercent: 120 }),
    );
    expect(t.discountAmount).toBe(1000);
    expect(t.total).toBe(0);
  });

  it("ignores discount when the option is off", () => {
    const t = computeTotals([item(1, 1000)], opts({ showDiscount: false, discountPercent: 50, discountValue: 500 }));
    expect(t.discountAmount).toBe(0);
    expect(t.total).toBe(1000);
  });

  it("handles an empty item list", () => {
    const t = computeTotals([], opts({ showVat: true, showDiscount: true, discountValue: 100 }));
    expect(t.total).toBe(0);
    expect(t.discountAmount).toBe(0);
  });
});

