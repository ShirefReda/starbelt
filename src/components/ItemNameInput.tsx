import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { AutoTextarea } from "./AutoTextarea";
import { formatArabicMeasurements } from "../utils/textFormatter";
import { cleanItemText } from "../utils/itemFormatter";
import type { TextAlignment, TextFontSize } from "../state/quotation";
import {
  IconBold,
  IconAlignRight,
  IconAlignCenter,
  IconAlignLeft,
} from "./icons";

interface ItemNameInputProps {
  value: string;
  align?: TextAlignment;
  fontSize?: TextFontSize;
  bold?: boolean;
  onChange: (v: string) => void;
  onAlignChange?: (align: TextAlignment) => void;
  onFontSizeChange?: (size: TextFontSize) => void;
  onBoldChange?: (bold: boolean) => void;
  onCommit?: (v: string) => void;
  onEnter?: () => void;
  names: string[];
  ariaLabel?: string;
  dataRow?: number;
  dataCell?: string;
  class?: string;
}

/**
 * Minimalist, elegant item editor.
 * - While typing: completely clean, never covers previous rows or headers.
 * - On text selection: floating bubble menu appears for inline bold, small/big text, and dimensions.
 * - Discreet cell trigger: sleek pill at bottom corner to easily change text side (right/center/left) and size.
 */
