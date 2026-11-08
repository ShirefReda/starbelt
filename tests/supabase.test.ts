import { describe, it, expect } from "vitest";
import { toQuotationRow, fromQuotationRow } from "../src/services/supabase";
import type { Quotation } from "../src/state/quotation";

describe("Supabase Data Serialization", () => {
  const sampleQuote: Quotation = {
    id: "q_test_123",
    number: "SB-2026-0099",
    createdAt: "2026-11-08T10:00:00.000Z",
    updatedAt: "2026-11-08T10:05:00.000Z",
    date: "08/11/2026",
    client: "شركة النصر للتجارة",
    attention: "م / أحمد فوزي",
    items: [
      { id: "it_1", name: "سير ناقل PVC 3mm", qty: 5, price: 1200 },
      { id: "it_2", name: "سير مطاطي 4 طبقات", qty: 2, price: 3500 },
    ],
    notes: [{ id: "n_1", text: "الأسعار شاملة التوصيل" }],
    approver: "إدارة المبيعات",
    thankYou: "شاكرين حسن تعاونكم معنا",
    options: {
      showNumberAndDate: true,
      showVat: true,
      vatRate: 14,
      showDiscount: false,
      discountType: "percent",
      discountPercent: 0,
      discountValue: 0,
      showWords: true,
      showValidity: true,
      validityDays: 30,
      showWatermark: true,
    },
    schemaVersion: 1,
  };

  it("converts quotation to Supabase row format accurately", () => {
    const row = toQuotationRow(sampleQuote);
    expect(row.id).toBe("q_test_123");
    expect(row.number).toBe("SB-2026-0099");
    expect(row.client).toBe("شركة النصر للتجارة");
    expect(row.attention).toBe("م / أحمد فوزي");
    // (5 * 1200 + 2 * 3500) = 6000 + 7000 = 13000 + 14% VAT (1820) = 14820
    expect(row.total).toBe(14820);
    expect(row.quote_date).toBe("08/11/2026");
    expect(row.data).toEqual(sampleQuote);
  });

  it("reconstructs quotation from row with full data payload", () => {
    const row = toQuotationRow(sampleQuote);
    const restored = fromQuotationRow(row);
    expect(restored).not.toBeNull();
    expect(restored?.id).toBe(sampleQuote.id);
    expect(restored?.client).toBe(sampleQuote.client);
    expect(restored?.items).toHaveLength(2);
    expect(restored?.items[0]?.name).toBe("سير ناقل PVC 3mm");
  });

  it("reconstructs quotation gracefully from partial/raw columns if data is missing", () => {
    const rawRow = {
      id: "q_raw_1",
      number: "SB-2026-0001",
      client: "عميل تجريبي",
      attention: "المهندس المختص",
      total: 500,
      items: [{ id: "it_1", name: "صنف تجريبي", qty: 1, price: 500 }],
      notes: [],
      options: {},
      approver: "المسؤول",
      thank_you: "شكراً",
      quote_date: "01/01/2026",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      data: null,
    };

    const restored = fromQuotationRow(rawRow as any);
    expect(restored).not.toBeNull();
    expect(restored?.number).toBe("SB-2026-0001");
    expect(restored?.client).toBe("عميل تجريبي");
    expect(restored?.items).toHaveLength(1);
  });
});
