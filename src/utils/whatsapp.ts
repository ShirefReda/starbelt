/**
 * WhatsApp helpers — same normalization rules as starbelt-main's
 * normalize_egyptian_number, so any number staff type matches the
 * Evolution API's expectations.
 */

export function normalizeEgyptianNumber(raw: string): string {
  let v = String(raw ?? "").trim();
  v = v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  v = v.replace(/[\s().-]/g, "");
  if (v.startsWith("00")) v = v.slice(2);
  else if (v.startsWith("+")) v = v.slice(1);
  if (v.startsWith("01") && v.length === 11) v = `20${v.slice(1)}`;
  else if (v.startsWith("1") && v.length === 10) v = `20${v}`;
  if (!/^20\d{10}$/.test(v)) throw new Error("أدخل رقمًا مصريًا صحيحًا مثل 01012345678 أو +201012345678");
  return v;
}

export function isValidEgyptianNumber(raw: string): boolean {
  try {
    normalizeEgyptianNumber(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Render the quotation as a PNG Blob by rasterizing the visible sheet.
 * Reuses the same raster path as the PDF fallback (html2canvas) — keeps the
 * WhatsApp media identical to what the staff sees.
 */
export async function renderSheetAsPngBlob(sheetEl: HTMLElement): Promise<Blob> {
  const { default: html2canvas } = await import("html2canvas");
  const scaleEl = document.querySelector<HTMLElement>(".sheet-scale");
  const prev = scaleEl?.style.transform ?? "";
  if (scaleEl) scaleEl.style.transform = "none";

  const pages = Array.from(sheetEl.querySelectorAll<HTMLElement>(".sheet-page"));
  const singleBlob = async (el: HTMLElement): Promise<Blob> => {
    const canvas = await html2canvas(el, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png", 1);
    });
  };

  let blob: Blob;
  if (pages.length > 1) {
    const canvases = await Promise.all(pages.map((p) => html2canvas(p, {
      scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false,
    })));
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
    blob = await singleBlob((pages[0] as HTMLElement) ?? sheetEl);
  }

  if (scaleEl) scaleEl.style.transform = prev;
  return blob;
}

export function fileNameForQuote(client: string): string {
  const safe = client.trim().replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  const date = new Date().toISOString().slice(0, 10);
  return safe ? `عرض سعر - ${safe} - ${date}.png` : `عرض سعر - ${date}.png`;
}
