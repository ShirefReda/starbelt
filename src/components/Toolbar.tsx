import { S } from "../i18n/strings";
import type { AppState } from "../state/quotation";
import { CURRENT_VERSION } from "../config/version";
import {
  IconAdd,
  IconGear,
  IconHistory,
  IconNew,
  IconPdf,
  IconPrint,
  IconRedo,
  IconSparkle,
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
  hasUnseenUpdate?: boolean;
  onShowUpdates: () => void;
  onShowHistory?: () => void;
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
  hasUnseenUpdate = false,
  onShowUpdates,
  onShowHistory,
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
      : S.toolbar.saved;

  return (
    <div class="toolbar" role="toolbar" aria-label="شريط الأدوات">
      {/* 1. START SECTION: Brand, New, History, Add Item, Undo/Redo */}
      <div class="toolbar__section toolbar__start">
        <div class="toolbar__brand" title={state.company.name}>
          <img
            src={state.company.logo}
            alt=""
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <span class="toolbar__brand-name">ستار بيلت</span>
        </div>

        <div class="toolbar__group">
          <button
            type="button"
            class="btn btn--secondary"
            onClick={onNew}
            title={S.toolbar.newQuotation}
          >
            <IconNew />
            <span class="btn__label">عرض جديد</span>
          </button>
          {onShowHistory && (
            <button
              type="button"
              class="btn btn--secondary"
              onClick={onShowHistory}
              title="سجل عروض الأسعار السحابي"
            >
              <IconHistory />
              <span class="btn__label">السجل</span>
            </button>
          )}
          <button
            type="button"
            class="btn btn--add-item"
            onClick={onAddItem}
            title={S.toolbar.addItem}
          >
            <IconAdd />
            <span class="btn__label">إضافة صنف</span>
          </button>
        </div>

        <div class="toolbar__group toolbar__undo-group">
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
      </div>

      {/* 2. CENTER SECTION: Zoom, Saved Status, Version (Shrinks if screen is tight) */}
      <div class="toolbar__section toolbar__center">
        <div class="zoom" role="group" aria-label="تكبير العرض">
          <button
            type="button"
            onClick={onZoomOut}
            title={S.toolbar.zoomOut}
            aria-label={S.toolbar.zoomOut}
          >
            <IconZoomOut />
          </button>
          <button
            type="button"
            class="zoom__value zoom__fit-btn"
            onClick={onFit}
            title="انقر لملاءمة العرض"
            aria-label={S.toolbar.fitWidth}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            title={S.toolbar.zoomIn}
            aria-label={S.toolbar.zoomIn}
          >
            <IconZoomIn />
          </button>
        </div>

        <span
          class={`saved-pill saved-pill--${state.saveStatus}`}
          aria-live="polite"
          role="status"
          title={saveLabel}
        >
          <span class="saved-pill__dot" />
          <span class="saved-pill__label">{saveLabel}</span>
        </span>

        <button
          type="button"
          class={`btn-version${hasUnseenUpdate ? " btn-version--has-update" : ""}`}
          onClick={onShowUpdates}
          title={S.updates.toolbarTooltip}
        >
          <IconSparkle size={13} />
          <span class="btn-version__num">v{CURRENT_VERSION}</span>
          {hasUnseenUpdate && (
            <span class="btn-version__badge" title={S.updates.newBadge}>
              تحديث
            </span>
          )}
        </button>
      </div>

      {/* 3. END SECTION: Action buttons (PDF, WhatsApp, Print, Settings, Clear) ALWAYS VISIBLE AT LEFT */}
      <div class="toolbar__section toolbar__end">
        <button
          type="button"
          class="btn btn--gold"
          onClick={onDownloadPdf}
          title={S.toolbar.downloadPdf}
        >
          <IconPdf />
          <span class="btn__label">تحميل PDF</span>
        </button>
        <button
          type="button"
          class="btn btn--whatsapp"
          onClick={onSendWhatsapp}
          title={S.toolbar.sendWhatsapp}
        >
          <IconWhatsapp />
          <span class="btn__label">واتساب</span>
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
