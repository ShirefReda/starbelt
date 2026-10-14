import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact";

interface AutoTextareaProps extends Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> {
  value: string;
}

/**
 * Textarea that grows to fit its content. Used for item names, notes and the
 * thank-you line so long Arabic text never gets a scrollbar and never clips —
 * both on screen and in the printed sheet.
 */
export function AutoTextarea({ value, onInput, ...rest }: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(resize, [value]);

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      value={value}
      onInput={(e) => {
        resize();
        onInput?.(e);
      }}
    />
  );
}
