/**
 * A tiny focus bus so the toolbar ("إضافة صنف") and the sheet's Enter-key flow
 * can ask the sheet to focus a specific cell after the next render.
 */

export type CellKind = "item" | "qty" | "price";

export interface FocusRequest {
  row: number;
  cell: CellKind;
}

type Listener = (req: FocusRequest) => void;

const listeners = new Set<Listener>();

export function onFocusRequest(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function requestFocus(req: FocusRequest): void {
  for (const fn of listeners) fn(req);
}

/** Query the sheet's editable cells in the live (non-measure) DOM. */
export function findCell(row: number, cell: CellKind): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.sheet-pages [data-row="${row}"][data-cell="${cell}"]`,
  );
}