export function ItemNameInput({
  value,
  align = "right",
  fontSize = "md",
  bold = false,
  onChange,
  onAlignChange,
  onFontSizeChange,
  onBoldChange,
  onCommit,
  onEnter,
  names,
  ariaLabel,
  dataRow,
  dataCell,
  class: className,
}: ItemNameInputProps) {
  const [open, setOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [showCellMenu, setShowCellMenu] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [touched, setTouched] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Clean autocomplete queries & matches so tags don't pollute suggestions
  const plainValue = useMemo(() => cleanItemText(value), [value]);

  const matches = useMemo(() => {
    const q = plainValue.trim();
    if (q.length < 1) return [];
    const lower = q.toLowerCase();
    return names
      .map(cleanItemText)
      .filter((n) => n.toLowerCase().includes(lower) && n !== plainValue)
      .slice(0, 6);
  }, [names, plainValue]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setIsFocused(false);
        setHasSelection(false);
        setShowCellMenu(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const checkSelection = () => {
    const el = textareaRef.current;
    if (!el) {
      setHasSelection(false);
      return;
    }
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    setHasSelection(start !== end && end > start);
  };

  const accept = (name: string) => {
    const formatted = formatArabicMeasurements(name);
    onChange(formatted);
    onCommit?.(cleanItemText(formatted));
    setOpen(false);
  };

  /**
   * Surrounds selected text with bold or toggles cell bold
   */
  const handleToggleBold = () => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;

    if (start !== end) {
      const selected = value.substring(start, end);
      const isWrapped = selected.startsWith("**") && selected.endsWith("**") && selected.length >= 4;
      const replacement = isWrapped ? selected.slice(2, -2) : `**${selected}**`;
      const next = value.substring(0, start) + replacement + value.substring(end);
      onChange(next);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + replacement.length);
        checkSelection();
      }, 0);
    } else {
      onBoldChange?.(!bold);
    }
  };

  /**
   * Sets cell font size or wraps selection in <small>/<big>
   */
  const handleSetFontSize = (size: TextFontSize) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;

    if (start !== end) {
      const selected = value.substring(start, end);
      let replacement = selected;
      if (size === "sm") {
        replacement = `<small>${selected.replace(/<\/?small>/gi, "")}</small>`;
      } else if (size === "lg") {
        replacement = `<big>${selected.replace(/<\/?big>/gi, "")}</big>`;
      } else {
        replacement = selected.replace(/<\/?(small|big)>/gi, "");
      }
      const next = value.substring(0, start) + replacement + value.substring(end);
      onChange(next);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + replacement.length);
        checkSelection();
      }, 0);
    } else {
      onFontSizeChange?.(size);
    }
  };

  /**
   * Inserts the standard multiplication symbol (×) with clean spacing
   */
  const handleInsertDimension = () => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.substring(0, start) + " × " + value.substring(end);
    onChange(next);
    setTimeout(() => {
      el.focus();
      const pos = start + 3;
      el.setSelectionRange(pos, pos);
      checkSelection();
    }, 0);
  };

  const handleKeyDown: JSX.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    // Bold shortcut Ctrl+B / Cmd+B
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      handleToggleBold();
      return;
    }

    // Alignment shortcuts
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        onAlignChange?.("left");
        return;
      }
      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        onAlignChange?.("right");
        return;
      }
      if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        onAlignChange?.("center");
        return;
      }
    }

    if (open && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        accept(matches[highlight]!);
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const formatted = formatArabicMeasurements(value);
      if (formatted !== value) onChange(formatted);
      onEnter?.();
    }
  };

  const currentAlign = align || "right";
  const currentFontSize = fontSize || "md";

  return (
    <div
      class="item-name-wrap"
      ref={wrapRef}
      style={{ position: "relative" }}
      data-align={currentAlign}
      data-size={currentFontSize}
      data-bold={bold ? "true" : "false"}
    >
      {/* 1. SELECTION BUBBLE: Only appears when text is highlighted (Notion/Medium style) */}
      {hasSelection && (
        <div class="item-selection-bubble no-print" role="toolbar" aria-label="تنسيق التحديد">
          <button
            type="button"
            class="bubble-btn"
            title="خط عريض (Bold)"
            onMouseDown={(e) => {
              e.preventDefault();
              handleToggleBold();
            }}
          >
            <IconBold size={13} />
          </button>

          <span class="bubble-divider" />

          <button
            type="button"
            class="bubble-btn"
            title="خط صغير (مواصفات)"
            onMouseDown={(e) => {
              e.preventDefault();
              handleSetFontSize("sm");
            }}
          >
            A<sub style={{ fontSize: "8px" }}>-</sub>
          </button>

          <button
            type="button"
            class="bubble-btn"
            title="خط كبير (عنوان)"
            onMouseDown={(e) => {
              e.preventDefault();
              handleSetFontSize("lg");
            }}
          >
            A<sup style={{ fontSize: "8px" }}>+</sup>
          </button>

          <span class="bubble-divider" />

          <button
            type="button"
            class="bubble-btn"
            title="رمز الأبعاد (×)"
            onMouseDown={(e) => {
              e.preventDefault();
              handleInsertDimension();
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* 2. DISCREET CELL FORMAT TRIGGER: Sits quietly at the bottom corner, never covers text above */}
      {isFocused && (
        <div class="item-cell-format-wrap no-print">
          <button
            type="button"
            class={`item-format-trigger${bold ? " is-bold" : ""}`}
            title="خيارات محاذاة وحجم الصنف"
            onMouseDown={(e) => {
              e.preventDefault();
              setShowCellMenu(!showCellMenu);
            }}
          >
            <span class="format-trigger-label">
              {currentAlign === "left" ? "يسار ≣" : currentAlign === "center" ? "وسط ≍" : "يمين ≡"}
            </span>
            <span class="format-trigger-size">
              {currentFontSize === "sm" ? "صغير" : currentFontSize === "lg" ? "كبير" : "عادي"}
            </span>
            {bold && <span class="format-trigger-bold">B</span>}
          </button>

          {showCellMenu && (
            <div class="item-cell-dropdown" onMouseDown={(e) => e.preventDefault()}>
              <div class="dropdown-row">
                <span class="dropdown-label">المحاذاة:</span>
                <div class="dropdown-btn-group">
                  <button
                    type="button"
                    class={`pill-btn${currentAlign === "right" ? " is-active" : ""}`}
                    title="محاذاة لليمين (عربي)"
                    onClick={() => {
                      onAlignChange?.("right");
                      setShowCellMenu(false);
                    }}
                  >
                    <IconAlignRight size={13} />
                    <span>يمين</span>
                  </button>
                  <button
                    type="button"
                    class={`pill-btn${currentAlign === "center" ? " is-active" : ""}`}
                    title="توسيط"
                    onClick={() => {
                      onAlignChange?.("center");
                      setShowCellMenu(false);
                    }}
                  >
                    <IconAlignCenter size={13} />
                    <span>وسط</span>
                  </button>
                  <button
                    type="button"
                    class={`pill-btn${currentAlign === "left" ? " is-active" : ""}`}
                    title="محاذاة لليسار (English/أرقام)"
                    onClick={() => {
                      onAlignChange?.("left");
                      setShowCellMenu(false);
                    }}
                  >
                    <IconAlignLeft size={13} />
                    <span>يسار</span>
                  </button>
                </div>
              </div>

              <div class="dropdown-row">
                <span class="dropdown-label">حجم الخط:</span>
                <div class="dropdown-btn-group">
                  <button
                    type="button"
                    class={`pill-btn${currentFontSize === "sm" ? " is-active" : ""}`}
                    onClick={() => {
                      onFontSizeChange?.("sm");
                      setShowCellMenu(false);
                    }}
                  >
                    صغير
                  </button>
                  <button
                    type="button"
                    class={`pill-btn${currentFontSize === "md" ? " is-active" : ""}`}
                    onClick={() => {
                      onFontSizeChange?.("md");
                      setShowCellMenu(false);
                    }}
                  >
                    عادي
                  </button>
                  <button
                    type="button"
                    class={`pill-btn${currentFontSize === "lg" ? " is-active" : ""}`}
                    onClick={() => {
                      onFontSizeChange?.("lg");
                      setShowCellMenu(false);
                    }}
                  >
                    كبير
                  </button>
                </div>
              </div>

              <div class="dropdown-row">
                <span class="dropdown-label">نمط الخط:</span>
                <button
                  type="button"
                  class={`pill-btn pill-btn--bold${bold ? " is-active" : ""}`}
                  onClick={() => {
                    onBoldChange?.(!bold);
                  }}
                >
                  <IconBold size={13} />
                  <span>خط عريض (Bold)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. MAIN EDITOR TEXTAREA */}
      <AutoTextarea
        textareaRef={textareaRef}
        class={`${className || ""} item-editor--${currentAlign} item-editor--${currentFontSize}${
          bold ? " item-editor--bold" : ""
        }`}
        value={value}
        aria-label={ariaLabel}
        placeholder={touched ? "" : ""}
        data-row={dataRow}
        data-cell={dataCell}
        dir={currentAlign === "left" ? "ltr" : "rtl"}
        onFocus={() => {
          setIsFocused(true);
        }}
        onSelect={checkSelection}
        onMouseUp={checkSelection}
        onKeyUp={checkSelection}
        onInput={(e) => {
          const v = (e.currentTarget as HTMLTextAreaElement).value;
          onChange(v);
          setTouched(true);
          setOpen(true);
          setHighlight(0);

          // Auto-align left if user begins typing purely English text and hasn't changed align
          if (!align || align === "right") {
            const trimmed = v.trim();
            if (trimmed.length >= 3 && /^[A-Za-z0-9]/.test(trimmed) && !/[\u0600-\u06FF]/.test(trimmed)) {
              onAlignChange?.("left");
            }
          }
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          const formatted = formatArabicMeasurements(value);
          if (formatted !== value) onChange(formatted);
          onCommit?.(cleanItemText(formatted));
          // Delay so clicking toolbar/autocomplete items still registers
          setTimeout(() => {
            if (!wrapRef.current?.contains(document.activeElement)) {
              setOpen(false);
              setHasSelection(false);
              setIsFocused(false);
              setShowCellMenu(false);
            }
          }, 180);
        }}
      />

      {open && matches.length > 0 && (
        <div class="autocomplete no-print" role="listbox">
          {matches.map((m, i) => (
            <div
              key={m}
              class="autocomplete__item"
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                accept(m);
              }}
            >
              {m}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
