/**
 * PDF export — Stage 1 logic.
 *
 * PRIMARY (b): native browser print pipeline in a dedicated hidden iframe.
 *   Each visible .sheet-page is cloned into an iframe document that carries
 *   the same styles and @page { size:A4; margin:0 }. The iframe is printed
 *   via its own window.print(). The browser shapes Arabic, embeds subset
 *   fonts, and produces a fully selectable vector PDF with vector logo
 *   (assets/logo.svg), vector lines and gradients. Filename is suggested via
 *   document.title = "عرض سعر - {client} - {YYYY-MM-DD}.pdf".
 *   Until the browser's print dialog appears a small toast tells the user to
 *   choose "Save as PDF" (حفظ كملف PDF).
 *
 * FALLBACK (c): html2canvas + jsPDF raster. Kept ONLY as last-resort.
 *   When used, a visible watermark "تم إنشاء PDF كصورة" is stamped on every
 *   page and the canvas is captured as PNG at scale >= 3 (never JPEG).
 *
 * The HarfBuzz+pdf-lib approach (a) was evaluated but not chosen: it would
 * require re-implementing the entire layout in PDF operators, risks shaping
 * regressions, and cannot share the live WYSIWYG DOM. The iframe print path
 * keeps one layout source of truth (the .sheet) and delegates shaping to the
 * browser — correct, zero bundle cost, and fully offline.
 *
 * Note for Tauri/Electron: wrap the built dist/ with Tauri or Electron and
 * call window.__TAURI__.print() / webContents.printToPDF() to get an
 * unattended one-click vector PDF with the same iframe document.
 */

import type { Quotation } from "../state/quotation";
import { quotationFileName } from "../state/actions";

