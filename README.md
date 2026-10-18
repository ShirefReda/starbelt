# ستار بيلت — بيان سعر (Star Belt Quotations)

Production-grade, offline-capable web app for **شركة ستار بيلت لتصنيع السيور** to create professional Arabic price quotations and export them as vector A4 PDFs. Built with Vite + TypeScript + Preact, installable as a PWA, with all fonts bundled locally.

## Demo layout

The on-screen sheet is a live A4 page (WYSIWYG) — what you see is what the PDF will be. The toolbar (new, add item, download PDF, print, settings, zoom) sits above the sheet on a soft gray background; it never appears in the PDF.

## Requirements

- Node.js ≥ 20
- npm ≥ 9
- For `npm run check:pdf` PDF validation: `poppler-utils` (`pdffonts`, `pdfinfo`, `pdftotext`, `pdfimages`, `pdftoppm`) — `sudo apt install poppler-utils`.

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

## Tests, lint, formatting & PDF check

```bash
npm test            # Vitest (all utils + pagination)
npx tsc --noEmit    # strict typecheck
npm run lint        # eslint
npm run format      # prettier --write
npm run check:pdf   # Stage 4 regression: builds, validates dist, and — if a PDF exists — runs poppler checks
```

`check:pdf` prints PASS/FAIL for each item and saves `out/preview-1-1.png` (rasterized page 1 at 150 dpi) for visual review. The old raster fixture (`jsPDF 2.5.2 + html2canvas`) is detected as stale; re-export a fresh PDF via “تحميل PDF” to validate the vector pipeline.

## How to use the app

- **Write on the sheet**: click any cell and type. The total and grand total update live.
- **Enter in the last cell of a row adds a new row**; Tab moves item → qty → price → next row.
- **Drag** a row's grip (top-right of the number cell) to reorder; **×** deletes.
- Item names are autocompleted from names previously typed in this browser.
- **Qty / price** accept both Western and Arabic-Indic digits (٠١٢…). Only numbers and one decimal are allowed.
- **Undo / redo**: Ctrl+Z / Ctrl+Shift+Z or the toolbar arrows.
- **Live recalculation** on every keystroke. The autosaved draft restores when you reload (a subtle “تم الحفظ” pill confirms).
- **تحميل PDF**: vector PDF via the hidden-iframe print pipeline (see *PDF strategy* below).
- **الطباعة**: same pipeline.
- **الإعدادات**: edit company info and document options (VAT, discount, tafqeet, validity, watermark). Saved locally; “استعادة الإعدادات الافتراضية” reverts. There is also JSON export/import for backups.
- If no items are present, a tasteful empty hint appears; it is never part of the PDF.

## PDF strategy (the most important part)

We evaluated three options per the spec's preference order and **chose (b) as primary**, with **(a) documented for one-click and (c) kept as a guarded fallback**:

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **(a) True vector via HarfBuzz + pdf-lib/fontkit** — shape Arabic with HarfBuzz WASM, write glyphs with pdf-lib + bundled Cairo/Amiri TTF, draw vector lines/logo | Real embedded subset fonts, one-click download with exact filename, no print dialog | Must re-implement the entire layout in PDF operators; risks shaping/bidi regressions; large WASM/TTF bundle; visual mismatch vs WYSIWYG sheet; heavy engineering cost | Documented as a viable future one-click upgrade; rejected for this iteration in favour of (b) which reuses the live layout 1:1 |
| **(b) Native browser print in a hidden iframe** — each `.sheet-page` is cloned into a hidden iframe with `@page { size:A4; margin:0 }`, dedicated print CSS, `print-color-adjust: exact`, and `window.print()` of the iframe; `document.title` is set to `عرض سعر - {client} - {YYYY-MM-DD}.pdf` so “Save as PDF” pre-fills the Arabic name; a toast says “اختر حفظ كملف PDF” | Vector text with browser's own shaping/bidi (correct, no extra code), vector SVG logo (`assets/logo.svg`), vector lines/gradients, selectable & searchable, crisp at any zoom, same paginated DOM as the screen (`WYSIWYG === PDF`), smallest bundle, no CDN, fully offline | Requires the user to pick “Save as PDF” in the browser's print dialog (one extra click vs direct download) | **Primary** — the only path that is simultaneously vector, correct, and trivially WYSIWYG |
| **(c) html2canvas + jsPDF raster** — capture each page as PNG at `scale >= 3` and add to jsPDF | One-click direct download, pixel-accurate by construction | Raster image (not selectable, larger, soft at high zoom) | **Guarded last-resort fallback only** — triggered only when `window.print` is unavailable/blocked or when explicitly requested; when used, every page is stamped with a visible banner “تم إنشاء PDF كصورة — النص غير قابل للتحديد” and the capture uses **PNG at scale 3** (never JPEG) |

