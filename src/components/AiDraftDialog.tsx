import { useEffect, useRef, useState } from "preact/hooks";
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
    text: "شركة النيل للصناعات الغذائية عناية م. كريم، عايزين عرض سعر لـ 3 سير ناقل PVC أخضر 2 ply مقاس 50 سم × 12 متر السعر 4200 جنيه للسير، و2 سير Timing Belt HTD 8M بسعر 1000 جنيه للواحد، شامل ضريبة 14% والتوريد خلال 3 أيام.",
  },
  {
    label: "مثال: طلب سريع بخصم 5%",
    text: "عميل مصنع الفتح للبلاستيك: 4 سيور مطاط 60 سم × 15 متر سعر الواحد 6500، خصم 5%، السعر غير شامل الضريبة.",
  },
];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const b64 = dataUrl.includes(",") ? dataUrl.split(",").pop() || "" : dataUrl;
      resolve(b64);
    };
    reader.onerror = () => reject(new Error("تعذر قراءة التسجيل الصوتي"));
    reader.readAsDataURL(blob);
  });
}

export function AiDraftDialog({ onClose, onApplyQuotation, onToast }: AiDraftDialogProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !recording && !transcribing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [busy, recording, transcribing, onClose]);

  const handleToggleVoice = async () => {
    setError(null);
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("التسجيل الصوتي غير مدعوم في هذا المتصفح.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const preferredMime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
          ? "audio/ogg;codecs=opus"
          : "";
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const mime = recorder.mimeType || preferredMime || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        if (blob.size < 200) return;

        setTranscribing(true);
        try {
          const audioBase64 = await blobToBase64(blob);
          const res = await fetch("/api/fathy/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64, mimetype: mime }),
          });
          const payload = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            text?: string;
            error?: string;
          };
          if (!res.ok || !payload.ok || !payload.text) {
            throw new Error(payload.error || `تعذر تحويل الصوت لنص (HTTP ${res.status})`);
          }
          setText((prev) => (prev.trim() ? `${prev.trim()}\n${payload.text}` : payload.text || ""));
          onToast("تم تحويل الصوت لنص بنجاح 🎤");
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setTranscribing(false);
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? `تعذر فتح الميكروفون: ${err.message}`
          : "تعذر فتح الميكروفون. يرجى السماح بصلاحية الصوت.",
      );
    }
  };

  const handleGenerate = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("يرجى لصق رسالة العميل أو تسجيل رسالة صوتية أولاً.");
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
    <div
      class="overlay"
      role="dialog"
      aria-modal="true"
      onClick={() => !busy && !recording && !transcribing && onClose()}
    >
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <div class="dialog__head">
          <h2 class="dialog__title" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <IconSparkle size={18} />
            <span>إنشاء عرض سعر ذكي بفتحي AI</span>
          </h2>
          <button
            type="button"
            class="dialog__close"
            onClick={() => !busy && !recording && !transcribing && onClose()}
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>

        <div class="dialog__body">
          <p style={{ marginTop: 0, marginBottom: "12px", fontSize: "13.5px", color: "var(--text-muted)" }}>
            الصق رسالة العميل أو اضغط <b>إملاء صوتي</b> وتكلم بالعامية المصرية مع مواصفات السيور
            بالإنجليزية (مثل <code>PVC 2 ply</code> أو <code>HTD 8M</code>)، وسيقوم <b>فتحي AI</b> بتعبئة
            عرض السعر وحفظه سحابياً.
          </p>

          <div class="ai-examples-row">
            <button
              type="button"
              class={`ai-voice-btn${recording ? " ai-voice-btn--recording" : ""}`}
              disabled={busy || transcribing}
              onClick={() => void handleToggleVoice()}
            >
              {recording
                ? "⏹ إيقاف التسجيل والتحويل..."
                : transcribing
                  ? "⏳ جارٍ تحويل الصوت لنص..."
                  : "🎤 إملاء صوتي (عربي + إنجليزي)"}
            </button>
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex.label}
                type="button"
                class="ai-example-chip"
                disabled={busy || recording || transcribing}
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
              disabled={busy || transcribing}
              placeholder="مثال: شركة الرواد للصناعات، عناية م. أحمد، مطلوب 2 سير PVC أخضر 2 ply مقاس 50 سم × 10 متر بسعر 3500 جنيه، شامل ضريبة 14%..."
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
            💡 يمكنك أيضاً إرسال <b>رسالة صوتية (فويس نوت)</b> لفتحي على واتساب بالعامية المصرية
            ومواصفات السيور بالإنجليزية، وسيسمعها ويرسل لك عرض السعر PDF فوراً!
          </p>
        </div>

        <div class="dialog__foot">
          <button
            type="button"
            class="btn"
            disabled={busy || recording || transcribing}
            onClick={onClose}
          >
            إلغاء
          </button>
          <span class="spacer" />
          <button
            type="button"
            class="btn btn--primary"
            disabled={busy || recording || transcribing || !text.trim()}
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
