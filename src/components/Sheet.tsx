import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { actions, store, repo } from "../state/actions";
import type { AppState, Quotation, QuoteItem, QuoteOptions } from "../state/quotation";
import { computeTotals, lineTotal } from "../utils/totals";
import { formatInt, formatMoney } from "../utils/money";
import { tafqeet } from "../utils/numberToWords";
import { displayDate } from "../utils/id";
import { t, S } from "../i18n/strings";
import { CONTENT_H, CONTENT_W } from "../utils/geometry";
import { paginateRows } from "../utils/pagination";
import { AutoTextarea } from "./AutoTextarea";
import { NumericInput } from "./NumericInput";
import { ItemNameInput } from "./ItemNameInput";
import { IconDrag, IconTrash } from "./icons";
import { onFocusRequest, requestFocus, type CellKind } from "../state/focusBus";

interface SheetProps {
  state: AppState;
  zoom: number;
}

interface BuiltPage {
  items: QuoteItem[];
  startIndex: number;
  showTail: boolean;
}

export function Sheet({ state, zoom }: SheetProps) {
  const { quotation, company } = state;
  const options = quotation.options;
  const totals = useMemo(() => computeTotals(quotation.items, options), [quotation.items, options]);

  const [logoOk, setLogoOk] = useState(true);
  const [itemNames, setItemNames] = useState<string[]>(() => repo.getItemNames());
  const [breaks, setBreaks] = useState<number[]>([quotation.items.length]);
  const measureRef = useRef<HTMLDivElement>(null);

  // Keep the autocomplete list in sync with what has been typed so far.
  useEffect(() => {
    const unsub = store.subscribe(() => {
      const names = repo.getItemNames();
      setItemNames((prev) => (prev.join("\u0000") === names.join("\u0000") ? prev : names));
    });
    return unsub;
  }, []);

  // Focus bus: move the caret after a row is added or Enter is pressed.
  useEffect(
    () =>
      onFocusRequest(({ row, cell }) => {
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(
            `[data-row="${row}"][data-cell="${cell}"]`,
          );
          if (el) {
            el.focus();
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              const len = el.value.length;
              el.setSelectionRange?.(len, len);
            }
          }
        });
      }),
    [],
  );

  // Measure the real sheet and compute page breaks.
  useLayoutEffect(() => {
    const root = measureRef.current;
    if (!root) return;

    const measure = () => {
      const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-measure-row]"));
      const titleH = heightOf(root, "[data-measure-title]");
      const clientH = heightOf(root, "[data-measure-client]");
      const headH = heightOf(root, "[data-measure-head]");
      const tailH = heightOf(root, "[data-measure-tail]");
      const metaH = options.showNumberAndDate ? 26 : 0;
      const rowHeights = rows.map((r) => r.getBoundingClientRect().height);

      const firstPageRowCapacity = Math.max(40, CONTENT_H - titleH - metaH - clientH - headH);
      const otherPageRowCapacity = Math.max(40, CONTENT_H - headH);

      const result = paginateRows({
        rowHeights,
        firstPageRowCapacity,
        otherPageRowCapacity,
        tailHeight: tailH,
        tableHeadHeight: headH,
      });

      const next: number[] = [];
      let count = 0;
      for (const page of result.pages) {
        count += page.length;
        next.push(count);
      }
      if (result.tailAlone) next.push(count);
      setBreaks((prev) => (prev.join(",") === next.join(",") ? prev : next));
    };

    measure();
    // Re-measure when web fonts finish loading (heights change).
    if (document.fonts?.ready) void document.fonts.ready.then(measure);
  }, [
    quotation.items,
    quotation.notes,
    quotation.client,
    quotation.attention,
    quotation.date,
    quotation.approver,
    quotation.thankYou,
    options,
    company,
    zoom,
  ]);

  const pages = useMemo(() => buildPages(quotation, breaks), [quotation, breaks]);
  const pageCount = Math.max(1, pages.length);
  const currentDate = quotation.date || displayDate(new Date(quotation.createdAt || Date.now()));

  return (
    <>
      {/* Off-screen measuring copy — real content, never shown or printed. */}
      <div class="sheet-measure" ref={measureRef} aria-hidden="true">
        <div data-measure-title style={{ width: `${CONTENT_W}px` }}>
          <div class="doc-title">بيان سعر</div>
        </div>
        <div data-measure-client style={{ width: `${CONTENT_W}px` }}>
          <div class="client-date-row">
            <div class="client-lines">
              <div class="client-line">
                <span class="client-line__prefix">{S.sheet.clientPrefix}</span>
                <span>{quotation.client || S.sheet.clientPlaceholder}</span>
              </div>
              {quotation.attention !== undefined && (
                <div class="client-line attention-line">
                  <span class="client-line__prefix">{S.sheet.attentionPrefix}</span>
                  <span>{quotation.attention || S.sheet.attentionPlaceholder}</span>
                </div>
              )}
            </div>
            <div class="date-line">
              <span class="date-line__prefix">{S.sheet.datePrefix}</span>
              <span>{currentDate}</span>
            </div>
          </div>
        </div>
        <table class="table-wrap" style={{ width: `${CONTENT_W}px` }}>
          <thead>
            <tr data-measure-head>
              <th class="col-num">{S.sheet.colIndex}</th>
              <th class="col-item">{S.sheet.colItem}</th>
              <th class="col-qty">{S.sheet.colQty}</th>
              <th class="col-price">{S.sheet.colPrice}</th>
              <th class="col-total">{S.sheet.colTotal}</th>
            </tr>
          </thead>
          <tbody>
            {quotation.items.map((item, i) => (
              <tr key={item.id} data-measure-row={i}>
                <td class="cell-num">{i + 1}</td>
                <td class="cell-item">
                  <div class="item-editor">{item.name || "‏"}</div>
                </td>
                <td class="cell-qty">{formatInt(item.qty)}</td>
                <td class="cell-price">{formatMoney(item.price)}</td>
                <td class="cell-total">{formatMoney(lineTotal(item))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div data-measure-tail style={{ width: `${CONTENT_W}px` }}>
          <TailBlock quotation={quotation} totals={totals} measuring />
        </div>
      </div>

      {/* Visible sheet, scaled by the zoom control. */}
      <div class="sheet-scale" style={{ transform: `scale(${zoom})` }}>
        <div class="sheet">
          {pages.map((page, pageIdx) => (
            <SheetPage
              key={pageIdx}
              pageIndex={pageIdx}
              pageCount={pageCount}
              quotation={quotation}
              company={company}
              totals={totals}
              page={page}
              logoOk={logoOk}
              onLogoError={() => setLogoOk(false)}
              itemNames={itemNames}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function heightOf(root: HTMLElement, selector: string): number {
  return root.querySelector<HTMLElement>(selector)?.getBoundingClientRect().height ?? 0;
}

function buildPages(quotation: Quotation, breaks: number[]): BuiltPage[] {
  const items = quotation.items;
  const pages: BuiltPage[] = [];
  let start = 0;
  for (const end of breaks) {
    const clamped = Math.min(end, items.length);
    pages.push({ items: items.slice(start, clamped), startIndex: start, showTail: false });
    start = clamped;
  }
  if (start < items.length) {
    pages.push({ items: items.slice(start), startIndex: start, showTail: false });
  }
  if (pages.length === 0) pages.push({ items: [], startIndex: 0, showTail: false });
  pages[pages.length - 1]!.showTail = true;
  return pages;
}

interface SheetPageProps {
  pageIndex: number;
  pageCount: number;
  quotation: Quotation;
  company: AppState["company"];
  totals: ReturnType<typeof computeTotals>;
  page: BuiltPage;
  logoOk: boolean;
  onLogoError: () => void;
  itemNames: string[];
}

function SheetPage({
  pageIndex,
  pageCount,
  quotation,
  company,
  totals,
  page,
  logoOk,
  onLogoError,
  itemNames,
}: SheetPageProps) {
  const options = quotation.options;
  const isFirst = pageIndex === 0;
  const { items, startIndex, showTail } = page;
  const currentDate = quotation.date || displayDate(new Date(quotation.createdAt || Date.now()));

  return (
    <div class="sheet-page" data-page={pageIndex}>
      {options.showWatermark && logoOk && (
        <div class="page-watermark" aria-hidden="true">
          <img src={company.logo} alt="" onError={onLogoError} />
        </div>
      )}

      <header class="page-band band-header">
        <div class="band-header__inner">
          <div class="company-block">
            <div class="company-block__name">{company.name}</div>
            <div class="company-block__meta">
              {company.taxCardLabel} {company.taxCard}
            </div>
            <div class="company-block__meta">
              {company.commercialRegisterLabel} {company.commercialRegister}
            </div>
          </div>
          {logoOk && (
            <div class="logo-block">
              <img src={company.logo} alt={company.name} onError={onLogoError} />
            </div>
          )}
        </div>
      </header>

      <div class="page-body">
        {isFirst ? (
          <>
            <h1 class="doc-title">بيان سعر</h1>
            {options.showNumberAndDate && (
              <div class="doc-meta">
                <span>
                  {S.options.quotationNumber}: {quotation.number}
                </span>
                <span>
                  {S.options.date}: {currentDate}
                </span>
              </div>
            )}
            <div class="client-date-row">
              <div class="client-lines">
                <div class="client-line">
                  {/* Screen: editable input */}
                  <span class="client-line__screen" dir="rtl">
                    <span class="client-line__text">
                      <span class="client-line__prefix">{S.sheet.clientPrefix}</span>
                      <input
                        class="client-line__input"
                        type="text"
                        value={quotation.client}
                        placeholder={S.sheet.clientPlaceholder}
                        aria-label={S.sheet.clientPlaceholder}
                        onInput={(e) => actions.setClient((e.currentTarget as HTMLInputElement).value)}
                      />
                    </span>
                    {quotation.attention === undefined && (
                      <button
                        type="button"
                        class="btn btn--add-attn no-print"
                        onClick={() => actions.addAttention()}
                        title={S.sheet.addAttention}
                      >
                        {S.sheet.addAttention}
                      </button>
                    )}
                  </span>
                  {/* Print: static bidi-isolated text */}
                  <span class="client-line__print" dir="rtl">
                    <bdi>{S.sheet.clientPrefix}{quotation.client || S.sheet.clientPlaceholder}</bdi>
                  </span>
                </div>
                {quotation.attention !== undefined && (
                  <div class="client-line attention-line">
                    {/* Screen: editable input */}
                    <span class="client-line__screen" dir="rtl">
                      <span class="client-line__text">
                        <span class="client-line__prefix">{S.sheet.attentionPrefix}</span>
                        <input
                          class="client-line__input"
                          type="text"
                          value={quotation.attention}
                          placeholder={S.sheet.attentionPlaceholder}
                          aria-label={S.sheet.attentionPlaceholder}
                          autoFocus
                          onInput={(e) => actions.setAttention((e.currentTarget as HTMLInputElement).value)}
                        />
                      </span>
                      <button
                        type="button"
                        class="row-btn no-print"
                        title={S.sheet.deleteAttention}
                        aria-label={S.sheet.deleteAttention}
                        onClick={() => actions.removeAttention()}
                      >
                        <IconTrash />
                      </button>
                    </span>
                    {/* Print: static bidi-isolated text */}
                    <span class="client-line__print" dir="rtl">
                      <bdi>{S.sheet.attentionPrefix}{quotation.attention || S.sheet.attentionPlaceholder}</bdi>
                    </span>
                  </div>
                )}
              </div>

              <div class="date-line">
                {/* Screen: editable input */}
                <span class="date-line__screen" dir="rtl">
                  <span class="date-line__prefix">{S.sheet.datePrefix}</span>
                  <input
                    class="date-line__input"
                    type="text"
                    value={currentDate}
                    placeholder={S.sheet.datePlaceholder}
                    aria-label={S.sheet.datePlaceholder}
                    onInput={(e) => actions.setDate((e.currentTarget as HTMLInputElement).value)}
                  />
                </span>
                {/* Print: static bidi-isolated text */}
                <span class="date-line__print" dir="rtl">
                  <span class="date-line__prefix">{S.sheet.datePrefix}</span>
                  <bdi dir="ltr">{currentDate}</bdi>
                </span>
              </div>
            </div>
          </>
        ) : (
          <div class="doc-meta page-cont-meta">
            <span>
              {S.sheet.clientPrefix}
              {quotation.client}
              {quotation.attention ? ` — ${S.sheet.attentionPrefix}${quotation.attention}` : ""}
            </span>
            <span>{t(S.sheet.pageXofY, { x: pageIndex + 1, y: pageCount })}</span>
          </div>
        )}

        <table class="table-wrap">
          <colgroup>
            <col class="col-num" />
            <col class="col-item" />
            <col class="col-qty" />
            <col class="col-price" />
            <col class="col-total" />
          </colgroup>
          <thead>
            <tr>
              <th>{S.sheet.colIndex}</th>
              <th>{S.sheet.colItem}</th>
              <th>{S.sheet.colQty}</th>
              <th>{S.sheet.colPrice}</th>
              <th>{S.sheet.colTotal}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <ItemRow key={item.id} item={item} index={startIndex + i} itemNames={itemNames} />
            ))}
          </tbody>
        </table>

        {showTail && <TailBlock quotation={quotation} totals={totals} />}
      </div>

      <footer class="page-band band-footer">
        <div class="band-footer__inner">
          <div class="footer-address">{company.address}</div>
          <div class="footer-contact">
            <div>Email : {company.email}</div>
            <div>Mobile : {company.phones.map((p) => p.value).join(" - ")}</div>
          </div>
          {pageCount > 1 && (
            <div class="footer-pageinfo">
              {t(S.sheet.pageXofY, { x: pageIndex + 1, y: pageCount })}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

interface ItemRowProps {
  item: QuoteItem;
  index: number;
  itemNames: string[];
}

function ItemRow({ item, index, itemNames }: ItemRowProps) {
  const [dragOver, setDragOver] = useState(false);
  const dragIndexRef = useRef<number | null>(null);

  const enter = (cell: CellKind) => requestFocus({ row: index, cell });

  return (
    <tr
      class={`item-row${dragOver ? " is-drag-over" : ""}`}
      draggable
      onDragStart={(e) => {
        dragIndexRef.current = index;
        (e as DragEvent).dataTransfer?.setData("text/plain", String(index));
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const from = dragIndexRef.current;
        if (from !== null && from !== index) actions.moveItem(from, index);
        dragIndexRef.current = null;
      }}
    >
      <td class="cell-num">
        <span class="row-index">{index + 1}</span>
        <div class="row-actions no-print">
          <button
            type="button"
            class="row-btn row-btn--drag"
            title={S.sheet.dragRow}
            aria-label={S.sheet.dragRow}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <IconDrag />
          </button>
          <button
            type="button"
            class="row-btn"
            title={S.sheet.deleteRow}
            aria-label={S.sheet.deleteRow}
            onClick={() => actions.deleteItem(item.id)}
          >
            <IconTrash />
          </button>
        </div>
      </td>
      <td class="cell-item">
        <span class="cell-screen">
          <ItemNameInput
            class="item-editor"
            value={item.name}
            names={itemNames}
            ariaLabel={S.sheet.colItem}
            dataRow={index}
            dataCell="item"
            onChange={(v) => actions.setItemName(item.id, v)}
            onCommit={(v) => actions.rememberItemName(v)}
            onEnter={() => enter("qty")}
          />
        </span>
        <span class="cell-print" dir="rtl">
          {item.name || "‏"}
        </span>
      </td>
      <td class="cell-qty">
        <span class="cell-screen">
          <NumericInput
            className="number-cell-input"
            value={item.qty}
            ariaLabel={S.sheet.colQty}
            dataRow={index}
            dataCell="qty"
            onValue={(n) => actions.setItemQty(item.id, n)}
            onEnter={() => enter("price")}
          />
        </span>
        <span class="cell-print">{formatInt(item.qty)}</span>
      </td>
      <td class="cell-price">
        <span class="cell-screen">
          <NumericInput
            className="number-cell-input"
            value={item.price}
            ariaLabel={S.sheet.colPrice}
            dataRow={index}
            dataCell="price"
            onValue={(n) => actions.setItemPrice(item.id, n)}
            onEnter={() => {
              const isLast = index === store.get().quotation.items.length - 1;
              if (isLast) actions.addItem();
              requestFocus({ row: index + 1, cell: "item" });
            }}
          />
        </span>
        <span class="cell-print">{formatMoney(item.price)}</span>
      </td>
      <td class="cell-total">{formatMoney(lineTotal(item))}</td>
    </tr>
  );
}

interface DiscountAddButtonProps {
  options: QuoteOptions;
}

function DiscountAddButton({ options }: DiscountAddButtonProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const addDiscount = (type: "percent" | "fixed") => {
    actions.setOption("discountType", type);
    if (type === "percent" && !options.discountPercent) {
      actions.setOption("discountPercent", 10);
    } else if (type === "fixed" && !options.discountValue) {
      actions.setOption("discountValue", 500);
    }
    actions.setOption("showDiscount", true);
    setOpen(false);
  };

  return (
    <div class="discount-btn-wrap no-print" ref={wrapRef}>
      <button
        type="button"
        class="btn btn--add-discount no-print"
        onClick={() => setOpen((prev) => !prev)}
        title="إضافة خصم (نسبة مئوية أو مبلغ ثابت)"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span>+ خصم</span>
        <span class="discount-btn-caret">▾</span>
      </button>

      {open && (
        <div class="discount-dropdown-menu" role="menu">
          <button
            type="button"
            class="discount-dropdown-item"
            role="menuitem"
            onClick={() => addDiscount("percent")}
          >
            <span class="discount-dropdown-badge">%</span>
            <span>نسبة مئوية (%)</span>
          </button>
          <button
            type="button"
            class="discount-dropdown-item"
            role="menuitem"
            onClick={() => addDiscount("fixed")}
          >
            <span class="discount-dropdown-badge">ج.م</span>
            <span>مبلغ ثابت (ج.م)</span>
          </button>
        </div>
      )}
    </div>
  );
}

interface TailBlockProps {
  quotation: Quotation;
  totals: ReturnType<typeof computeTotals>;
  measuring?: boolean;
}

function TailBlock({ quotation, totals, measuring }: TailBlockProps) {
  const options = quotation.options;
  return (
    <div class="tail-block">
      <div class="totals-stack">
        {options.showDiscount && (
          <>
            <TotalsRow label={S.options.subTotalLabel} value={formatMoney(totals.subtotal)} />
            <TotalsRow
              label={
                measuring ? (
                  options.discountType === "fixed"
                    ? S.options.discountLabel
                    : `${S.options.discountLabel} (${options.discountPercent}%)`
                ) : (
                  <>
                    <span class="cell-screen">
                      <span class="discount-row-editor">
                        <span class="discount-editor__title">{S.options.discountLabel}</span>
                        <span class="discount-type-pill" role="radiogroup" aria-label="نوع الخصم">
                          <button
                            type="button"
                            class={`pill-btn ${options.discountType === "percent" ? "is-active" : ""}`}
                            onClick={() => actions.setOption("discountType", "percent")}
                            title="خصم نسبة مئوية (%)"
                          >
                            %
                          </button>
                          <button
                            type="button"
                            class={`pill-btn ${options.discountType === "fixed" ? "is-active" : ""}`}
                            onClick={() => actions.setOption("discountType", "fixed")}
                            title="خصم مبلغ ثابت (ج.م)"
                          >
                            ثابت
                          </button>
                        </span>
                        <span class="discount-input-wrap">
                          {options.discountType === "percent" ? (
                            <NumericInput
                              className="discount-input"
                              value={options.discountPercent}
                              ariaLabel="نسبة الخصم"
                              onValue={(v) => actions.setOption("discountPercent", v)}
                            />
                          ) : (
                            <NumericInput
                              className="discount-input"
                              value={options.discountValue}
                              ariaLabel="قيمة الخصم"
                              onValue={(v) => actions.setOption("discountValue", v)}
                            />
                          )}
                          <span class="discount-suffix">
                            {options.discountType === "percent" ? "%" : "ج.م"}
                          </span>
                        </span>
                      </span>
                    </span>
                    <span class="cell-print">
                      {options.discountType === "fixed"
                        ? S.options.discountLabel
                        : `${S.options.discountLabel} (${options.discountPercent}%)`}
                    </span>
                  </>
                )
              }
              value={formatMoney(totals.discountAmount)}
              action={
                !measuring && (
                  <button
                    type="button"
                    class="row-btn no-print"
                    title="حذف الخصم"
                    aria-label="حذف الخصم"
                    onClick={() => actions.setOption("showDiscount", false)}
                  >
                    <IconTrash />
                  </button>
                )
              }
            />
          </>
        )}
        {options.showVat && (
          <>
            {options.showDiscount && (
              <TotalsRow
                label={S.options.subTotalAfterDiscount}
                value={formatMoney(totals.taxableBase)}
              />
            )}
            <TotalsRow
              label={S.options.vatLabel}
              value={formatMoney(totals.vatAmount)}
              action={
                !measuring && (
                  <button
                    type="button"
                    class="row-btn no-print"
                    title="حذف الضريبة"
                    aria-label="حذف الضريبة"
                    onClick={() => actions.setOption("showVat", false)}
                  >
                    <IconTrash />
                  </button>
                )
              }
            />
          </>
        )}
        <TotalsRow
          label={S.options.totalLabel}
          value={formatMoney(totals.total)}
          grand
          action={
            !measuring && (
              <div class="totals-actions no-print">
                {!options.showDiscount && <DiscountAddButton options={options} />}
                {!options.showVat && (
                  <button
                    type="button"
                    class="btn btn--add-vat no-print"
                    onClick={() => {
                      actions.setOption("vatRate", 14);
                      actions.setOption("showVat", true);
                    }}
                    title="إضافة ضريبة 14%"
                  >
                    +14%
                  </button>
                )}
              </div>
            )
          }
        />
      </div>

      {options.showWords && (
        <div class="words-line">
          {S.options.wordsPrefix} {tafqeet(totals.total)} {S.options.wordsSuffix}
        </div>
      )}

      {options.showValidity && (
        <div class="validity-line">
          {S.options.validityLabel} {formatInt(options.validityDays)} {S.options.validityDays}
        </div>
      )}

      <div class="notes-block">
        {quotation.notes.map((note, i) => (
          <div class="note-row" key={note.id}>
            <span class="note-row__num">
              {i + 1}
              {S.sheet.noteNumberSuffix}
            </span>
            <AutoTextarea
              class="note-editor"
              value={note.text}
              aria-label={`ملاحظة ${i + 1}`}
              dir="rtl"
              onInput={(e) =>
                actions.setNoteText(note.id, (e.currentTarget as HTMLTextAreaElement).value)
              }
            />
            {/* Print static version for bidi-correct rendering */}
            <span class="note-editor__print" dir="rtl"><bdi>{note.text}</bdi></span>
            {!measuring && (
              <button
                type="button"
                class="row-btn no-print"
                title={S.sheet.deleteRow}
                aria-label={S.sheet.deleteRow}
                onClick={() => actions.deleteNote(note.id)}
              >
                <IconTrash />
              </button>
            )}
          </div>
        ))}
        {!measuring && (
          <div class="table-editor-actions no-print">
            <button type="button" class="btn btn--ghost" onClick={() => actions.addNote()}>
              {S.sheet.addNote}
            </button>
          </div>
        )}
      </div>

      <div class="thanks-wrap">
        <AutoTextarea
          class="thanks-field thanks-field--screen"
          value={quotation.thankYou}
          aria-label="سطر الشكر"
          onInput={(e) => actions.setThankYou((e.currentTarget as HTMLTextAreaElement).value)}
        />
        <div class="thanks-field thanks-field--print" dir="rtl"><bdi>{quotation.thankYou}</bdi></div>
      </div>

      <div class="approval-line">
        <span class="approval-line__screen" dir="ltr">
          <span>{S.sheet.approval}</span>
          <input
            class="approval-line__input"
            type="text"
            value={quotation.approver}
            aria-label={S.sheet.approval}
            onInput={(e) => actions.setApprover((e.currentTarget as HTMLInputElement).value)}
          />
        </span>
        <span class="approval-line__print" dir="rtl"><bdi>{S.sheet.approval}{quotation.approver}</bdi></span>
      </div>
    </div>
  );
}

interface TotalsRowProps {
  label: preact.ComponentChildren;
  value: string;
  grand?: boolean;
  action?: preact.ComponentChildren;
}

function TotalsRow({ label, value, grand, action }: TotalsRowProps) {
  return (
    <table class="table-wrap">
      <colgroup>
        <col class="col-num" />
        <col class="col-item" />
        <col class="col-qty" />
        <col class="col-price" />
        <col class="col-total" />
      </colgroup>
      <tbody>
        <tr class={grand ? "trow-grand" : "trow-subtotal"}>
          <td class="cell-num" />
          <td class="trow-label">
            <span class="trow-label__inner">
              <span>{label}</span>
              {action}
            </span>
          </td>
          <td />
          <td />
          <td class="cell-total">{value}</td>
        </tr>
      </tbody>
    </table>
  );
}
