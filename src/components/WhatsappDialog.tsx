import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  IconAdd,
  IconArrowDown,
  IconArrowUp,
  IconClose,
  IconDrag,
  IconStar,
  IconTrash,
} from "./icons";
import {
  loadContacts,
  saveContactsOrder,
  toggleContactStar,
  saveCustomContact,
  deleteCustomContact,
  resetContactsOrder,
  sortStarredFirst,
  type ContactItem,
} from "../storage/contactsStorage";
import {
  normalizeContactNumber,
  formatPhoneForDisplay,
} from "../utils/whatsapp";
import {
  renderQuoteMedia,
  mediaFileName,
  type QuoteMediaKind,
  type RenderedQuoteMedia,
} from "../utils/quoteMedia";
import {
  resolveEvolutionConfig,
  sendQuotationMedia,
  type EvolutionConfig,
} from "../services/evolution";
import type { Quotation } from "../state/quotation";
import { S } from "../i18n/strings";

interface WhatsappDialogProps {
  quotation: Quotation;
  onClose: () => void;
  onToast: (msg: string, isError?: boolean) => void;
}

type Step = "render" | "done";

export function WhatsappDialog({ quotation, onClose, onToast }: WhatsappDialogProps) {
  const [contacts, setContacts] = useState<ContactItem[]>(() => loadContacts());
  const [selected, setSelected] = useState<Set<string>>(() => new Set<string>());
  const [mediaKind, setMediaKind] = useState<QuoteMediaKind>("png");
  const [step, setStep] = useState<Step>("render");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string[]>([]);
  const closingRef = useRef(false);

  // Custom unlisted number inputs
  const [customPhone, setCustomPhone] = useState("");
  const [customName, setCustomName] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  // Drag and drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const starredCount = useMemo(() => contacts.filter((c) => c.starred).length, [contacts]);
  const hasSelection = selected.size > 0 || customPhone.trim().length > 0;
  const config: EvolutionConfig | null = useMemo(() => resolveEvolutionConfig(), []);
  const missingConfig = !config;

  const toggle = (phone: string) => {
    if (busy) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  };

  const handleToggleStar = (phone: string) => {
    if (busy) return;
    const { contacts: updated, isStarred } = toggleContactStar(phone);
    setContacts(updated);
    if (isStarred) {
      onToast("تمت إضافة الرقم إلى المفضلة ⭐");
    }
  };

  const handleAddCustom = () => {
    const raw = customPhone.trim();
    if (!raw) {
      setCustomError("يرجى إدخال رقم الهاتف");
      return;
    }

    let normalized: string;
    try {
      normalized = normalizeContactNumber(raw);
    } catch (e) {
      setCustomError(e instanceof Error ? e.message : "رقم هاتف غير صالح");
      return;
    }

    const displayPhone = formatPhoneForDisplay(raw, normalized);

    // Check if phone already in contact list
    const existing = contacts.find(
      (c) => c.phone === displayPhone || normalizeContactNumber(c.phone) === normalized,
    );

    if (existing) {
      setSelected((prev) => new Set(prev).add(existing.phone));
      onToast(`الرقم (${existing.name}) موجود بالفعل بالقائمة وتم تحديده`);
      setCustomPhone("");
      setCustomName("");
      setCustomError(null);
      return;
    }

    const updated = saveCustomContact(customName || displayPhone, displayPhone);
    setContacts(updated);
    setSelected((prev) => new Set(prev).add(displayPhone));
    onToast(`تمت إضافة (${customName.trim() || displayPhone}) وتحديده للإرسال`);
    setCustomPhone("");
    setCustomName("");
    setCustomError(null);
  };

  const handleRemoveCustom = (phone: string) => {
    if (busy) return;
    const updated = deleteCustomContact(phone);
    setContacts(updated);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(phone);
      return next;
    });
    onToast("تم حذف الرقم من القائمة");
  };

  const handleSelectAll = () => {
    if (busy) return;
    setSelected(new Set(contacts.map((c) => c.phone)));
  };

  const handleSelectStarred = () => {
    if (busy) return;
    const starredOnly = contacts.filter((c) => c.starred).map((c) => c.phone);
    if (starredOnly.length === 0) {
      onToast("لا توجد أرقام مضافة في المفضلة بعد — اضغط على رمز ⭐ بجانب أي رقم لتفضيله", true);
      return;
    }
    setSelected(new Set(starredOnly));
    onToast(`تم تحديد ${starredOnly.length} من جهات الاتصال المفضلة`);
  };

  const handleDeselectAll = () => {
    if (busy) return;
    setSelected(new Set());
  };

  const handleSortStarredFirst = () => {
    if (busy) return;
    const sorted = sortStarredFirst();
    setContacts(sorted);
    onToast("تم ترتيب القائمة: المفضلة أولاً ⭐");
  };

  const handleResetOrder = () => {
    if (busy) return;
    const reset = resetContactsOrder();
    setContacts(reset);
    onToast("تمت استعادة الترتيب الافتراضي للقائمة");
  };

  // Reorder items by swap / move up & down
  const handleMove = (fromIndex: number, toIndex: number) => {
    if (busy || fromIndex < 0 || toIndex < 0 || toIndex >= contacts.length) return;
    const next = [...contacts];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    setContacts(next);
    saveContactsOrder(next);
  };

  // HTML5 Drag and drop handlers
  const handleDragStart = (e: DragEvent, index: number) => {
    if (busy) return;
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input")) {
      e.preventDefault();
      return;
    }
    setDragIndex(index);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    }
  };

  const handleDragOver = (e: DragEvent, index: number) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    handleMove(dragIndex, targetIndex);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleSend = async () => {
    if (missingConfig) {
      onToast("إعدادات واتساب غير مُهيأة — أضف VITE_EVOLUTION_BASE_URL و VITE_STARBELT_API_KEY في الإعدادات", true);
      return;
    }

    let currentSelected = new Set(selected);
    let currentContacts = contacts;

    // If user typed a custom phone in the box and directly pressed send
    const typedRaw = customPhone.trim();
    if (typedRaw) {
      try {
        const normalized = normalizeContactNumber(typedRaw);
        const displayPhone = formatPhoneForDisplay(typedRaw, normalized);
        const existing = currentContacts.find(
          (c) => c.phone === displayPhone || normalizeContactNumber(c.phone) === normalized,
        );

        if (existing) {
          currentSelected = new Set(currentSelected).add(existing.phone);
        } else {
          currentContacts = saveCustomContact(customName || displayPhone, displayPhone);
          setContacts(currentContacts);
          currentSelected = new Set(currentSelected).add(displayPhone);
        }
        setSelected(currentSelected);
        setCustomPhone("");
        setCustomName("");
        setCustomError(null);
      } catch (e) {
        setCustomError(e instanceof Error ? e.message : "رقم هاتف غير صالح");
        return;
      }
    }

    if (currentSelected.size === 0) {
      onToast("يرجى اختيار أو كتابة رقم هاتف واحد على الأقل", true);
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

    // Render media ONCE for all selected recipients
    let rendered: RenderedQuoteMedia;
    try {
      rendered = await renderQuoteMedia(sheetEl, quotation.client, mediaKind);
    } catch {
      setBusy(false);
      onToast("تعذر إنشاء ملف العرض للتصدير", true);
      return;
    }

    const targets = currentContacts.filter((c) => currentSelected.has(c.phone));
    for (const c of targets) {
      let num: string;
      try {
        num = normalizeContactNumber(c.phone);
      } catch (e) {
        nextErrors[c.phone] = e instanceof Error ? e.message : "رقم غير صالح";
        continue;
      }

      try {
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
    if (nextSuccess.length > 0) onToast(`تم الإرسال بنجاح إلى ${nextSuccess.length} رقم`);
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

  const currentFileName = mediaFileName(quotation.client, mediaKind);

  return (
    <div class="overlay" role="dialog" aria-modal="true" aria-label="إرسال واتساب" onClick={handleOverlayClose}>
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <div class="dialog__head">
          <h2 class="dialog__title">إرسال عبر واتساب</h2>
          <button class="dialog__close" onClick={onClose} aria-label={S.settings.close} disabled={busy}>
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
            اختر الصيغة (صورة أو PDF) والأرقام المطلوبة. يمكنك كتابة أي رقم إضافي غير مسجل وترتيب جهات الاتصال بالسحب كما تحب (تُحفظ تفضيلاتك محلياً بجهازك).
          </p>

          {/* Media Format Selector: PNG vs PDF */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <label class={`btn${mediaKind === "png" ? " btn--primary" : ""}`} style={{ flex: 1, justifyContent: "center" }}>
              <input
                type="radio"
                name="wa-media-kind"
                checked={mediaKind === "png"}
                onChange={() => setMediaKind("png")}
                disabled={busy}
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
                disabled={busy}
                style={{ marginInlineEnd: 6 }}
              />
              بي دي اف (PDF)
            </label>
          </div>

          {/* Unlisted / Custom Number Input Section */}
          <div class="whatsapp-add-box">
            <div class="whatsapp-add-box__header">
              <span class="whatsapp-add-box__title">
                إرسال لرقم غير مسجل بالقائمة
              </span>
              <span class="whatsapp-add-box__hint">
                اكتب الرقم مباشرة وسيتم تحديده وحفظه محلياً في جهازك
              </span>
            </div>
            <div class="whatsapp-add-box__row">
              <div class="whatsapp-add-box__input-wrap">
                <input
                  type="tel"
                  class="whatsapp-input"
                  placeholder="رقم الهاتف (مثل: 01012345678)"
                  dir="ltr"
                  value={customPhone}
                  onInput={(e) => {
                    setCustomPhone((e.target as HTMLInputElement).value);
                    if (customError) setCustomError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustom();
                    }
                  }}
                  disabled={busy}
                />
              </div>
              <div class="whatsapp-add-box__input-wrap name">
                <input
                  type="text"
                  class="whatsapp-input"
                  placeholder="الاسم (اختياري)"
                  value={customName}
                  onInput={(e) => setCustomName((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustom();
                    }
                  }}
                  disabled={busy}
                />
              </div>
              <button
                type="button"
                class="btn btn--primary whatsapp-add-btn"
                onClick={handleAddCustom}
                disabled={busy}
              >
                <IconAdd />
                <span>إضافة وتحديد</span>
              </button>
            </div>
            {customError && <div class="whatsapp-input-error">{customError}</div>}
          </div>

          {/* Quick Toolbar for Selection & Reordering */}
          <div class="whatsapp-toolbar">
            <div class="whatsapp-toolbar__left">
              <button
                type="button"
                class="whatsapp-toolbar-btn"
                onClick={handleSelectAll}
                disabled={busy || contacts.length === 0}
              >
                تحديد الكل ({contacts.length})
              </button>
              <button
                type="button"
                class="whatsapp-toolbar-btn"
                onClick={handleSelectStarred}
                disabled={busy || starredCount === 0}
                title="تحديد جهات الاتصال المفضلة فقط"
              >
                <span>⭐ المفضلة</span>
                {starredCount > 0 && <span class="whatsapp-count-badge">{starredCount}</span>}
              </button>
              {selected.size > 0 && (
                <button
                  type="button"
                  class="whatsapp-toolbar-btn text-muted"
                  onClick={handleDeselectAll}
                  disabled={busy}
                >
                  إلغاء التحديد
                </button>
              )}
            </div>

            <div class="whatsapp-toolbar__right">
              {starredCount > 0 && (
                <button
                  type="button"
                  class="whatsapp-toolbar-btn"
                  onClick={handleSortStarredFirst}
                  disabled={busy}
                  title="ترتيب جهات الاتصال بحيث تظهر المفضلة في البداية"
                >
                  ⭐ المفضلة أولاً
                </button>
              )}
              <button
                type="button"
                class="whatsapp-toolbar-btn text-muted"
                onClick={handleResetOrder}
                disabled={busy}
                title="استعادة الترتيب الافتراضي للقائمة"
              >
                إعادة الترتيب الافتراضي
              </button>
            </div>
          </div>

          {/* Contacts List with Drag & Drop and Stars */}
          <div class="whatsapp-list" role="group" aria-label="قائمة الأرقام">
            {contacts.map((c: ContactItem, index: number) => {
              const checked = selected.has(c.phone);
              const err = errors[c.phone];
              const ok = success.includes(c.phone);
              const isStarred = Boolean(c.starred);
              const isDragging = dragIndex === index;
              const isDragOver = dragOverIndex === index;

              return (
                <div
                  key={c.phone}
                  class={`whatsapp-option${checked ? " selected" : ""}${busy ? " disabled" : ""}${c.admin ? " admin" : ""}${isStarred ? " starred" : ""}${isDragging ? " is-dragging" : ""}${isDragOver ? " drag-over" : ""}`}
                  draggable={!busy}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  onClick={() => toggle(c.phone)}
                >
                  {/* Drag Handle */}
                  <div
                    class="whatsapp-drag-handle"
                    title="اسحب لإعادة الترتيب"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <IconDrag />
                  </div>

                  {/* Selection Checkbox */}
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggle(c.phone);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />

                  {/* Contact Details */}
                  <div class="whatsapp-option__body">
                    <div class="whatsapp-option__name">
                      <span>{c.name}</span>
                      {c.admin && <span class="whatsapp-admin-badge">ADMIN</span>}
                      {c.custom && <span class="whatsapp-custom-badge">مخصص</span>}
                      {isStarred && <span class="whatsapp-star-indicator" title="مفضلة">⭐</span>}
                      {ok && <span class="whatsapp-badge ok">تم</span>}
                      {err && <span class="whatsapp-badge err">{err}</span>}
                    </div>
                    <div class="whatsapp-option__phone" dir="ltr">
                      {c.phone}
                    </div>
                  </div>

                  <div class="whatsapp-option__spacer" />

                  {/* Option Actions: Reorder Up/Down, Star Toggle, Delete */}
                  <div class="whatsapp-option-actions" onClick={(e) => e.stopPropagation()}>
                    <div class="whatsapp-reorder-btns">
                      <button
                        type="button"
                        class="whatsapp-icon-btn whatsapp-move-btn"
                        title="تحريك لأعلى"
                        disabled={busy || index === 0}
                        onClick={() => handleMove(index, index - 1)}
                      >
                        <IconArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        class="whatsapp-icon-btn whatsapp-move-btn"
                        title="تحريك لأسفل"
                        disabled={busy || index === contacts.length - 1}
                        onClick={() => handleMove(index, index + 1)}
                      >
                        <IconArrowDown size={12} />
                      </button>
                    </div>

                    <button
                      type="button"
                      class={`whatsapp-icon-btn whatsapp-star-btn${isStarred ? " is-starred" : ""}`}
                      title={isStarred ? "إزالة من المفضلة" : "إضافة للمفضلة"}
                      disabled={busy}
                      onClick={() => handleToggleStar(c.phone)}
                    >
                      <IconStar filled={isStarred} size={18} />
                    </button>

                    {c.custom && (
                      <button
                        type="button"
                        class="whatsapp-icon-btn whatsapp-trash-btn"
                        title="حذف هذا الرقم من القائمة"
                        disabled={busy}
                        onClick={() => handleRemoveCustom(c.phone)}
                      >
                        <IconTrash size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 12 }}>
            ملف الإرسال: <code>{currentFileName}</code>
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
            {busy
              ? "جارٍ الإرسال…"
              : `إرسال واتساب${selected.size > 0 ? ` (${selected.size})` : customPhone.trim() ? " (1)" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
