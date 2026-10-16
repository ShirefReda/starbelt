import { S } from "../i18n/strings";
import type { AppState } from "../state/quotation";
import {
  IconAdd,
  IconFit,
  IconGear,
  IconNew,
  IconPdf,
  IconPrint,
  IconRedo,
  IconTrash,
  IconUndo,
  IconWhatsapp,
  IconZoomIn,
  IconZoomOut,
} from "./icons";

interface ToolbarProps {
  state: AppState;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  onNew: () => void;
  onAddItem: () => void;
  onDownloadPdf: () => void;
  onSendWhatsapp: () => void;
  onPrint: () => void;
  onSettings: () => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

export function Toolbar({
  state,
  canUndo,
  canRedo,
  zoom,
  onNew,
  onAddItem,
  onDownloadPdf,
  onSendWhatsapp,
  onPrint,
  onSettings,
  onClear,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFit,
}: ToolbarProps) {
  const saveLabel =
    state.saveStatus === "dirty"
      ? S.toolbar.saving
      : state.saveStatus === "saved"
        ? S.toolbar.saved
        : S.toolbar.saved;

  return (
    <div class="toolbar" role="toolbar" aria-label="شريط الأدوات">
      <div class="toolbar__brand">
        <img
          src={state.company.logo}
          alt=""
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <span class="toolbar__brand-name">{state.company.name}</span>
      </div>

      <div class="toolbar__group">
        <button type="button" class="btn" onClick={onNew} title={S.toolbar.newQuotation}>
          <IconNew />
          <span class="btn__label">{S.toolbar.newQuotation}</span>
        </button>
        <button type="button" class="btn btn--add-item" onClick={onAddItem} title={S.toolbar.addItem}>
          <IconAdd />
          <span class="btn__label">{S.toolbar.addItem}</span>
        </button>
      </div>

      <div class="toolbar__group">
        <button
          type="button"
          class="btn btn--icon"
          onClick={onUndo}
          disabled={!canUndo}
          title={S.toolbar.undo}
          aria-label={S.toolbar.undo}
        >
          <IconUndo />
        </button>
        <button
          type="button"
          class="btn btn--icon"
          onClick={onRedo}
          disabled={!canRedo}
          title={S.toolbar.redo}
          aria-label={S.toolbar.redo}
        >
          <IconRedo />
        </button>
      </div>

      <div class="toolbar__spacer" />

      <div class="zoom" role="group" aria-label="تكبير العرض">
        <button
          type="button"
          onClick={onZoomOut}
          title={S.toolbar.zoomOut}
          aria-label={S.toolbar.zoomOut}
        >
          <IconZoomOut />
        </button>
        <span class="zoom__value" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={onZoomIn}
          title={S.toolbar.zoomIn}
          aria-label={S.toolbar.zoomIn}
        >
          <IconZoomIn />
        </button>
        <button
          type="button"
          onClick={onFit}
          title={S.toolbar.fitWidth}
          aria-label={S.toolbar.fitWidth}
        >
          <IconFit />
        </button>
      </div>

      <span class={`saved-pill saved-pill--${state.saveStatus}`} aria-live="polite" role="status">
        <span class="saved-pill__dot" />
        {saveLabel}
      </span>

      <div class="toolbar__group">
        <button
          type="button"
          class="btn btn--gold"
          onClick={onDownloadPdf}
          title={S.toolbar.downloadPdf}
        >
          <IconPdf />
          <span class="btn__label">{S.toolbar.downloadPdf}</span>
        </button>
        <button
          type="button"
          class="btn"
          onClick={onSendWhatsapp}
          title={S.toolbar.sendWhatsapp}
          style={{ background: "var(--success)", borderColor: "var(--success)", color: "#fff" }}
        >
          <IconWhatsapp />
          <span class="btn__label">{S.toolbar.sendWhatsapp}</span>
        </button>
        <button
          type="button"
          class="btn btn--icon"
          onClick={onPrint}
          title={S.toolbar.print}
          aria-label={S.toolbar.print}
        >
          <IconPrint />
        </button>
        <button
          type="button"
          class="btn btn--icon"
          onClick={onSettings}
          title={S.toolbar.settings}
          aria-label={S.toolbar.settings}
        >
          <IconGear />
        </button>
        <button
          type="button"
          class="btn btn--icon btn--danger"
          onClick={onClear}
          title={S.toolbar.clear}
          aria-label={S.toolbar.clear}
        >
          <IconTrash />
        </button>
      </div>
    </div>
  );
}