export interface ExportCallbacks {
  onStart: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/** Safely encode an Arabic filename for the download attribute and title. */
function safeFileName(name: string): string {
  // Keep Unicode as-is; browsers handle download attribute with UTF-8.
  // Strip only filesystem-illegal chars already handled by quotationFileName.
  return name;
}

// ---------------------------------------------------------------------------
// Primary: hidden-iframe print (vector)
// ---------------------------------------------------------------------------

function buildPrintDocument(title: string, pagesHtml: string, stylesHtml: string): string {
  // Inline the watermark opacity and print-color-adjust so the iframe's print
  // output matches the live sheet exactly.
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${stylesHtml}
<style>
  @page { size: A4 portrait; margin: 0; }
  html,body { margin:0; padding:0; background:#fff; }
  /* Reuse the app's sheet/print rules; override workspace chrome */
  #print-root { display:block; }
  /* Ensure iframe has no zoom transform */
  .sheet-scale { transform: none !important; }
  .sheet { gap: 0 !important; display: block !important; }
  .sheet-page {
    box-shadow:none !important; border:none !important; border-radius:0 !important;
    margin:0 !important; width:210mm !important; height:297mm !important;
    page-break-after: always; break-after: page; overflow:hidden !important;
  }
  .sheet-page:last-child { page-break-after:auto; break-after:auto; }
  /* Hide editor chrome inside the print doc */
  .row-actions, .table-editor-actions, .autocomplete, .sheet-measure, .no-print { display:none !important; }
  .sheet-page input, .sheet-page textarea {
    border:none !important; background:transparent !important; box-shadow:none !important; outline:none !important;
    -webkit-appearance:none; appearance:none;
  }
  body.is-editing .client-line__input, body.is-editing .approval-line__input { border:none !important; }
  /* Print-only vs screen-only toggles */
  .cell-screen { display:none !important; }
  .cell-print { display:block !important; }
  .client-line__screen { display:none !important; }
  .client-line__print { display:inline !important; }
  .note-row .note-editor { display:none !important; }
  .note-editor__print { display:block !important; }
  .thanks-field--screen { display:none !important; }
  .thanks-field--print { display:block !important; }
  .approval-line__screen { display:none !important; }
  .approval-line__print { display:inline !important; }
  /* Force exact colours */
  .sheet-page, .sheet-page * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
</style>
</head>
<body class="is-printing">
<div id="print-root">${pagesHtml}</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function collectStyles(): string {
  // Clone all <style> and <link rel="stylesheet"> content into inline <style>.
  // For <link>, fetch via the already-loaded CSSOM (faster, no extra network).
  const parts: string[] = [];
  for (const node of Array.from(document.querySelectorAll("style, link[rel='stylesheet']"))) {
    if (node.tagName === "STYLE") {
      parts.push(`<style>${(node as HTMLStyleElement).textContent ?? ""}</style>`);
    } else {
      const link = node as HTMLLinkElement;
      try {
        const sheet = link.sheet as CSSStyleSheet | null;
        if (sheet) {
          const css = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
          parts.push(`<style>/* from ${link.href} */\n${css}</style>`);
        } else {
          parts.push(link.outerHTML);
        }
      } catch {
        parts.push(link.outerHTML);
      }
    }
  }
  return parts.join("\n");
}

function collectPagesHtml(): string {
  const pages = document.querySelectorAll<HTMLElement>(".sheet .sheet-page");
  if (pages.length === 0) return "";
  // Clone each page's outerHTML; adjust image src to absolute so iframe resolves.
  return Array.from(pages)
    .map((el) => {
      const clone = el.cloneNode(true) as HTMLElement;
      // Make logo src absolute so sub-document loads it.
      for (const img of Array.from(clone.querySelectorAll<HTMLImageElement>("img[src]"))) {
        const abs = new URL(img.getAttribute("src") || "", location.href).href;
        img.setAttribute("src", abs);
      }
      return clone.outerHTML;
    })
    .join("\n");
}

export function exportPdfViaPrint(quotation: Quotation, callbacks: ExportCallbacks): Promise<void> {
  const title = safeFileName(quotationFileName(quotation));
  const pagesHtml = collectPagesHtml();
  if (!pagesHtml) return Promise.reject(new Error("no-pages"));

  callbacks.onStart();

  return new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;visibility:hidden;pointer-events:none;";
    document.body.appendChild(iframe);

    let settled = false;
    const finish = (ok: boolean, err?: string) => {
      if (settled) return;
      settled = true;
      // Cleanup iframe after print dialog closes (allow a frame for afterprint).
      window.setTimeout(() => iframe.remove(), 800);
      callbacks.onDone();
      if (ok) resolve();
      else {
        callbacks.onError(err || "print-unavailable");
        reject(new Error(err || "print-unavailable"));
      }
    };

    const doc = iframe.contentDocument;
    if (!doc) {
      iframe.remove();
      callbacks.onError("print-unavailable");
      return reject(new Error("print-unavailable"));
    }

    const stylesHtml = collectStyles();
    const html = buildPrintDocument(title, pagesHtml, stylesHtml);

    // Write the print document synchronously.
    doc.open();
    doc.write(html);
    doc.close();

    const doPrint = async () => {
      const w = iframe.contentWindow;
      if (!w) return finish(false, "print-unavailable");
      // Wait for fonts and images inside the iframe.
      const fw = (w.document as Document & { fonts?: FontFaceSet }).fonts;
      if (fw?.ready) {
        try {
          await fw.ready;
        } catch {
          /* ignore */
        }
      }
      // Let images load.
      const imgs = Array.from(w.document.images);
      if (imgs.length > 0) {
        await Promise.all(
          imgs.map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  img.addEventListener("load", () => res(), { once: true });
                  img.addEventListener("error", () => res(), { once: true });
                  window.setTimeout(res, 1500);
                }),
          ),
        );
      }
      // Also wait a frame for layout to settle.
      w.requestAnimationFrame(() => {
        w.requestAnimationFrame(() => {
          // Listen for afterprint on the iframe window.
          let afterFired = false;
          const onAfter = () => {
            afterFired = true;
            w.removeEventListener("afterprint", onAfter);
            finish(true);
          };
          w.addEventListener("afterprint", onAfter);
          // Safety timer in case afterprint never fires (some browsers).
          window.setTimeout(() => {
            if (!afterFired) {
              w.removeEventListener("afterprint", onAfter);
              finish(true);
            }
          }, 2000);

          try {
            // Temporarily set parent title too so the dialog suggestion matches.
            const prevTitle = document.title;
            document.title = title;
            w.focus();
            w.print();
            // Restore parent title after a tick (afterprint will also restore).
            window.setTimeout(() => {
              document.title = prevTitle;
            }, 500);
          } catch {
            w.removeEventListener("afterprint", onAfter);
            finish(false, "print-unavailable");
          }
        });
      });
    };

