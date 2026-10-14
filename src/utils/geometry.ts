/**
 * Sheet geometry, in CSS pixels at 96 dpi (1mm = 96/25.4 px).
 * Kept in one place so the sheet CSS and the pagination math stay in sync.
 */

export const PX_PER_MM = 96 / 25.4;

export const MM = (v: number): number => v * PX_PER_MM;

export const PAGE_W_MM = 210;
export const PAGE_H_MM = 297;

export const HEADER_BAND_MM = 33;
export const FOOTER_BAND_MM = 26;
export const BODY_PAD_TOP_MM = 4;
export const BODY_PAD_X_MM = 10;

/** Width of the printable content column, in px. */
export const CONTENT_W = MM(PAGE_W_MM - 2 * BODY_PAD_X_MM);

/** Usable body height, in px (page minus bands minus top padding minus a safety margin). */
export const CONTENT_H = MM(PAGE_H_MM - HEADER_BAND_MM - FOOTER_BAND_MM - BODY_PAD_TOP_MM - 2);