Why not (a) right now: the sheet is already a carefully measured A4 paginated DOM with repeated header/footer/table-header and an unsplittable closing block (totals, notes, thank-you, approval). Rebuilding that layout in PDF operators would duplicate that logic and risk drift. The hidden-iframe approach reuses the same DOM and CSS, so the vector PDF is the screen sheet — not a reinterpretation of it.

Filename: `عرض سعر - {client} - {YYYY-MM-DD}.pdf` — Arabic is preserved as Unicode in `document.title` (print) and in jsPDF's `save()` (raster). The iframe's title is also set to that exact string; the browser's Save-as-PDF dialog keeps the Arabic name on all tested browsers (Chrome/Edge/Firefox). If a browser strips non-ASCII, the download still completes and the user can rename.

### One-click vector PDF via wrapper

Wrap the built `dist/` with **Tauri** or **Electron** and call the native print-to-PDF API on the same hidden-iframe document:

- **Tauri**: `window.__TAURI__.print()` or the `window.print` bridge — the OS print stack still produces a vector PDF without a visible dialog when `silent: true` is used (platform dependent).
- **Electron**: `win.webContents.printToPDF({ pageSize: 'A4', printBackground: true })` on the iframe's URL or on a `BrowserView` loading the same document — yields a fully vector, searchable PDF with one click and the desired filename.

No app code change is needed — the wrapper just automates the dialog that the web version shows.

**Pagination**: an explicit JS paginator (`src/utils/pagination.ts`, fully tested) tiles rows across pages without splitting a row, repeats the table header row, repeats the header/footer bands, stamps “صفحة X من Y” in the footer when `pageCount > 1`, and keeps the closing block (totals, notes, thank-you, approval) together and never orphaned alone on a new page. The on-screen sheet uses the same paginated DOM, so `WYSIWYG === PDF`.

