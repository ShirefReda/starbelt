# ستار بيلت — بيان سعر (Star Belt Quotations)

Production-grade, offline-capable web app for **شركة ستار بيلت لتصنيع السيور** to create professional Arabic price quotations and export them as pixel-accurate A4 PDFs. Built with Vite + TypeScript + Preact, installable as a PWA, with all fonts bundled locally.

## Demo layout

The on-screen sheet is a live A4 page (WYSIWYG) — what you see is what the PDF will be. The toolbar (new, add item, download PDF, print, settings, zoom) sits above the sheet on a soft gray background; it never appears in the PDF.

## Requirements

- Node.js ≥ 20
- npm ≥ 9

## Run it (dev)

```bash
npm install
npm run dev    # http://localhost:5173
```

## Build it (production)

```bash
npm run build  # runs: tsc --noEmit && vite build
npm run preview   # http://localhost:4173  (serves the built dist/)
```

The build outputs to `dist/`. Host the whole `dist/` directory on any static host
(GitHub Pages, Netlify, Cloudflare Pages, shared hosting — just upload the 5 files).

## Tests, lint & formatting

```bash
npm test            # Vitest (all utils + pagination)
npx tsc --noEmit    # strict typecheck
npm run lint        # eslint
npm run format      # prettier --write
```

## How to use the app

- **Write on the sheet**: click any cell and type. The total and grand total update live.
- **Enter in the last cell of a row adds a new row**; Tab moves item → qty → price → next row.
- **Drag** a row's grip (top-right of the number cell) to reorder; **×** deletes.
- Item names are autocompleted from names previously typed in this browser.
- **Qty / price** accept both Western and Arabic-Indic digits (٠١٢…). Only numbers and one decimal are allowed.
- **Undo / redo**: Ctrl+Z / Ctrl+Shift+Z or the toolbar arrows.
- **Live recalculation** on every keystroke. The autosaved draft restores when you reload (a subtle “تم الحفظ” pill confirms).
- **تحميل PDF**: downloads/prints the document (see *PDF strategy* below).
- **الطباعة**: calls the same print pipeline.
- **الإعدادات**: edit company info and document options (VAT, discount, tafqeet, validity, watermark). Saved locally; “استعادة الإعدادات الافتراضية” reverts. There is also JSON export/import for backups.
- If no items are present, a tasteful empty hint appears; it is never part of the PDF.

## PDF strategy (the most important part)

We evaluated three options and **chose (a) as primary** — it is the only one that gives
perfect Arabic shaping and selectable vector text with zero runtime shaping code:

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **(a) Native browser print pipeline** — `@page { size: A4; margin: 0 }` + `page-break-after: page` + dedicated `@media print` styles, exporting via `window.print()` (document.title is set to `عرض سعر - {client} - {YYYY-MM-DD}.pdf` so the browser suggests that name in its Save-as-PDF dialog). | Vector text, real selectable Arabic (browser shapes/bidi per-spec), sharp logo, crisp lines. Multi-page with repeated header/footer and “صفحة X من Y”. Works fully offline. Smallest bundle. | Not a fully-automatic download; the user sees the print dialog and picks Save as PDF. Old browsers' print dialogs may look different, but output is identical. | **Primary** (best “preferably real, selectable vector text”). |
| (b) JS PDF generator with embedded TTF + bidi/shaping | Would produce selectable text with direct download | Must re-implement the whole layout in canvas-like PDF commands; Arabic shaping and mixed Arabic/numbers is risky; offline font subset is heavy. Risk of visual mismatch (not pixel-accurate). | Rejected for reliability. |
| (c) html2canvas + jsPDF raster | One-click download with the exact file name; pixel-accurate by construction; correct Arabic (browser renders it). | Text becomes a raster image (not selectable, bigger file, slightly soft when zoomed). | **Kept as automatic + explicit manual fallback** (`تحميل مباشر (صورة PDF)`), and triggered automatically if the print API is unavailable. |

**Pagination**: an explicit JS paginator (`src/utils/pagination.ts`, fully tested) tiles rows
across pages without splitting a row, repeats the table header row, repeats the
header/footer bands, stamps “صفحة X من Y”, and keeps the closing block (totals,
notes, thank-you, approval) together and never orphaned alone on a new page.
The on-screen sheet uses the same paginated DOM, so `WYSIWYG === PDF`.

