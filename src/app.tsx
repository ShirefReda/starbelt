import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { actions, repo, store, quotationFileName } from "./state/actions";
import type { AppState, Quotation } from "./state/quotation";
import { migrateQuotation } from "./state/quotation";
import { S } from "./i18n/strings";
import { Toolbar } from "./components/Toolbar";
import { Sheet } from "./components/Sheet";
import { SettingsDialog } from "./components/SettingsDialog";
import { WhatsappDialog } from "./components/WhatsappDialog";
import { exportPdf } from "./pdf/exporter";
import { requestFocus } from "./state/focusBus";
import { mergeCompany } from "./config/companyMerge";

type Toast = { id: number; msg: string; error?: boolean };

export function App() {
  const [state, setState] = useState<AppState>(() => store.get());
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showWhatsapp, setShowWhatsapp] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showHint, setShowHint] = useState(() => !localStorage.getItem("sb.hintSeen"));
  const workspaceRef = useRef<HTMLDivElement>(null);
  const toastId = useRef(0);

  // Subscribe to the store.
  useEffect(() => store.subscribe(setState), []);

  // ---- Autosave -----------------------------------------------------------
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    store.patch({ saveStatus: "dirty" });
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const q = store.get().quotation;
      repo.saveDraft({ ...q, updatedAt: new Date().toISOString() });
      store.patch({ saveStatus: "saved" });
    }, 500);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [state.quotation]);

  const pushToast = useCallback((msg: string, error = false) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, error }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  // ---- Fit-to-width -------------------------------------------------------
  const computeFit = useCallback(() => {
    const el = workspaceRef.current;
    if (!el) return 1;
    const available = el.clientWidth - 48; // padding
    const pagePx = 210 * (96 / 25.4);
    return Math.min(1, Math.max(0.3, available / pagePx));
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (fitMode) setZoom(computeFit());
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitMode, computeFit]);

  // ---- PDF / print --------------------------------------------------------
  const runExport = useCallback(
    async (raster: boolean) => {
      setPdfBusy(true);
      try {
        await exportPdf(
          store.get().quotation,
          {
            onStart: () => setPdfBusy(true),
            onDone: () => setPdfBusy(false),
            onError: (m) => {
              setPdfBusy(false);
              pushToast(`تعذر إنشاء PDF (${m})`, true);
            },
          },
          raster,
        );
        if (!raster) pushToast(S.toasts.printInstructions);
      } catch {
        setPdfBusy(false);
      }
    },
    [pushToast],
  );

  const handleDownloadPdf = useCallback(() => void runExport(false), [runExport]);
  const handleDirectPdf = useCallback(() => void runExport(true), [runExport]);

  // ---- Keyboard shortcuts -------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "p") {
        e.preventDefault();
        void runExport(false);
      } else if (key === "s") {
        e.preventDefault();
        void runExport(false);
      } else if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        actions.undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        actions.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runExport]);

  // ---- Actions ------------------------------------------------------------
  const handleAddItem = useCallback(() => {
    actions.addItem();
    const row = store.get().quotation.items.length - 1;
    requestFocus({ row, cell: "item" });
  }, []);

  const handleNew = useCallback(() => {
    if (confirm(S.confirm.newQuotationMessage)) {
      actions.newQuotation();
      pushToast(S.confirm.newQuotationTitle);
    }
  }, [pushToast]);

  const handleClear = useCallback(() => setConfirmClear(true), []);

  const doClear = useCallback(() => {
    actions.clearQuotation();
    setConfirmClear(false);
  }, []);

  const handleSaveCompany = useCallback((company: AppState["company"]) => {
    store.patch({ company });
  }, []);

  const handleResetCompany = useCallback(() => {
    store.patch({ company: mergeCompany({}) });
  }, []);

  const handleImportQuotation = useCallback((q: Quotation) => {
    const migrated = migrateQuotation(q);
    if (migrated) actions.loadQuotation(migrated);
  }, []);

  const dismissHint = useCallback(() => {
    setShowHint(false);
    localStorage.setItem("sb.hintSeen", "1");
  }, []);

  const fileName = useMemo(() => quotationFileName(state.quotation), [state.quotation]);

  return (
    <>
      <div id="app-chrome">
        <Toolbar
          state={state}
          canUndo={store.canUndo}
          canRedo={store.canRedo}
          zoom={zoom}
          onNew={handleNew}
          onAddItem={handleAddItem}
          onDownloadPdf={handleDownloadPdf}
          onSendWhatsapp={() => setShowWhatsapp(true)}
          onPrint={handleDownloadPdf}
          onSettings={() => setShowSettings(true)}
          onClear={handleClear}
          onUndo={() => actions.undo()}
          onRedo={() => actions.redo()}
          onZoomIn={() => {
            setFitMode(false);
            setZoom((z) => Math.min(2, Math.round((z + 0.1) * 100) / 100));
          }}
          onZoomOut={() => {
            setFitMode(false);
            setZoom((z) => Math.max(0.3, Math.round((z - 0.1) * 100) / 100));
          }}
          onFit={() => {
            setFitMode(true);
            setZoom(computeFit());
          }}
        />
      </div>

      <main class="workspace" ref={workspaceRef} aria-label={S.a11y.mainContent}>
        <Sheet state={state} zoom={zoom} />
      </main>

      {showHint && (
        <div class="empty-hint" role="status">
          <span class="empty-hint__icon">؟</span>
          <span>
            اكتب مباشرة على الورقة. اضغط <b>Enter</b> في آخر خانة لإضافة سطر جديد، و<b>Ctrl+S</b>{" "}
            لتحميل PDF.
          </span>
          <button class="empty-hint__close" onClick={dismissHint} aria-label="إغلاق">
            ×
          </button>
        </div>
      )}

      <div class="toasts" aria-live="polite">
        {toasts.map((tst) => (
          <div key={tst.id} class={`toast${tst.error ? " toast--error" : ""}`}>
            {tst.msg}
          </div>
        ))}
      </div>

      {pdfBusy && (
        <div class="pdf-overlay" role="alert" aria-busy="true">
          <div class="pdf-overlay__box">
            <div class="pdf-overlay__spinner" />
            <div style={{ fontWeight: 700 }}>{S.toasts.pdfReady}</div>
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>{fileName}</div>
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsDialog
          state={state}
          onClose={() => setShowSettings(false)}
          onSaveCompany={handleSaveCompany}
          onResetCompany={handleResetCompany}
          onImportQuotation={handleImportQuotation}
          onToast={pushToast}
        />
      )}

      {showWhatsapp && (
        <WhatsappDialog
          quotation={state.quotation}
          onClose={() => setShowWhatsapp(false)}
          onToast={pushToast}
        />
      )}

      {confirmClear && (
        <div class="overlay" role="dialog" aria-modal="true" onClick={() => setConfirmClear(false)}>
          <div class="dialog dialog--sm" onClick={(e) => e.stopPropagation()}>
            <div class="dialog__head">
              <h2 class="dialog__title">{S.confirm.clearTitle}</h2>
            </div>
            <div class="dialog__body">
              <p style={{ margin: 0 }}>{S.confirm.clearMessage}</p>
            </div>
            <div class="dialog__foot">
              <span class="spacer" />
              <button class="btn" onClick={() => setConfirmClear(false)}>
                {S.confirm.cancel}
              </button>
              <button class="btn btn--danger" onClick={doClear}>
                {S.confirm.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden direct-download entry point used by the toolbar fallback. */}
      <button
        type="button"
        class="visually-hidden"
        id="direct-pdf"
        onClick={handleDirectPdf}
        aria-hidden="true"
        tabIndex={-1}
      />
    </>
  );
}
