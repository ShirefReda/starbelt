/**
 * Render the quotation sheet as a Blob — PNG (image) or PDF (raster PDF
 * from the same sheet raster). Both use the html2canvas capture so the
 * WhatsApp media matches exactly what the user sees.
 */

import { fileNameForQuote as pngFileName } from "./whatsapp";

export type QuoteMediaKind = "png" | "pdf";

export interface RenderedQuoteMedia {
  blob: Blob;
  fileName: string;
  mimetype: string;
}

export function mediaFileName(client: string, kind: QuoteMediaKind): string {
  const date = new Date().toISOString().slice(0, 10);
  const safe = client.trim().replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  const ext = kind === "pdf" ? "pdf" : "png";
  return safe ? `عرض سعر - ${safe} - ${date}.${ext}` : `عرض سعر - ${date}.${ext}`;
}

export async function renderSheetAsPngBlob(sheetEl: HTMLElement): Promise<Blob> {
  const { default: html2canvas } = await import("html2canvas");
  const scaleEl = document.querySelector<HTMLElement>(".sheet-scale");
  const prev = scaleEl?.style.transform ?? "";
  if (scaleEl) scaleEl.style.transform = "none";

  const pages = Array.from(sheetEl.querySelectorAll<HTMLElement>(".sheet-page"));
  const capture = (el: HTMLElement) =>
    html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });

  let blob: Blob;
  if (pages.length > 1) {
    const canvases = await Promise.all(pages.map((p) => capture(p)));
    const { width } = canvases[0]!;
    const merged = document.createElement("canvas");
    merged.width = width;
    merged.height = canvases.reduce((h, c) => h + c.height, 0);
    const ctx = merged.getContext("2d");
    if (!ctx) throw new Error("canvas context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, merged.width, merged.height);
    let y = 0;
    for (const c of canvases) {
      ctx.drawImage(c, 0, y);
      y += c.height;
    }
    blob = await new Promise<Blob>((resolve, reject) => {
      merged.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png", 1);
    });
  } else {
    const el = (pages[0] as HTMLElement) ?? sheetEl;
    const canvas = await capture(el);
    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png", 1);
    });
  }

  if (scaleEl) scaleEl.style.transform = prev;
  return blob;
}

export async function renderSheetAsPdfBlob(sheetEl: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const scaleEl = document.querySelector<HTMLElement>(".sheet-scale");
  const prev = scaleEl?.style.transform ?? "";
  if (scaleEl) scaleEl.style.transform = "none";

  const pages = Array.from(sheetEl.querySelectorAll<HTMLElement>(".sheet-page"));
  if (pages.length === 0) throw new Error("no-pages");

  const pdf = new (jsPDF as unknown as new (o: unknown) => {
    addImage: (img: string, fmt: string, x: number, y: number, w: number, h: number) => void;
    addPage: () => void;
    output: (t: string) => Blob;
  })({ unit: "mm", format: "a4", orientation: "portrait", compress: true });

  try {
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i]!, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      if (i > 0) pdf.addPage();
      const img = canvas.toDataURL("image/jpeg", 0.95);
      pdf.addImage(img, "JPEG", 0, 0, 210, 297);
    }
  } finally {
    if (scaleEl) scaleEl.style.transform = prev;
  }

  return pdf.output("blob");
}

export async function renderQuoteMedia(
  sheetEl: HTMLElement,
  client: string,
  kind: QuoteMediaKind,
): Promise<RenderedQuoteMedia> {
  if (kind === "pdf") {
    const blob = await renderSheetAsPdfBlob(sheetEl);
    return { blob, fileName: mediaFileName(client, "pdf"), mimetype: "application/pdf" };
  }
  const blob = await renderSheetAsPngBlob(sheetEl);
  return { blob, fileName: pngFileName(client), mimetype: "image/png" };
}