**@page**: `size: A4 portrait; margin: 0` and `page-break-after: page` per
`.sheet-page`. A blank watermark (the logo at `opacity: 0.08`) sits behind every page.

## How to edit company info

The **single source of truth** is `src/config/company.ts`:

```ts
export const companyDefaults: CompanyConfig = {
  name: "شركة ستار بيلت لتصنيع السيور",
  taxCard: "003-811-581",
  taxCardLabel: "بطاقة ضريبية رقم",
  commercialRegister: "16389",
  commercialRegisterLabel: "سجل تجارى",
  address: "العاشر من رمضان قطعة A6 بجوار الصوامع",
  email: "starbelt86@gmail.com",
  phones: [{ value: "01011074556" }, { value: "01118274448" }, { value: "01227156258" }],
  defaultNotes: ["السعر: غيرشامل الضريبة."],
  defaultApprover: "تسنيم",
  thankYou: "ولكم جزيل الشكر",
  logo: "assets/logo.png",
};
```

Change values, then `npm run build`. Staff can also edit **every** field in the app's
*الإعدادات* dialog; overrides live in `localStorage` under `sb.company.*` and
survive rebuilds. Use *استعادة الإعدادات الافتراضية* in that dialog to revert.

Document options (VAT 14%, discount %, tafqeet, validity days, watermark,
quotations number+date) live in `src/state/quotation.ts` (`defaultOptions`) and
are toggled per-quotation via Settings. VAT/discount/total rows show directly on
the sheet when enabled.

## How to add / replace the logo

The sheet looks for the image at the configured `logo` path.

- **Local filesystem path**: copy your PNG/SVG/JPG to `public/assets/logo.png` (overwrites the
  demo file), then rebuild. Both the sheet and the PWA icons will use it.
  If the file is missing, the logo and watermark hide gracefully with no errors.

- **Regenerate PWA icons** from the new logo:

  ```bash
  python3 scripts/generate-icons.py
  npm run build
  ```

  The script produces `public/icons/icon-*.png` and `apple-touch-icon.png`; the manifest already points there.

- **Use a URL or different filename**: edit `logo` in `src/config/company.ts` to e.g. `"https://cdn.example.com/logo.svg"`. Cross-origin images used as the PDF watermark will be subject to CORS in the print pipeline; prefer a same-origin file.

## Design choices, briefly justified

- **Vite + Preact + TypeScript** — a real framework with a tiny bundle (~20 kB for the app), no heavy UI kit, no vendor lock-in. Preact renders real controlled inputs per cell, so the sheet stays editable even with multi-page pagination.
- **All fonts bundled** — Tajawal (500/700/800/900 for the sheet) and Amiri (thank-you line) as woff2 in `public/fonts` with split arabic/latin subsets. No Google Fonts at runtime, so the app works on a plain office network with no internet.
- **Installable PWA** — `public/manifest.webmanifest` + `public/sw.js` (cache-first for same-origin, precaches the shell). Install from Chrome/Edge (⋮ → Install app). Works fully offline after the first load.
- **Every user-facing string in `src/i18n/strings.ts`** — the `S` object + helper `t()` for `{placeholders}`. One file, right-to-left.
- **Storage** — `QuotationRepository` interface (`src/storage/repository.ts`); the current implementation is `LocalStorageQuotationRepository` (draft, counter, autocomplete list, company overrides, list/save/delete for future history). Swapping to IndexedDB later means adding another class, no UI changes.

## Project structure

