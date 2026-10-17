import { useRef, useState } from "preact/hooks";
import type { AppState, Quotation } from "../state/quotation";
import { S } from "../i18n/strings";
import { companyDefaults } from "../config/company";
import { diffCompany } from "../config/companyMerge";
import { repo, actions } from "../state/actions";
import { IconClose } from "./icons";

interface SettingsDialogProps {
  state: AppState;
  onClose: () => void;
  onSaveCompany: (next: AppState["company"]) => void;
  onResetCompany: () => void;
  onImportQuotation: (q: Quotation) => void;
  onToast: (msg: string, isError?: boolean) => void;
}

export function SettingsDialog({
  state,
  onClose,
  onSaveCompany,
  onResetCompany,
  onImportQuotation,
  onToast,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState(state.company);
  const [options, setOptions] = useState(state.quotation.options);
  const importRef = useRef<HTMLInputElement>(null);

  const update = (key: keyof typeof companyDefaults, value: string | string[] | unknown) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const save = () => {
    const merged = { ...companyDefaults, ...draft };
    onSaveCompany(merged);
    repo.saveCompanyOverrides(diffCompany(merged));
    for (const key of Object.keys(options) as (keyof typeof options)[]) {
      actions.setOption(key, options[key]);
    }
    onToast(S.settings.saved);
    onClose();
  };

  const reset = () => {
    if (!window.confirm(S.settings.resetConfirm)) return;
    repo.clearCompanyOverrides();
    onResetCompany();
    onToast(S.settings.saved);
    onClose();
  };

  const exportJson = () => {
    const q = state.quotation;
    const blob = new Blob(
      [JSON.stringify({ app: "starbelt-quotation", version: 1, quotation: q }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `بيان سعر - ${q.client || "مسودة"} - ${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const raw = JSON.parse(text) as unknown;
      const candidate = (raw as { quotation?: Quotation })?.quotation ?? (raw as Quotation);
      if (!candidate || typeof candidate.id !== "string" || !Array.isArray(candidate.items)) {
        throw new Error("bad");
      }
      onImportQuotation(candidate);
      onToast(S.toasts.imported);
      onClose();
    } catch {
      onToast(S.toasts.importError, true);
    }
  };

  return (
    <div
      class="overlay"
      role="dialog"
      aria-modal="true"
      aria-label={S.settings.title}
      onClick={onClose}
    >
      <div class="dialog" onClick={(e) => e.stopPropagation()}>
        <div class="dialog__head">
          <h2 class="dialog__title">{S.settings.title}</h2>
          <button class="dialog__close" onClick={onClose} aria-label={S.settings.close}>
            <IconClose />
          </button>
        </div>
        <div class="dialog__body">
          <fieldset class="fieldset">
            <legend class="fieldset__legend">{S.settings.companySection}</legend>
            <div class="field">
              <label class="field__label" for="set-name">
                {S.settings.companyName}
              </label>
              <input
                id="set-name"
                class="input"
                value={draft.name}
                onInput={(e) => update("name", (e.currentTarget as HTMLInputElement).value)}
              />
            </div>
            <div class="grid-2">
              <div class="field">
                <label class="field__label" for="set-tax">
                  {S.settings.taxCard}
                </label>
                <input
                  id="set-tax"
                  class="input"
                  dir="ltr"
                  value={draft.taxCard}
                  onInput={(e) => update("taxCard", (e.currentTarget as HTMLInputElement).value)}
                />
              </div>
              <div class="field">
                <label class="field__label" for="set-taxlabel">
                  {S.settings.taxCardLabel}
                </label>
                <input
                  id="set-taxlabel"
                  class="input"
                  value={draft.taxCardLabel}
                  onInput={(e) =>
                    update("taxCardLabel", (e.currentTarget as HTMLInputElement).value)
                  }
                />
              </div>
              <div class="field">
                <label class="field__label" for="set-reg">
                  {S.settings.commercialRegister}
                </label>
                <input
                  id="set-reg"
                  class="input"
                  dir="ltr"
                  value={draft.commercialRegister}
                  onInput={(e) =>
                    update("commercialRegister", (e.currentTarget as HTMLInputElement).value)
                  }
                />
              </div>
              <div class="field">
                <label class="field__label" for="set-reglabel">
                  {S.settings.commercialRegisterLabel}
                </label>
                <input
                  id="set-reglabel"
                  class="input"
                  value={draft.commercialRegisterLabel}
                  onInput={(e) =>
                    update("commercialRegisterLabel", (e.currentTarget as HTMLInputElement).value)
                  }
                />
              </div>
            </div>
            <div class="field">
              <label class="field__label" for="set-addr">
                {S.settings.address}
              </label>
              <input
                id="set-addr"
                class="input"
                value={draft.address}
                onInput={(e) => update("address", (e.currentTarget as HTMLInputElement).value)}
              />
            </div>
            <div class="grid-2">
              <div class="field">
                <label class="field__label" for="set-email">
                  {S.settings.email}
                </label>
                <input
                  id="set-email"
                  class="input"
                  dir="ltr"
                  value={draft.email}
                  onInput={(e) => update("email", (e.currentTarget as HTMLInputElement).value)}
                />
              </div>
              <div class="field">
                <label class="field__label" for="set-phones">
                  {S.settings.phones}
                </label>
                <textarea
                  id="set-phones"
                  class="textarea"
                  dir="ltr"
                  style={{ minHeight: 60 }}
                  value={draft.phones.map((p) => p.value).join("\n")}
                  onInput={(e) =>
                    update(
                      "phones",
                      (e.currentTarget as HTMLTextAreaElement).value
                        .split("\n")
                        .map((v) => v.trim())
                        .filter(Boolean)
                        .map((value) => ({ value })),
                    )
                  }
                />
              </div>
            </div>
            <div class="grid-2">
              <div class="field">
                <label class="field__label" for="set-notes">
                  {S.settings.defaultNotes}
                </label>
                <textarea
                  id="set-notes"
                  class="textarea"
                  value={draft.defaultNotes.join("\n")}
                  onInput={(e) =>
                    update(
                      "defaultNotes",
                      (e.currentTarget as HTMLTextAreaElement).value
                        .split("\n")
                        .map((v) => v.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </div>
              <div class="grid-2" style={{ display: "grid", gap: "12px", alignContent: "start" }}>
                <div class="field">
                  <label class="field__label" for="set-approver">
                    {S.settings.defaultApprover}
                  </label>
                  <input
                    id="set-approver"
                    class="input"
                    value={draft.defaultApprover}
                    onInput={(e) =>
                      update("defaultApprover", (e.currentTarget as HTMLInputElement).value)
                    }
                  />
                </div>
                <div class="field">
                  <label class="field__label" for="set-thanks">
                    {S.settings.thankYou}
                  </label>
                  <input
                    id="set-thanks"
                    class="input"
                    value={draft.thankYou}
                    onInput={(e) => update("thankYou", (e.currentTarget as HTMLInputElement).value)}
                  />
                </div>
              </div>
            </div>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset__legend">{S.settings.documentSection}</legend>
            <label class="switch">
              <input
                type="checkbox"
                checked={options.showNumberAndDate}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    showNumberAndDate: (e.currentTarget as HTMLInputElement).checked,
                  }))
                }
              />
              {S.settings.showNumberAndDate}
            </label>
            <label class="switch">
              <input
                type="checkbox"
                checked={options.showVat}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    showVat: (e.currentTarget as HTMLInputElement).checked,
                  }))
                }
              />
              {S.settings.showVat}
            </label>
            <label class="switch switch--sub">
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={options.vatRate}
                disabled={!options.showVat}
                class="input"
                style={{ width: 90 }}
                onInput={(e) =>
                  setOptions((o) => ({
                    ...o,
                    vatRate: Number((e.currentTarget as HTMLInputElement).value),
                  }))
                }
              />
              {S.settings.vatRate}
            </label>
            <label class="switch">
              <input
                type="checkbox"
                checked={options.showDiscount}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    showDiscount: (e.currentTarget as HTMLInputElement).checked,
                  }))
                }
              />
              {S.settings.showDiscount}
            </label>
            {options.showDiscount && (
              <div style={{ paddingInlineStart: 28, display: "flex", flexDirection: "column", gap: 8, marginBlock: 6 }}>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                    <input
                      type="radio"
                      name="settings-discount-type"
                      checked={options.discountType !== "fixed"}
                      onChange={() => setOptions((o) => ({ ...o, discountType: "percent" }))}
                    />
                    {S.settings.discountTypePercent}
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                    <input
                      type="radio"
                      name="settings-discount-type"
                      checked={options.discountType === "fixed"}
                      onChange={() => setOptions((o) => ({ ...o, discountType: "fixed" }))}
                    />
                    {S.settings.discountTypeFixed}
                  </label>
                </div>
                <label class="switch switch--sub" style={{ margin: 0 }}>
                  {options.discountType === "fixed" ? (
                    <>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={options.discountValue}
                        class="input"
                        style={{ width: 110 }}
                        onInput={(e) =>
                          setOptions((o) => ({
                            ...o,
                            discountValue: Number((e.currentTarget as HTMLInputElement).value),
                          }))
                        }
                      />
                      {S.settings.discountValue}
                    </>
                  ) : (
                    <>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={options.discountPercent}
                        class="input"
                        style={{ width: 90 }}
                        onInput={(e) =>
                          setOptions((o) => ({
                            ...o,
                            discountPercent: Number((e.currentTarget as HTMLInputElement).value),
                          }))
                        }
                      />
                      {S.settings.discountPercent}
                    </>
                  )}
                </label>
              </div>
            )}
            <label class="switch">
              <input
                type="checkbox"
                checked={options.showWords}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    showWords: (e.currentTarget as HTMLInputElement).checked,
                  }))
                }
              />
              {S.settings.showWords}
            </label>
            <label class="switch">
              <input
                type="checkbox"
                checked={options.showValidity}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    showValidity: (e.currentTarget as HTMLInputElement).checked,
                  }))
                }
              />
              {S.settings.showValidity}
            </label>
            <label class="switch switch--sub">
              <input
                type="number"
                min="1"
                max="365"
                value={options.validityDays}
                disabled={!options.showValidity}
                class="input"
                style={{ width: 90 }}
                onInput={(e) =>
                  setOptions((o) => ({
                    ...o,
                    validityDays: Number((e.currentTarget as HTMLInputElement).value),
                  }))
                }
              />
              {S.settings.validityDays}
            </label>
            <label class="switch">
              <input
                type="checkbox"
                checked={options.showWatermark}
                onChange={(e) =>
                  setOptions((o) => ({
                    ...o,
                    showWatermark: (e.currentTarget as HTMLInputElement).checked,
                  }))
                }
              />
              {S.settings.showWatermark}
            </label>
          </fieldset>

          <fieldset class="fieldset">
            <legend class="fieldset__legend">{S.settings.exportJson}</legend>
            <div class="toolbar__group" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button type="button" class="btn" onClick={exportJson}>
                {S.settings.exportJson}
              </button>
              <button type="button" class="btn" onClick={() => importRef.current?.click()}>
                {S.settings.importJson}
              </button>
              <span style={{ color: "var(--text-faint)", fontSize: 12, alignSelf: "center" }}>
                {S.settings.importJsonHint}
              </span>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = (e.currentTarget as HTMLInputElement).files?.[0];
                  if (file) void handleImportFile(file);
                  (e.currentTarget as HTMLInputElement).value = "";
                }}
              />
            </div>
          </fieldset>
        </div>
        <div class="dialog__foot">
          <button type="button" class="btn btn--danger" onClick={reset}>
            {S.settings.reset}
          </button>
          <span class="spacer" />
          <button type="button" class="btn" onClick={onClose}>
            {S.settings.close}
          </button>
          <button type="button" class="btn btn--primary" onClick={save}>
            {S.settings.saved}
          </button>
        </div>
      </div>
    </div>
  );
}
