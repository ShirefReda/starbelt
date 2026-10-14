import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { IconClose } from "./icons";
import { salesContacts, type SalesContact } from "../config/salesContacts";
import { normalizeEgyptianNumber } from "../utils/whatsapp";
import { renderQuoteMedia, type QuoteMediaKind } from "../utils/quoteMedia";
import { resolveEvolutionConfig, sendQuotationMedia, type EvolutionConfig } from "../services/evolution";
import type { Quotation } from "../state/quotation";
import { S } from "../i18n/strings";

interface WhatsappDialogProps {
  quotation: Quotation;
  onClose: () => void;
  onToast: (msg: string, isError?: boolean) => void;
}

type Step = "render" | "done";

export function WhatsappDialog({ quotation, onClose, onToast }: WhatsappDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set<string>());
  const [mediaKind, setMediaKind] = useState<QuoteMediaKind>("png");
  const [step, setStep] = useState<Step>("render");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string[]>([]);
  const closingRef = useRef(false);

  const hasSelection = selected.size > 0;
  const config: EvolutionConfig | null = useMemo(() => resolveEvolutionConfig(), []);

  const missingConfig = !config;
  const toggle = (phone: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  };

  const handleSend = async () => {
    if (!hasSelection) return;
    if (missingConfig) {
      onToast("إعدادات واتساب غير مُهيأة — أضف VITE_EVOLUTION_BASE_URL و VITE_STARBELT_API_KEY في الإعدادات", true);
      return;
    }
    setBusy(true);
    setErrors({});
    setSuccess([]);
    setStep("render");

    const sheetEl = document.querySelector<HTMLElement>(".sheet");
    if (!sheetEl) {
      setBusy(false);
      onToast("تعذر العثور على الورقة للتصدير", true);
      return;
    }

    const caption = quotation.client
      ? `عرض سعر — ${quotation.client}`
      : `عرض سعر — ${quotation.number || new Date().toISOString().slice(0, 10)}`;

    const nextErrors: Record<string, string> = {};
    const nextSuccess: string[] = [];

    for (const c of salesContacts.filter((cc) => selected.has(cc.phone))) {
      let num: string;
      try {
        num = normalizeEgyptianNumber(c.phone);
      } catch (e) {
        nextErrors[c.phone] = e instanceof Error ? e.message : "رقم غير صالح";
        continue;
      }
      try {
        const rendered = await renderQuoteMedia(sheetEl, quotation.client, mediaKind);
        await sendQuotationMedia({
          normalizedNumber: num,
          blob: rendered.blob,
          fileName: rendered.fileName,
          mimetype: rendered.mimetype,
          caption,
          config: config!,
        });
        nextSuccess.push(c.phone);
      } catch (e) {
        nextErrors[c.phone] = e instanceof Error ? e.message : "فشل الإرسال";
      }
      setSuccess([...nextSuccess]);
      setErrors({ ...nextErrors });
    }

    setBusy(false);
    setStep("done");
    if (nextSuccess.length > 0) onToast(`تم الإرسال إلى ${nextSuccess.length} رقم`);
    if (nextSuccess.length === 0 && Object.keys(nextErrors).length > 0) {
      onToast("تعذر الإرسال — تحقق من إعدادات واتساب والاتصال", true);
    }
  };

  const handleOverlayClose = () => {
    if (busy) return;
    onClose();
  };

  useEffect(() => {
    closingRef.current = false;
    return () => {
      closingRef.current = true;
    };
  }, []);

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="إرسال واتساب" onClick={handleOverlayClose}>
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <div class="dialog__head">
          <h2 class="dialog__title">إرسال عبر واتساب</h2>
          <button class="dialog__close" onClick={onClose} aria-label={S.settings.close}>
            <IconClose />
          </button>
        </div>

        <div class="dialog__body">
          {missingConfig && (
            <p style={{ margin: "0 0 12px", color: "var(--danger)", fontWeight: 700 }}>
              إعدادات واتساب غير مُهيأة. في coolify أضف متغيرات البيئة VITE_EVOLUTION_BASE_URL و
              VITE_STARBELT_API_KEY (و VITE_STARBELT_INSTANCE إن لزم)، أو في التطوير أضفها إلى
              ملف <code>.env</code> في quotation-app.
            </p>
          )}

          <p class="hint" style={{ marginTop: 0 }}>
            اختر واحدًا أو أكثر. سيُرسل نفس عرض السعر إلى كل رقم مُحدد عبر نفس قناة
            starbelt main (Evolution API — <code>POST /message/sendMedia/{"{"}instance{"}"}</code>).
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <label class={`btn${mediaKind === "png" ? " btn--primary" : ""}`} style={{ flex: 1, justifyContent: "center" }}>
              <input
                type="radio"
                name="wa-media-kind"
                checked={mediaKind === "png"}
                onChange={() => setMediaKind("png")}
                style={{ marginInlineEnd: 6 }}
              />
              صورة (PNG)
            </label>
            <label class={`btn${mediaKind === "pdf" ? " btn--primary" : ""}`} style={{ flex: 1, justifyContent: "center" }}>
              <input
                type="radio"
                name="wa-media-kind"
                checked={mediaKind === "pdf"}
                onChange={() => setMediaKind("pdf")}
                style={{ marginInlineEnd: 6 }}
              />
              بي دي اف (PDF)
            </label>
          </div>

          <div class="whatsapp-list" role="group" aria-label="قائمة الأرقام">
            {salesContacts.map((c: SalesContact) => {
              const checked = selected.has(c.phone);
              const err = errors[c.phone];
              const ok = success.includes(c.phone);
              return (
                <label
                  key={c.phone}
                  class={`whatsapp-option${checked ? " selected" : ""}${busy ? " disabled" : ""}${c.admin ? " admin" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={() => toggle(c.phone)}
                  />
                  <div class="whatsapp-option__body">
                    <div class="whatsapp-option__name">
                      {c.name}
                      {c.admin && <span class="whatsapp-admin-badge">ADMIN</span>}
                      {ok && <span class="whatsapp-badge ok">تم</span>}
                      {err && <span class="whatsapp-badge err">{err}</span>}
                    </div>
                    <div class="whatsapp-option__phone" dir="ltr">
                      {c.phone}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 12 }}>
            ملف الإرسال: <code>{mediaKind === "pdf" ? `عرض سعر - ${quotation.client || "—"} - ${new Date().toISOString().slice(0, 10)}.pdf` : `عرض سعر - ${quotation.client || "—"} - ${new Date().toISOString().slice(0, 10)}.png`}</code>
          </div>

          {step === "done" && success.length > 0 && (
            <p class="field-message" style={{ color: "var(--success)", fontWeight: 700 }}>
              تم الإرسال بنجاح إلى: {success.join(" ، ")}
            </p>
          )}
        </div>

        <div class="dialog__foot">
          <span class="spacer" />
          <button class="btn" onClick={onClose} disabled={busy}>
            {busy ? "جارٍ الإرسال…" : S.settings.close}
          </button>
          <button
            class="btn btn--primary"
            onClick={handleSend}
            disabled={!hasSelection || busy || missingConfig}
            style={{ background: "var(--success)", borderColor: "var(--success)" }}
          >
            إرسال واتساب
          </button>
        </div>
      </div>
    </div>
  );
}
