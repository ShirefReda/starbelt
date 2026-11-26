import { useEffect, useState } from "preact/hooks";
import type { Quotation } from "../state/quotation";
import { migrateQuotation } from "../state/quotation";
import { IconSparkle } from "./icons";

interface AiDraftDialogProps {
  onClose: () => void;
  onApplyQuotation: (quotation: Quotation) => void;
  onToast: (msg: string, error?: boolean) => void;
}

const EXAMPLE_PROMPTS = [
  {
    label: "مثال: سيور PVC مع ضريبة",
    text: "شركة النيل للصناعات الغذائية عناية م. كريم، عايزين عرض سعر لـ 3 سير ناقل PVC أخضر 2 تيلة مقاس 50 سم × 12 متر السعر 4200 جنيه للسير، و2 سير تايمنج 1000 جنيه للواحد، شامل ضريبة 14% والتوريد خلال 3 أيام.",
  },
  {
    label: "مثال: طلب سريع بخصم 5%",
    text: "عميل مصنع الفتح للبلاستيك: 4 سيور مطاط 60 سم × 15 متر سعر الواحد 6500، خصم 5%، السعر غير شامل الضريبة.",
  },
];

export function AiDraftDialog({ onClose, onApplyQuotation, onToast }: AiDraftDialogProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const handleGenerate = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("يرجى لصق رسالة العميل أو كتابة تفاصيل عرض السعر أولاً.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/fathy/draft-quotation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, saveToSupabase: true }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        quotation?: unknown;
        savedToSupabase?: boolean;
        model?: string;
        error?: string;
      };

      if (!res.ok || !payload.ok || !payload.quotation) {
        throw new Error(payload.error || `تعذر إنشاء عرض السعر (HTTP ${res.status})`);
      }

      const migrated = migrateQuotation(payload.quotation);
      if (!migrated) {
        throw new Error("استجابة غير مكتملة من فتحي AI، حاول مرة أخرى.");
      }

      onApplyQuotation(migrated);
      onToast(
        payload.savedToSupabase
          ? "تم إنشاء عرض السعر بفتحي AI وحفظه سحابياً ✨"
          : "تم إنشاء مسودة عرض السعر بفتحي AI ✨",
      );
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="overlay" role="dialog" aria-modal="true" onClick={() => !busy && onClose()}>
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <div class="dialog__head">
          <h2 class="dialog__title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <IconSparkle size={18} />
            <span>إنشاء عرض سعر ذكي بفتحي AI</span>
          </h2>
          <button
            type="button"
            class="dialog__close"
            onClick={() => !busy && onClose()}
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>

        <div class="dialog__body">
          <p style={{ marginTop: 0, marginBottom: "12px", fontSize: "13.5px", color: "var(--text-muted)" }}>
            الصق رسالة الواتساب من العميل أو اكتب تفاصيل الأصناف والمقاسات والأسعار بحرية، وسيقوم{" "}
            <b>فتحي AI</b> بتعبئة عرض السعر بالكامل وحفظه تلقائياً في سجل ستار بيلت السحابي (SmartCycle).
          </p>

          <div class="ai-examples-row">
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex.label}
                type="button"
                class="ai-example-chip"
                disabled={busy}
                onClick={() => {
                  setText(ex.text);
                  setError(null);
                }}
              >
                ✨ {ex.label}
              </button>
            ))}
          </div>

          <div class="field" style={{ marginTop: "10px", marginBottom: 0 }}>
            <label class="field__label" htmlFor="fathy-draft-input">
              تفاصيل الطلب أو رسالة العميل
            </label>
            <textarea
              id="fathy-draft-input"
              class="textarea"
              rows={6}
              disabled={busy}
              placeholder="مثال: شركة الرواد للصناعات، عناية م. أحمد، مطلوب 2 سير PVC أخضر 50 سم × 10 متر بسعر 3500 جنيه، شامل ضريبة 14%..."
              value={text}
              onInput={(e) => {
                setText((e.currentTarget as HTMLTextAreaElement).value);
                if (error) setError(null);
              }}
            />
          </div>

          {error && (
            <div class="ai-draft-error" role="alert">
              ⚠️ {error}
            </div>
          )}

          <p style={{ marginTop: "10px", marginBottom: 0, fontSize: "12px", color: "var(--text-faint)" }}>
            💡 يمكنك أيضاً طلب إنشاء عرض السعر مباشرة من واتساب بالمناداة على <b>"يا فتحي اعمل عرض سعر..."</b>{" "}
            وسيرسل لك رابطاً يفتح العرض هنا فوراً!
          </p>
        </div>

        <div class="dialog__foot">
          <button type="button" class="btn" disabled={busy} onClick={onClose}>
            إلغاء
          </button>
          <span class="spacer" />
          <button
            type="button"
            class="btn btn--primary"
            disabled={busy || !text.trim()}
            onClick={() => void handleGenerate()}
          >
            <IconSparkle size={14} />
            <span>{busy ? "جارٍ تجهيز عرض السعر..." : "إنشاء عرض السعر الآن"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