    // If the iframe is still loading styles, wait for load.
    if (doc.readyState === "complete") {
      void doPrint();
    } else {
      iframe.addEventListener("load", () => void doPrint(), { once: true });
      // Fallback if load never fires (inline doc).
      window.setTimeout(() => void doPrint(), 300);
    }
  });
}

// ---------------------------------------------------------------------------
// Fallback: html2canvas + jsPDF raster, with visible warning and PNG scale>=3
// ---------------------------------------------------------------------------

const RASTER_WARNING_AR = "تم إنشاء PDF كصورة";

export async function exportPdfViaRaster(
  quotation: Quotation,
  callbacks: ExportCallbacks,
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  callbacks.onStart();
  try {
    const pages = Array.from(document.querySelectorAll<HTMLElement>(".sheet .sheet-page"));
    if (pages.length === 0) throw new Error("no-pages");

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
    const canvasScale = 3;

    const scaleEl = document.querySelector<HTMLElement>(".sheet-scale");
    const prevTransform = scaleEl?.style.transform ?? "";
    if (scaleEl) scaleEl.style.transform = "none";

    const body = document.body;
    const wasEditing = body.classList.contains("is-editing");
    body.classList.remove("is-editing");
    body.classList.add("is-exporting");

    if (document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    // Create warning banner elements that will be visible in the capture.
    const banners: HTMLElement[] = [];
    for (const page of pages) {
      const b = document.createElement("div");
      b.textContent = RASTER_WARNING_AR + " — النص غير قابل للتحديد";
      b.setAttribute("data-raster-warning", "1");
      b.style.cssText =
        "position:absolute;left:50%;top:8mm;transform:translateX(-50%);z-index:10;" +
        "background:#fff3cd;border:1px solid #e6a800;color:#7a5a00;" +
        "font-size:10px;font-weight:700;padding:1mm 3mm;border-radius:3px;" +
        "font-family:Tajawal, sans-serif;white-space:nowrap;";
      page.style.position = "relative";
      page.appendChild(b);
      banners.push(b);
    }

    try {
      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i]!, {
          scale: canvasScale,
          backgroundColor: "#ffffff",
          useCORS: true,
          logging: false,
          onclone: (clonedDoc) => {
            clonedDoc.body.classList.add("is-exporting");
            clonedDoc.body.classList.remove("is-editing");
            const clonedScale = clonedDoc.querySelector<HTMLElement>(".sheet-scale");
            if (clonedScale) clonedScale.style.transform = "none";
          },
        });
        if (i > 0) pdf.addPage();
        const img = canvas.toDataURL("image/png");
        pdf.addImage(img, "PNG", 0, 0, 210, 297);
      }
    } finally {
      for (const b of banners) b.remove();
      body.classList.remove("is-exporting");
      if (wasEditing) body.classList.add("is-editing");
      if (scaleEl) scaleEl.style.transform = prevTransform;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    const fileName = safeFileName(quotationFileName(quotation));
    // Use download with proper UTF-8 filename. jsPDF save handles unicode.
    pdf.save(fileName);
    callbacks.onDone();
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : "unknown");
    throw err;
  }
}

/** Decide which pipeline to run; print is primary, raster is explicit fallback. */
export async function exportPdf(
  quotation: Quotation,
  callbacks: ExportCallbacks,
  preferRaster = false,
): Promise<void> {
  if (preferRaster) return exportPdfViaRaster(quotation, callbacks);
  // Try hidden-iframe print; if it fails (sandboxed, blocked), fall back to raster.
  try {
    await exportPdfViaPrint(quotation, callbacks);
  } catch {
    await exportPdfViaRaster(quotation, callbacks);
  }
}
