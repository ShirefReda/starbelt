import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { AutoTextarea } from "./AutoTextarea";

interface ItemNameInputProps {
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  onEnter?: () => void;
  names: string[];
  ariaLabel?: string;
  dataRow?: number;
  dataCell?: string;
  class?: string;
}

/**
 * Multi-line item name editor with autocomplete from previously used names.
 * The dropdown is editor-only (never printed). Enter on a closed dropdown moves
 * to the next cell; Enter on an open dropdown accepts the highlighted option.
 */
export function ItemNameInput({
  value,
  onChange,
  onCommit,
  onEnter,
  names,
  ariaLabel,
  dataRow,
  dataCell,
  class: className,
}: ItemNameInputProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [touched, setTouched] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = value.trim();
    if (q.length < 1) return [];
    const lower = q.toLowerCase();
    return names.filter((n) => n.toLowerCase().includes(lower) && n !== value).slice(0, 6);
  }, [names, value]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const accept = (name: string) => {
    onChange(name);
    onCommit?.(name);
    setOpen(false);
  };

  const handleKeyDown: JSX.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
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
      if (e.key === "Tab" || e.key === "Enter") {
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
      onEnter?.();
    }
  };

  return (
    <div class="item-name-wrap" ref={wrapRef} style={{ position: "relative" }}>
      <AutoTextarea
        class={className}
        value={value}
        aria-label={ariaLabel}
        placeholder={touched ? "" : ""}
        data-row={dataRow}
        data-cell={dataCell}
        onInput={(e) => {
          const v = (e.currentTarget as HTMLTextAreaElement).value;
          onChange(v);
          setTouched(true);
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          onCommit?.(value);
          // Delay so a click on an option still registers.
          setTimeout(() => setOpen(false), 120);
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