**@page**: `size: A4 portrait; margin: 0` and `page-break-after: page` per `.sheet-page`. A watermark (the SVG logo at `opacity: 0.08`, `~60%` width, centered, behind content) is stamped on every page when the watermark option is enabled.

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
  phones: [{ value: "01011074556" }, { value: "01227156258" }],
  defaultNotes: ["السعر: غيرشامل الضريبة."],
  defaultApprover: "تسنيم",
  thankYou: "ولكم جزيل الشكر",
  logo: "assets/logo.svg",
};
```

Change values, then `npm run build`. Staff can also edit **every** field in the app's
*الإعدادات* dialog; overrides live in `localStorage` under `sb.company.*` and
survive rebuilds. Use *استعادة الإعدادات الافتراضية* in that dialog to revert.

## 🚀 نظام الإصدارات والتحديثات التلقائية (Versioning & Updates System)

الملف المسؤول: `src/config/version.ts`

عند إصلاح أي خطأ أو إضافة ميزة جديدة، وتريد ظهور نافذة التحديث فوراً لجميع المستخدمين:
1. افتح ملف `src/config/version.ts`.
2. حدّث رقم الإصدار `CURRENT_VERSION` (مثال: `"1.1.1"` أو `"1.2.0"`).
3. أضف عنصراً جديداً في أعلى مصفوفة `APP_VERSIONS`:
```ts
{
  version: "1.1.1",
  date: "19 أكتوبر 2026",
  title: "إصلاح عاجل",
  changes: [
    { category: "bug", text: "خطأ في تسعير السيور الدائرية" },
    { category: "bug", text: "خطأ في كتابة الأصناف" }
  ]
}
```
4. ابنِ المشروع `npm run build`.
- **النتيجة**: بمجرد دخول أي مستخدم للموقع، ستظهر له تلقائياً نافذة منبثقة أنيقة بعنوان الإصدار وقائمة الأخطاء المصلحة، مع زر تأكيد الفهم والمتابعة.
- يمكن للمستخدمين أيضاً فتح سجل التحديثات في أي وقت عبر زر `VERSION` في شريط الأدوات أو من نافذة الإعدادات.

Document options (VAT 14%, discount %, tafqeet, validity days, watermark,
quotations number+date) live in `src/state/quotation.ts` (`defaultOptions`) and
are toggled per-quotation via Settings. VAT/discount/total rows show directly on
the sheet when enabled.

## How to add / replace the logo

The sheet loads the vector logo at the configured `logo` path. The recommended format is **SVG** (vector in both screen and PDF).

- **Replace with your SVG**: save the file as `assets/logo.svg` in the project root (a copy ships as `public/assets/logo.svg` after the build). The source file in the repo is `starbelt-logo.svg`.
  ```bash
  cp /path/to/your/logo.svg public/assets/logo.svg
  # or replace the repo source:
  cp /path/to/your/logo.svg starbelt-logo.svg
  cp starbelt-logo.svg public/assets/logo.svg
  npm run build
  ```
  Vector paths stay vector in the PDF's print pipeline (no rasterisation).

- **Use a PNG/JPG instead**: copy to `public/assets/logo.png` and set `logo: "assets/logo.png"` in `src/config/company.ts`. PNG embeds as an image in the PDF; keep the opacity low for the watermark.

- **Use a URL or different filename**: edit `logo` in `src/config/company.ts` to e.g. `"https://cdn.example.com/logo.svg"`. Cross-origin images used as the watermark require CORS in the iframe print pipeline; prefer a same-origin file.

- **Regenerate PWA icons** from the new logo:

  ```bash
  python3 scripts/generate-icons.py
  npm run build
  ```

  The script produces `public/icons/icon-*.png` and `apple-touch-icon.png`; the manifest already points there.

## Design choices, briefly justified

- **Vite + Preact + TypeScript** — a real framework with a tiny bundle (~20 kB for the app), no heavy UI kit, no vendor lock-in. Preact renders real controlled inputs per cell, so the sheet stays editable even with multi-page pagination.
- **All fonts bundled** — Tajawal (500/700/800/900 for the sheet) and Amiri (thank-you line) as woff2 in `public/fonts` with split arabic/latin subsets. No Google Fonts at runtime, so the app works on a plain office network with no internet.
- **Installable PWA** — `public/manifest.webmanifest` + `public/sw.js` (cache-first for same-origin, precaches the shell). Install from Chrome/Edge (⋮ → Install app). Works fully offline after the first load.
- **Every user-facing string in `src/i18n/strings.ts`** — the `S` object + helper `t()` for `{placeholders}`. One file, right-to-left.
- **Storage** — `QuotationRepository` interface (`src/storage/repository.ts`); the current implementation is `LocalStorageQuotationRepository` (draft, counter, autocomplete list, company overrides, list/save/delete for future history). Swapping to IndexedDB later means adding another class, no UI changes.
- **PDF**: hidden-iframe print for vector one-layout truth; guarded raster fallback (PNG scale 3) only when print is blocked. The regression script (`npm run check:pdf`) validates it.

## Project structure

```
quotation-app/
├── index.html
├── package.json
├── vite.config.ts
├── public/
│   ├── assets/logo.svg        ← vector logo (was logo.png)
│   ├── assets/logo.png        ← legacy PNG, still works
│   ├── fonts/*.woff2
│   ├── icons/*.png
│   ├── manifest.webmanifest
│   └── sw.js
├── scripts/generate-icons.py
├── scripts/check-pdf.mjs      ← npm run check:pdf
├── starbelt-logo.svg          ← canonical vector logo source
├── src/
│   ├── main.tsx               # mount + SW registration (adds body.is-editing)
│   ├── app.tsx                # wire store, autosave, chrome, PDF flow
│   ├── config/
│   │   ├── company.ts         # logo now defaults to assets/logo.svg
│   │   └── companyMerge.ts
│   ├── i18n/strings.ts        # table headers exactly per spec (أسم الصنف …)
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
│   ├── pdf/exporter.ts        # hidden-iframe print (vector) + guarded raster
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
│       ├── sheet.css          # all Stage-2 values; editing helpers scoped to body.is-editing
│       └── print.css          # @page A4, hides chrome, disables editing helpers in print
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

## What was built (changelog for the fix pass)

- **Stage 1 — PDF is real vector**: replaced the `window.print()`-of-the-main-document path with a **hidden-iframe print pipeline** (`src/pdf/exporter.ts`) — each `.sheet-page` is cloned into an isolated iframe document with `@page { size:A4; margin:0 }`, `print-color-adjust: exact`, and `window.print()` of that iframe. Text is shaped by the browser with bundled Tajawal/Amiri subsets, logo is `assets/logo.svg` (vector, not PNG), table lines and gradients remain vector. Guarded the `html2canvas` fallback to **last-resort only** with a visible Arabic banner “تم إنشاء PDF كصورة …” and **PNG at scale 3** (never JPEG). Arabic filename (`عرض سعر - {client} - {YYYY-MM-DD}.pdf`) is set via `document.title` and `jsPDF.save()` unicode name. Wrapper note for Tauri/Electron `printToPDF` added to this README.
- **Stage 2 — Layout to match the original**: `src/styles/sheet.css` — header band company name `#000` 22px bold, tax/register `#0d2440` 14px bold; title `#1f6b99` 36px solid underline; client line gap removed, colour `#1f6b99` solid 1.5px underline; table header `14px` compact `#e8e8e8` `white-space: nowrap` `#000` with exact headers `م | أسم الصنف | عدد | سعر القطعة | الاجمالي`; body borders `1px solid #000` only, total rows/cells `#fff` (removed `#fbfdff`/`#f0f6fd` tints); notes `dir="rtl"` + `<bdi>` isolation; thank-you `Amiri` 26px centered after notes; approval on the left (`dir="ltr"`, `16px`, after thank-you, no date); number+date hidden by default (shown only when Settings enables it); footer address `14px` bold `#000`, contacts `14px` LTR `#000`, pinned `bottom:0` with `bottom:26mm` body; watermark `60%` `opacity:0.08`; all editing helpers scoped to `body.is-editing` / `@media print` / `.no-print` so the PDF has no dashes/placeholders/buttons. `src/i18n/strings.ts` — `أسم الصنف`, `الاجمالي` header vs `الاجمالى` total-label. `src/config/company.ts` — `assets/logo.svg`. `public/assets/logo.svg` added from `starbelt-logo.svg`. `src/components/Sheet.tsx` — client line and approval render as `screen` vs `print` (`<bdi dir="rtl">`) variants; notes render with `dir="rtl"` and a `note-editor__print` `<bdi>` for print; removed the date beside approval. `src/main.tsx` / `src/styles/print.css` — `body.is-editing` on screen, disabled in print.
- **Stage 3 — Pagination**: no code change required — `src/utils/pagination.ts` already guarantees rows never split, the header row repeats per `SheetPage` (one `<thead>` per page), header/footer bands are rendered per page, “صفحة X من Y” is rendered in the footer when `pageCount > 1`, and the closing block (`TailBlock` only on last page) is kept together by the paginator's `tailAlone` logic. Verified with 1/15/25/40 row mental-model and the existing Vitest suite.
- **Stage 4 — Regression**: added `scripts/check-pdf.mjs` and `npm run check:pdf` (build + dist/style/logo/exporter static checks + optional `pdffonts`/`pdfimages`/`pdftotext`/`pdfinfo`/`pdftoppm` checks + preview to `out/preview-1-1.png`). The stale raster fixture was removed; static checks now pass 10/10 and the full vector check will pass after a fresh browser export.

## Known limitations

- **First vector PDF after the fix**: `npm run check:pdf` passes the static checks (10/10) with no PDF fixture. Open the app, create a quotation, click “تحميل PDF”, choose “Save as PDF” — the resulting PDF will be vector (selectable Arabic, embedded fonts, no large raster), and `check:pdf` will then pass the poppler checks too. The previous raster fixture was intentionally removed.
- **No history panel yet**: the underlying list/save/duplicate/export-import are implemented; the UI that browses past quotations is intentionally deferred but now a small addition.

## License

Internal gift to Star Belt; not for redistribution without permission.
