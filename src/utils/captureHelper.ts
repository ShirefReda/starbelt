import { STARBELT_LOGO_DATA_URI } from "../config/logoFallback";

/**
 * Cache for reliable logo HTMLImageElement so we only decode once.
 */
let cachedLogoImage: HTMLImageElement | null = null;
let cachedLogoPromise: Promise<HTMLImageElement | null> | null = null;

/**
 * Load an image from URL and ensure it is decoded and ready for canvas drawing.
 */
function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      if (typeof img.decode === "function") {
        try {
          await img.decode();
        } catch {
          /* ignore decode error */
        }
      }
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Get a guaranteed decoded logo image.
 * Tries:
 * 1. The provided company.logo (resolved to absolute URL)
 * 2. assets/logo.svg (resolved to absolute URL)
 * 3. assets/logo.png (resolved to absolute URL)
 * 4. Embedded STARBELT_LOGO_DATA_URI
 */
export async function getReliableLogo(logoUrl?: string): Promise<HTMLImageElement | null> {
  if (cachedLogoImage && cachedLogoImage.complete && cachedLogoImage.naturalWidth > 0) {
    return cachedLogoImage;
  }
  if (cachedLogoPromise) return cachedLogoPromise;

  cachedLogoPromise = (async () => {
    const candidates: string[] = [];
    if (logoUrl) {
      try {
        candidates.push(new URL(logoUrl, window.location.href).href);
      } catch {
        candidates.push(logoUrl);
      }
    }
    try {
      candidates.push(new URL("assets/logo.svg", window.location.href).href);
    } catch {
      candidates.push("assets/logo.svg");
    }
    try {
      candidates.push(new URL("assets/logo.png", window.location.href).href);
    } catch {
      candidates.push("assets/logo.png");
    }
    candidates.push(STARBELT_LOGO_DATA_URI);

    for (const src of candidates) {
      const img = await loadImageElement(src);
      if (img && img.naturalWidth > 0) {
        cachedLogoImage = img;
        return img;
      }
    }
    return null;
  })();

  const result = await cachedLogoPromise;
  cachedLogoPromise = null;
  return result;
}

/**
 * Wait for all images in the element to be loaded and decoded.
 */
export async function ensureSheetImagesReady(rootEl: HTMLElement): Promise<void> {
  const imgs = Array.from(rootEl.querySelectorAll<HTMLImageElement>("img"));
  if (imgs.length === 0) return;

  await Promise.all(
    imgs.map(async (img) => {
      if (!img.complete) {
        await new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
          window.setTimeout(resolve, 2500);
        });
      }
      if (typeof img.decode === "function") {
        try {
          await img.decode();
        } catch {
          /* ignore */
        }
      }
    }),
  );
}

/**
 * Replace images in clonedDoc with synchronously-drawn <canvas> elements.
 *
 * Why this solves the iOS & Android bug:
 * html2canvas renders <canvas> elements synchronously using CanvasElementContainer.
 * When an <img> is used, html2canvas on iOS Safari tests SVG support via testSVG(),
 * which throws a SecurityError / taints canvas, causing html2canvas to mark all SVGs
 * as unrenderable and completely skip drawing them.
 * On Android, cloned <img> elements inside about:blank iframes fail to load or report
 * naturalWidth: 0, which also causes html2canvas to skip drawing them.
 * Replacing them in clonedDoc with <canvas> elements whose pixels are drawn immediately
 * guarantees that html2canvas draws the logo 100% of the time on all mobile devices.
 */
export function prepareClonedDocForCapture(
  clonedDoc: Document,
  liveElement: HTMLElement,
  backupLogo: HTMLImageElement | null,
): void {
  clonedDoc.body.classList.add("is-exporting");
  clonedDoc.body.classList.remove("is-editing");
  const clonedScale = clonedDoc.querySelector<HTMLElement>(".sheet-scale");
  if (clonedScale) clonedScale.style.transform = "none";

  const liveImgs = Array.from(liveElement.querySelectorAll<HTMLImageElement>("img"));
  const clonedImgs = Array.from(clonedDoc.querySelectorAll<HTMLImageElement>("img"));

  for (let i = 0; i < clonedImgs.length; i++) {
    const cloned = clonedImgs[i]!;
    const live = liveImgs[i];

    const isLogo = !!cloned.closest(".logo-block");
    const isWatermark = !!cloned.closest(".page-watermark");

    // Intrinsic size
    let w = (live && live.complete && live.naturalWidth) || 0;
    let h = (live && live.complete && live.naturalHeight) || 0;

    if (!w || !h) {
      if (backupLogo && backupLogo.complete && backupLogo.naturalWidth > 0) {
        w = backupLogo.naturalWidth;
        h = backupLogo.naturalHeight;
      } else {
        w = 2400;
        h = 1392;
      }
    }

    const canvas = clonedDoc.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    if (ctx) {
      let drawn = false;
      if (live && live.complete && live.naturalWidth > 0) {
        try {
          ctx.drawImage(live, 0, 0, w, h);
          drawn = true;
        } catch {
          drawn = false;
        }
      }
      if (!drawn && backupLogo && backupLogo.complete && backupLogo.naturalWidth > 0) {
        try {
          ctx.drawImage(backupLogo, 0, 0, w, h);
          drawn = true;
        } catch {
          /* ignore */
        }
      }
    }

    // Preserve class names and inline styles
    canvas.className = cloned.className;
    canvas.style.cssText = cloned.style.cssText;

    if (isLogo) {
      canvas.style.height = "24mm";
      canvas.style.width = "auto";
      canvas.style.display = "block";
    }
    if (isWatermark) {
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.style.opacity = "0.08";
      canvas.style.display = "block";
      canvas.style.margin = "0 auto";
    }

    cloned.parentNode?.replaceChild(canvas, cloned);
  }

  // Make any other image URLs absolute so sub-document iframe won't fail
  for (const img of Array.from(clonedDoc.querySelectorAll<HTMLImageElement>("img[src]"))) {
    try {
      img.src = new URL(img.getAttribute("src") || "", window.location.href).href;
    } catch {
      /* ignore */
    }
  }
}
