import { describe, it, expect } from "vitest";
import { cleanItemText, parseInlineFormatting, isolateBidiTokens } from "../src/utils/itemFormatter";

describe("itemFormatter rich text & BiDi isolation", () => {
  it("cleans tags for plain autocomplete suggestions", () => {
    expect(cleanItemText("**سير ناقل PVC** <small>عرض 50 سم</small>")).toBe("سير ناقل PVC عرض 50 سم");
    expect(cleanItemText("[sm]مواصفات دقيقة[/sm]")).toBe("مواصفات دقيقة");
    expect(cleanItemText("<big>سير مطاطي</big>")).toBe("سير مطاطي");
  });

  it("parses bold inline formatting", () => {
    const nodes = parseInlineFormatting("**سير ناقل** عادي");
    expect(nodes).toHaveLength(3); // [boldNode, space, regularNode]
  });

  it("parses size tags (small and big)", () => {
    const nodes = parseInlineFormatting("عنوان <small>تفاصيل صغيرة</small>");
    expect(nodes.some((n: any) => n && n.props?.class === "item-inline--sm")).toBe(true);

    const bigNodes = parseInlineFormatting("<big>عنوان كبير</big>");
    expect(bigNodes.some((n: any) => n && n.props?.class === "item-inline--lg")).toBe(true);
  });

  it("isolates English model codes and dimension tokens with <bdi>", () => {
    const tokens = isolateBidiTokens("سير EP200 مقاس 50 × 2000 مم (3mm)");
    const bdiTokens = tokens.filter((t: any) => t && t.type === "bdi");
    expect(bdiTokens.length).toBeGreaterThan(0);
    expect(bdiTokens.some((b: any) => b.props.children === "EP200")).toBe(true);
  });

  it("handles numbers in parentheses without flipping in RTL context", () => {
    const tokens = isolateBidiTokens("سير اسود (1)");
    const parenToken = tokens.find((t: any) => t && typeof t === "object" && t.props?.children === "(1)") as any;
    expect(parenToken).toBeDefined();
    expect(parenToken?.props?.dir).toBe("ltr");
  });
});