```
quotation-app/
├── index.html
├── package.json
├── vite.config.ts
├── public/
│   ├── assets/logo.png
│   ├── fonts/*.woff2
│   ├── icons/*.png
│   ├── manifest.webmanifest
│   └── sw.js
├── scripts/generate-icons.py
├── src/
│   ├── main.tsx               # mount + SW registration
│   ├── app.tsx                # wire store, autosave, chrome, PDF flow
│   ├── config/
│   │   ├── company.ts
│   │   └── companyMerge.ts
│   ├── i18n/strings.ts
│   ├── state/
│   │   ├── quotation.ts       # Quotation model + migration
│   │   ├── store.ts           # generic Store with coalesced history
│   │   └── actions.ts         # get/list/save/delete/duplicate + sheet actions
│   ├── storage/
│   │   ├── repository.ts
│   │   └── localStorageRepository.ts
│   ├── utils/
│   │   ├── digits.ts
│   │   ├── geometry.ts
│   │   ├── id.ts
│   │   ├── money.ts
│   │   ├── numberToWords.ts   # تفقيط
│   │   ├── pagination.ts
│   │   └── totals.ts
│   ├── pdf/exporter.ts
│   ├── components/
│   │   ├── Sheet.tsx          # A4 sheet + pagination
│   │   ├── Toolbar.tsx
│   │   ├── SettingsDialog.tsx
│   │   ├── AutoTextarea.tsx
│   │   ├── NumericInput.tsx
│   │   ├── ItemNameInput.tsx
│   │   └── icons.tsx
│   └── styles/
│       ├── fonts.css
│       ├── global.css
│       ├── sheet.css
│       └── print.css
└── tests/
    ├── digits.test.ts
    ├── numberToWords.test.ts
    ├── pagination.test.ts
    └── totals.test.ts
```

## State & data model (for the planned history feature)

```ts
type Quotation = {
  id: string;
  number: string;          // SB-2026-0007
  createdAt: string;       // ISO
  updatedAt: string;
  client: string;
  items: { id: string; name: string; qty: number; price: number }[];
  notes: { id: string; text: string }[];
  approver: string;
  thankYou: string;
  options: {
    showNumberAndDate: boolean;
    showVat: boolean;
    vatRate: number;
    showDiscount: boolean;
    discountPercent: number;
    showWords: boolean;
    showValidity: boolean;
    validityDays: number;
    showWatermark: boolean;
  };
  schemaVersion: number;
};
```

- The sheet is the **single source of truth** (typed actions: setQuotation/getQuotation/newQuotation/duplicateQuotation/renderSheet/exportPdf are tiny helpers around the store).
- `QuotationRepository.get/list/save/delete/duplicate` are implemented (and trivial to swap to IndexedDB).
- `schemaVersion` + `migrateQuotation()` in `src/state/quotation.ts` future-proofs the JSON.
- The history panel itself is not built; the repository and duplicate/save/load plumbing are ready so adding it is a small isolated change.
- Autosave is debounced; the saved draft is restored on reload with a subtle “تم الحفظ” pill.
- Undo / redo is a coalesced history stack (typing bursts collapse into one step, not per-key).

## What was built

- Live WYSIWYG A4 sheet (Tajawal/Amiri, header band `linear-gradient(#d9eaf7 → #fff)` right-aligned company block, centered underlined “بيان سعر”, blue client line, bordered 5-column table with repeated header, centered “ولكم جزيل الشكر” in Amiri, left-aligned approver, large faint watermark logo, gradient footer band).
- Toolbar, zoom/fit-width, saved indicator, first-run hint, keyboard shortcuts (Enter/Tab, Ctrl+P/S/Z/Y).
- Smart numeric inputs, Arabic-Indic digit normalization, autocomplete, delete × on hover, drag-handle reorder.
- Company Settings (all fields + JSON backup/restore + reset), autosave, undo/redo, drag, pagination, page numbers, header/footer repeat, closing-block grouping.
- **PDF**: primary = native print (`@page A4`, vector selectable Arabic), fallback = html2canvas + jsPDF (high-DPI raster, crisp, direct download). A “تحميل مباشر” item in the settings and Ctrl+S are wired to the raster path; the toolbar's “تحميل PDF” uses the vector pipeline with a “preparing” overlay. Pagination logic is fully tested.
- **Offline & installable** PWA: manifest, generated icons from the logo, service worker (precaches the shell + cache-first runtime for hashed assets).
- Fonts bundled locally (Amiri + Tajawal arabic+latin subsets); installable icons generated from the logo; no CDN at runtime.
- Strict TS, eslint + prettier, vitest suites for totals/VAT/discount, تفقيط, digit normalization and pagination.

## Known limitations

- **Arabic in the downloaded file**: the recommended primary (print) output is vector and was verified by opening a printed PDF (text selectable, no broken ligatures, RTL correct). The raster fallback's text is not selectable — that is the documented trade-off for a one-click file.
- **No history panel yet**: the underlying list/save/duplicate/export-import are implemented; the UI that browses past quotations is intentionally deferred but now a small addition.

## License

Internal gift to Star Belt; not for redistribution without permission.
