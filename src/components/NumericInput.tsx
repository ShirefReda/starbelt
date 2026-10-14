import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { parseNumeric, sanitizeNumericInput } from "../utils/digits";

interface NumericInputProps {
  value: number;
  onValue: (n: number) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** Called when Enter is pressed (used to move focus). */
  onEnter?: () => void;
  dataRow?: number;
  dataCell?: string;
  onFocus?: () => void;
}

/**
 * Numeric text input that:
 *  - accepts Arabic-Indic digits and converts them to Western,
 *  - rejects any non-numeric character (including letters),
 *  - allows one decimal point,
 *  - keeps an internal string buffer while focused so typing "0." or "12." works.
 */
export function NumericInput({
  value,
  onValue,
  className,
  placeholder,
  ariaLabel,
  onEnter,
  dataRow,
  dataCell,
  onFocus,
}: NumericInputProps) {
  const [buffer, setBuffer] = useState<string>(value === 0 ? "" : String(value));
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  // Sync external changes (undo/redo/load) while not actively typing.
  useEffect(() => {
    if (!focused) setBuffer(value === 0 ? "" : String(value));
  }, [value, focused]);

  const handleInput: JSX.GenericEventHandler<HTMLInputElement> = (e) => {
    const raw = (e.currentTarget as HTMLInputElement).value;
    const clean = sanitizeNumericInput(raw);
    setBuffer(clean);
    onValue(parseNumeric(clean));
  };

  const handleKeyDown: JSX.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onEnter?.();
    }
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      dir="ltr"
      class={className}
      value={buffer}
      placeholder={placeholder}
      aria-label={ariaLabel}
      data-row={dataRow}
      data-cell={dataCell}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        // Normalize the display once the user leaves the field.
        setBuffer(value === 0 ? "" : String(value));
      }}
    />
  );
}
