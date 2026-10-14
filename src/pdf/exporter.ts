/**
 * PDF export.
 *
 * PRIMARY  — native browser print pipeline. The sheet is already laid out as
 *            explicit A4 pages in the DOM; dedicated @media print styles hide
 *            the app chrome, cancel the zoom transform and let the browser
 *            rasterize a perfectly-shaped, selectable vector PDF (the browser
 *            shapes Arabic itself). `document.title` is set to the target file
 *            name so the browser's "Save as PDF" pre-fills it.
 *
 * FALLBACK — html2canvas + jsPDF. Captures each A4 page as a crisp raster and
 *            triggers a direct download without the print dialog. Used when the
 *            print API is unavailable, and exposed as "تحميل مباشر".
 *
 * Both paths work fully offline (fonts are bundled; libraries are bundled).
 */

import type { Quotation } from "../state/quotation";
import { quotationFileName } from "../state/actions";

export interface ExportCallbacks {
  onStart: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/* --------------------------------------------------------------------------
 * Primary: native print pipeline
 * ------------------------------------------------------------------------ */

export function exportPdfViaPrint(quotation: Quotation, callbacks: ExportCallbacks): Promise<void> {
  if (typeof window.print !== "function") {
    return Promise.reject(new Error("print-unavailable"));
  }

  callbacks.onStart();
  const originalTitle = document.title;
  const body = document.body;
  document.title = quotationFileName(quotation);

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("afterprint", finish);
      window.clearTimeout(safety);
      document.title = originalTitle;
      body.classList.remove("is-printing");
      callbacks.onDone();
      resolve();
    };

    // Some browsers never fire afterprint (or fire it before layout settles),
    // so a bounded safety timer also closes the flow.
    const safety = window.setTimeout(finish, 1500);
    window.addEventListener("afterprint", finish);

    const run = async () => {
      // Ensure fonts are ready so print shaping matches the screen exactly.
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {
          /* ignore */
        }
      }
      body.classList.add("is-printing");
      requestAnimationFrame(() => {
        try {
          window.print();
        } catch {
          settled = true;
          window.removeEventListener("afterprint", finish);
          window.clearTimeout(safety);
          document.title = originalTitle;
          body.classList.remove("is-printing");
          callbacks.onError("print-unavailable");
          reject(new Error("print-unavailable"));
        }
      });
    };

    void run();
  });
}

/* --------------------------------------------------------------------------
 * Fallback: html2canvas + jsPDF (raster, direct download)
 * ------------------------------------------------------------------------ */

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
    const canvasScale = 2.5;

    // html2canvas ignores ancestor transforms, so the zoom wrapper is fine, but
    // temporarily neutralize it to keep captured layout identical.
    const scaleEl = document.querySelector<HTMLElement>(".sheet-scale");
    const prevTransform = scaleEl?.style.transform ?? "";
    if (scaleEl) scaleEl.style.transform = "none";

    try {
      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i]!, {
          scale: canvasScale,
          backgroundColor: "#ffffff",
          useCORS: true,
          logging: false,
        });
        if (i > 0) pdf.addPage();
        const img = canvas.toDataURL("image/jpeg", 0.95);
        pdf.addImage(img, "JPEG", 0, 0, 210, 297);
      }
    } finally {
      if (scaleEl) scaleEl.style.transform = prevTransform;
    }

    pdf.save(quotationFileName(quotation));
    callbacks.onDone();
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : "unknown");
    throw err;
  }
}

/** Decide which pipeline to run; the print API is the primary path. */
export async function exportPdf(
  quotation: Quotation,
  callbacks: ExportCallbacks,
  preferRaster = false,
): Promise<void> {
  if (preferRaster || typeof window.print !== "function") {
    return exportPdfViaRaster(quotation, callbacks);
  }
  try {
    await exportPdfViaPrint(quotation, callbacks);
  } catch {
    // The print API may be blocked (e.g. sandboxed iframe) — auto-fallback.
    await exportPdfViaRaster(quotation, callbacks);
  }
}
