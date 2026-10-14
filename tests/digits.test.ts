import { describe, it, expect } from "vitest";
import { sanitizeNumericInput, toWesternDigits, parseNumeric } from "../src/utils/digits";

describe("toWesternDigits", () => {
  it("converts Arabic-Indic digits", () => {
    expect(toWesternDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
  });
  it("converts Extended Arabic-Indic (Persian) digits", () => {
    expect(toWesternDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
  });
  it("leaves Latin digits and other chars untouched", () => {
    expect(toWesternDigits("a1b2")).toBe("a1b2");
  });
});

describe("sanitizeNumericInput", () => {
  it("strips letters and symbols", () => {
    expect(sanitizeNumericInput("12abc34")).toBe("1234");
  });
  it("keeps a single decimal point", () => {
    expect(sanitizeNumericInput("12.5.7")).toBe("12.57");
  });
  it("normalizes Arabic decimal separator", () => {
    expect(sanitizeNumericInput("١٢٫٥")).toBe("12.5");
  });
  it("removes thousands separators", () => {
    expect(sanitizeNumericInput("8,000")).toBe("8000");
    expect(sanitizeNumericInput("٨٬٠٠٠")).toBe("8000");
  });
  it("prefixes a leading dot with zero", () => {
    expect(sanitizeNumericInput(".5")).toBe("0.5");
  });
  it("returns empty string for pure junk", () => {
    expect(sanitizeNumericInput("abc")).toBe("");
  });
});

describe("parseNumeric", () => {
  it("parses Arabic-Indic input", () => {
    expect(parseNumeric("٨٠٠٠")).toBe(8000);
  });
  it("returns 0 for empty or invalid", () => {
    expect(parseNumeric("")).toBe(0);
    expect(parseNumeric("abc")).toBe(0);
    expect(parseNumeric(".")).toBe(0);
  });
  it("parses decimals", () => {
    expect(parseNumeric("12.75")).toBe(12.75);
  });
});
