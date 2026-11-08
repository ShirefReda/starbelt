import type { ComponentChildren, JSX } from "preact";
import type { QuoteItem } from "../state/quotation";
import { formatArabicMeasurements } from "./textFormatter";

/**
 * Strips inline formatting tags so autocomplete, plain strings,
 * and search indices stay clean.
 */
export function cleanItemText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/<small>(.*?)<\/small>/gi, "$1")
    .replace(/<big>(.*?)<\/big>/gi, "$1")
    .replace(/\[sm\](.*?)\[\/sm\]/gi, "$1")
    .replace(/\[lg\](.*?)\[\/lg\]/gi, "$1")
    .replace(/<[^>]+>/g, "");
}

/**
 * Checks if a string contains mixed BiDi content (Arabic + English or technical symbols).
 */
export function hasMixedBidi(text: string): boolean {
  const hasArabic = /[\u0600-\u06FF]/.test(text);
  const hasLatinOrSpecs = /[A-Za-z0-9×*#\-_]/.test(text);
  return hasArabic && hasLatinOrSpecs;
}

/**
 * Parses inline rich text (bold, small, big, BiDi tokens) and returns Preact VNodes.
 */
export function parseInlineFormatting(line: string): ComponentChildren[] {
  // First normalize spacing around measurements/operators (e.g. 50سم -> 50 سم, 2x50 -> 2 × 50)
  const normalized = formatArabicMeasurements(line);

  // Tokenize by rich tags: **bold**, <small>...</small>, <big>...</big>, [sm]...[/sm], [lg]...[/lg]
  const tagRegex = /(\*\*.*?\*\*|<small>.*?<\/small>|<big>.*?<\/big>|\[sm\].*?\[\/sm\]|\[lg\].*?\[\/lg\])/g;
  const parts = normalized.split(tagRegex);

  return parts.map((part, index): ComponentChildren => {
    if (!part) return null;

    // Bold **...**
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      const content = part.slice(2, -2);
      return (
        <strong key={index} class="item-inline--bold">
          {isolateBidiTokens(content)}
        </strong>
      );
    }

    // Small <small>...</small> or [sm]...[/sm]
    if (
      (part.toLowerCase().startsWith("<small>") && part.toLowerCase().endsWith("</small>")) ||
      (part.toLowerCase().startsWith("[sm]") && part.toLowerCase().endsWith("[/sm]"))
    ) {
      const start = part.startsWith("<") ? 7 : 4;
      const end = part.startsWith("<") ? -8 : -5;
      const content = part.slice(start, end);
      return (
        <span key={index} class="item-inline--sm">
          {isolateBidiTokens(content)}
        </span>
      );
    }

    // Big <big>...</big> or [lg]...[/lg]
    if (
      (part.toLowerCase().startsWith("<big>") && part.toLowerCase().endsWith("</big>")) ||
      (part.toLowerCase().startsWith("[lg]") && part.toLowerCase().endsWith("[/lg]"))
    ) {
      const start = part.startsWith("<") ? 5 : 4;
      const end = part.startsWith("<") ? -6 : -5;
      const content = part.slice(start, end);
      return (
        <span key={index} class="item-inline--lg">
          {isolateBidiTokens(content)}
        </span>
      );
    }

    return <span key={index}>{isolateBidiTokens(part)}</span>;
  });
}

/**
 * Isolates English codes, numbers, and measurement dimensions inside Arabic text
 * using <bdi> so punctuation and order (e.g. 50 × 2000 or (3mm)) never jump in RTL layout.
 */
export function isolateBidiTokens(text: string): ComponentChildren[] {
  // Matches dimensions e.g. "50 × 2000 mm", English model codes e.g. "EP200", "(3mm)"
  const bidiRegex = /(\([A-Za-z0-9\s.,×*#\-_%]+\)|[A-Za-z0-9#\-_/]+(?:\s*[×*]\s*[A-Za-z0-9#\-_/]+)*|[A-Za-z]{2,}[0-9A-Za-z\-_]*)/g;
  const tokens = text.split(bidiRegex);

  return tokens.map((tok, i): ComponentChildren => {
    if (!tok) return null;
    // If it's a technical model, dimension, or parenthesis with numbers/English, wrap in <bdi>
    if (/^[A-Za-z0-9#\-_/(]/.test(tok) && !/[\u0600-\u06FF]/.test(tok)) {
      return (
        <bdi key={i} class="item-bidi-token" dir="ltr">
          {tok}
        </bdi>
      );
    }
    return tok;
  });
}

interface FormattedItemTextProps {
  item: QuoteItem;
  className?: string;
  measuring?: boolean;
}

/**
 * Main component for rendering an item's description in the sheet, print, and measure views.
 * Applies alignment (right/center/left), base font size (sm/md/lg), and bold styling.
 */
export function FormattedItemText({ item, className, measuring = false }: FormattedItemTextProps): JSX.Element {
  const text = item.name || "";
  const lines = text.split("\n");

  const align = item.align || "right";
  const fontSize = item.fontSize || "md";
  const isBold = Boolean(item.bold);

  const styleClass = [
    "item-formatted-text",
    `item-align--${align}`,
    `item-size--${fontSize}`,
    isBold ? "item-weight--bold" : "",
    className || "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      class={styleClass}
      data-align={align}
      data-size={fontSize}
      data-bold={isBold ? "true" : "false"}
      dir={align === "left" ? "ltr" : "rtl"}
    >
      {lines.map((line, idx) => (
        <span key={idx} class="item-line">
          {parseInlineFormatting(line)}
          {idx < lines.length - 1 && <br />}
        </span>
      ))}
      {!text.trim() && measuring && "‏"}
    </div>
  );
}
