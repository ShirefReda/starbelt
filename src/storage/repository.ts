/**
 * Storage abstraction.
 *
 * The app talks only to this interface. The current implementation uses
 * localStorage for the autosaved draft, the quotation counter and the item-name
 * autocomplete list. Swapping to IndexedDB later means adding another class
 * that implements `QuotationRepository` — no UI changes required.
 */

import type { Quotation } from "../state/quotation";

export interface QuotationRepository {
  /** Current autosaved draft, or null when there is none. */
  getDraft(): Quotation | null;
  saveDraft(q: Quotation): void;
  clearDraft(): void;

  /** Sequential quotation number, e.g. SB-2026-0007. */
  nextQuotationNumber(year: number): string;

  /** Item names previously typed, most-recent-first, for autocomplete. */
  getItemNames(): string[];
  rememberItemName(name: string): void;

  /** Persisted company overrides (partial). */
  getCompanyOverrides(): Record<string, unknown>;
  saveCompanyOverrides(values: Record<string, unknown>): void;
  clearCompanyOverrides(): void;

  /** Full-list storage used by the future history UI (not wired to UI yet). */
  listQuotations(): Quotation[];
  saveQuotation(q: Quotation): void;
  deleteQuotation(id: string): void;
}
