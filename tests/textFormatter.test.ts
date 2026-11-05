import { describe, expect, it } from "vitest";
import { formatArabicMeasurements } from "../src/utils/textFormatter";

describe("formatArabicMeasurements typography & layout helper", () => {
  it("formats numbers directly followed by Arabic units/words with a space", () => {
    expect(formatArabicMeasurements("50سم")).toBe("50 سم");
    expect(formatArabicMeasurements("41متر")).toBe("41 متر");
    expect(formatArabicMeasurements("2م")).toBe("2 م");
    expect(formatArabicMeasurements("10مم")).toBe("10 مم");
    expect(formatArabicMeasurements("25بوصة")).toBe("25 بوصة");
    expect(formatArabicMeasurements("3طبقات")).toBe("3 طبقات");
    expect(formatArabicMeasurements("الضمان 6شهور")).toBe("الضمان 6 شهور");
    expect(formatArabicMeasurements("التوريد خلال 10أيام")).toBe("التوريد خلال 10 أيام");
  });

  it("formats decimal measurements followed by Arabic units", () => {
    expect(formatArabicMeasurements("3.25م")).toBe("3.25 م");
    expect(formatArabicMeasurements("1.5سم")).toBe("1.5 سم");
    expect(formatArabicMeasurements("3,25م")).toBe("3,25 م");
  });

  it("handles Eastern Arabic / Arabic-Indic digits (٠-٩)", () => {
    expect(formatArabicMeasurements("٥٠سم")).toBe("٥٠ سم");
    expect(formatArabicMeasurements("٤١متر")).toBe("٤١ متر");
    expect(formatArabicMeasurements("٣.٢٥م")).toBe("٣.٢٥ م");
    expect(formatArabicMeasurements("مقاس٣٤")).toBe("مقاس ٣٤");
  });

  it("formats Arabic letters directly followed by digits", () => {
    expect(formatArabicMeasurements("عرض50")).toBe("عرض 50");
    expect(formatArabicMeasurements("مقاس34")).toBe("مقاس 34");
    expect(formatArabicMeasurements("رقم12")).toBe("رقم 12");
  });

  it("formats operators between dimensions and words", () => {
    expect(formatArabicMeasurements("2م*عرض")).toBe("2 م * عرض");
    expect(formatArabicMeasurements("2*50")).toBe("2 * 50");
    expect(formatArabicMeasurements("41متر*عرض")).toBe("41 متر * عرض");
    expect(formatArabicMeasurements("10x20")).toBe("10 × 20");
    expect(formatArabicMeasurements("10X20")).toBe("10 × 20");
  });

  it("preserves technical model codes and latin strings", () => {
    expect(formatArabicMeasurements("سير EP200 كوري")).toBe("سير EP200 كوري");
    expect(formatArabicMeasurements("سير PU400 ابيض")).toBe("سير PU400 ابيض");
    expect(formatArabicMeasurements("سير NN200")).toBe("سير NN200");
  });

  it("formats the exact problematic user strings without mangling", () => {
    const input1 = "سير 2 PU ابيض 41متر*عرض\n60سم";
    const expected1 = "سير 2 PU ابيض 41 متر * عرض\n60 سم";
    expect(formatArabicMeasurements(input1)).toBe(expected1);

    const input2 = "وصله سير 2م*عرض 50سم";
    const expected2 = "وصله سير 2 م * عرض 50 سم";
    expect(formatArabicMeasurements(input2)).toBe(expected2);
  });

  it("does not duplicate spaces when text is already spaced", () => {
    expect(formatArabicMeasurements("50 سم")).toBe("50 سم");
    expect(formatArabicMeasurements("34 سم ومقاس 3.25 م")).toBe("34 سم ومقاس 3.25 م");
    expect(formatArabicMeasurements("2 م * عرض 50 سم")).toBe("2 م * عرض 50 سم");
  });

  it("handles fractions and percentages", () => {
    expect(formatArabicMeasurements("1/2بوصة")).toBe("1/2 بوصة");
    expect(formatArabicMeasurements("10%خصم")).toBe("10% خصم");
    expect(formatArabicMeasurements("خصم 10%")).toBe("خصم 10%");
  });

  it("handles empty or falsy strings gracefully", () => {
    expect(formatArabicMeasurements("")).toBe("");
  });
});

