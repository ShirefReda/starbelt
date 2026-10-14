import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { actions, store, repo } from "../state/actions";
import type { AppState, Quotation, QuoteItem } from "../state/quotation";
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
    quotation.approver,
    quotation.thankYou,
    options,
    company,
    zoom,
  ]);

  const pages = useMemo(() => buildPages(quotation, breaks), [quotation, breaks]);
  const pageCount = Math.max(1, pages.length);

  return (
    <>
      {/* Off-screen measuring copy — real content, never shown or printed. */}
      <div class="sheet-measure" ref={measureRef} aria-hidden="true">
        <div data-measure-title style={{ width: `${CONTENT_W}px` }}>
          <div class="doc-title">بيان سعر</div>
        </div>
        <div data-measure-client style={{ width: `${CONTENT_W}px` }}>
          <div class="client-line">
            <span class="client-line__prefix">{S.sheet.clientPrefix}</span>
            <span>{quotation.client || S.sheet.clientPlaceholder}</span>
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
                  {S.options.date}: {displayDate(new Date(quotation.createdAt))}
                </span>
              </div>
            )}
            <div class="client-line">
              <span class="client-line__prefix">{S.sheet.clientPrefix}</span>
              <input
                class="client-line__input"
                type="text"
                value={quotation.client}
                placeholder={S.sheet.clientPlaceholder}
                aria-label={S.sheet.clientPlaceholder}
                onInput={(e) => actions.setClient((e.currentTarget as HTMLInputElement).value)}
              />
            </div>
          </>
        ) : (
          <div class="doc-meta page-cont-meta">
            <span>
              {S.sheet.clientPrefix}
              {quotation.client}
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
      </td>
      <td class="cell-qty">
        <NumericInput
          className="number-cell-input"
          value={item.qty}
          ariaLabel={S.sheet.colQty}
          dataRow={index}
          dataCell="qty"
          onValue={(n) => actions.setItemQty(item.id, n)}
          onEnter={() => enter("price")}
        />
      </td>
      <td class="cell-price">
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
      </td>
      <td class="cell-total">{formatMoney(lineTotal(item))}</td>
    </tr>
  );
}

interface TailBlockProps {
  quotation: Quotation;
  totals: ReturnType<typeof computeTotals>;
  measuring?: boolean;
}

  function TailBlock({ quotation, totals, measuring }: TailBlockProps) {
  const options = quotation.options;
  const currentDate = displayDate(new Date());
  return (
    <div class="tail-block">
      <div class="totals-stack">
        {options.showDiscount && (
          <TotalsRow label={S.options.discountLabel} value={formatMoney(totals.discountAmount)} />
        )}
        {options.showVat && (
          <>
            <TotalsRow label={S.options.subTotalLabel} value={formatMoney(totals.taxableBase)} />
            <TotalsRow label={S.options.vatLabel} value={formatMoney(totals.vatAmount)} />
          </>
        )}
        <TotalsRow label={S.options.totalLabel} value={formatMoney(totals.total)} grand />
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
              onInput={(e) =>
                actions.setNoteText(note.id, (e.currentTarget as HTMLTextAreaElement).value)
              }
            />
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

      <AutoTextarea
        class="thanks-field"
        value={quotation.thankYou}
        aria-label="سطر الشكر"
        onInput={(e) => actions.setThankYou((e.currentTarget as HTMLTextAreaElement).value)}
      />

      <div class="approval-line">
        <span class="approval-line__left">
          <span>{S.sheet.approval}</span>
          <input
            class="approval-line__input"
            type="text"
            value={quotation.approver}
            aria-label={S.sheet.approval}
            onInput={(e) => actions.setApprover((e.currentTarget as HTMLInputElement).value)}
          />
        </span>
        <span class="approval-line__date" dir="ltr">
          {currentDate}
        </span>
      </div>
    </div>
  );
}

function TotalsRow({ label, value, grand }: { label: string; value: string; grand?: boolean }) {
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
          <td class="trow-label" colSpan={3}>
            {label}
          </td>
          <td class="cell-total">{value}</td>
        </tr>
      </tbody>
    </table>
  );
}
