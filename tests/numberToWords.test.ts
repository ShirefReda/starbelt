import { describe, it, expect } from "vitest";
import { tafqeet, numberToArabicWords, amountWordsWithCurrency, EGP } from "../src/utils/numberToWords";

describe("numberToArabicWords", () => {
  it("handles zero", () => {
    expect(numberToArabicWords(0)).toBe("صفر");
  });
  it("handles units", () => {
    expect(numberToArabicWords(3)).toBe("ثلاثة");
    expect(numberToArabicWords(7)).toBe("سبعة");
  });
  it("handles teens", () => {
    expect(numberToArabicWords(11)).toBe("أحد عشر");
    expect(numberToArabicWords(19)).toBe("تسعة عشر");
  });
  it("handles tens", () => {
    expect(numberToArabicWords(20)).toBe("عشرون");
    expect(numberToArabicWords(21)).toBe("واحد وعشرون");
  });
  it("handles hundreds", () => {
    expect(numberToArabicWords(100)).toBe("مائة");
    expect(numberToArabicWords(125)).toBe("مائة وخمسة وعشرون");
    expect(numberToArabicWords(350)).toBe("ثلاثمائة وخمسون");
  });
  it("handles thousands", () => {
    expect(numberToArabicWords(1000)).toBe("ألف");
    expect(numberToArabicWords(2000)).toBe("ألفان");
    expect(numberToArabicWords(3000)).toBe("ثلاثة آلاف");
    expect(numberToArabicWords(8000)).toBe("ثمانية آلاف");
    expect(numberToArabicWords(10500)).toBe("عشرة آلاف وخمسمائة");
  });
  it("handles millions", () => {
    expect(numberToArabicWords(1_000_000)).toBe("مليون");
    expect(numberToArabicWords(2_000_000)).toBe("مليونان");
    expect(numberToArabicWords(3_000_000)).toBe("ثلاثة ملايين");
  });
  it("handles complex numbers", () => {
    expect(numberToArabicWords(123_456)).toBe("مائة وثلاثة وعشرون ألفاً وأربعمائة وستة وخمسون");
  });
});

describe("amountWordsWithCurrency", () => {
  it("writes the whole amount with the noun", () => {
    expect(amountWordsWithCurrency(8000, EGP)).toBe("ثمانية آلاف جنيه مصري");
    expect(amountWordsWithCurrency(2000, EGP)).toBe("ألفا جنيه مصري");
    expect(amountWordsWithCurrency(3, EGP)).toBe("ثلاثة جنيهات مصرية");
    expect(amountWordsWithCurrency(11, EGP)).toBe("أحد عشر جنيهاً مصري");
    expect(amountWordsWithCurrency(125, EGP)).toBe("مائة وخمسة وعشرون جنيهاً مصري");
  });
});

describe("tafqeet", () => {
  it("handles whole pounds", () => {
    expect(tafqeet(8000)).toBe("ثمانية آلاف جنيه مصري");
  });
  it("appends piasters", () => {
    expect(tafqeet(8000.25)).toBe("ثمانية آلاف جنيه مصري و خمسة وعشرون قرشاً");
  });
  it("handles zero", () => {
    expect(tafqeet(0)).toBe("صفر جنيه");
  });
  it("handles small amounts", () => {
    expect(tafqeet(2)).toBe("جنيهان مصريان");
  });
});
