/**
 * localStorage implementation of QuotationRepository.
 *
 * Everything is namespaced under `sb.` and reads/writes are wrapped in
 * try/catch so a full or disabled storage never breaks the app.
 */

import type { Quotation } from "../state/quotation";
import { migrateQuotation } from "../state/quotation";
import type { QuotationRepository } from "./repository";

const KEYS = {
  draft: "sb.draft.v1",
  counter: "sb.counter.v1",
  itemNames: "sb.itemNames.v1",
  company: "sb.company.v1",
  quotations: "sb.quotations.v1",
} as const;

const MAX_ITEM_NAMES = 120;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full — ignore */
  }
}

export class LocalStorageQuotationRepository implements QuotationRepository {
  getDraft(): Quotation | null {
    return migrateQuotation(read<unknown>(KEYS.draft, null));
  }

  saveDraft(q: Quotation): void {
    write(KEYS.draft, q);
  }

  clearDraft(): void {
    try {
      localStorage.removeItem(KEYS.draft);
    } catch {
      /* ignore */
    }
  }

  nextQuotationNumber(year: number): string {
    const counters = read<Record<string, number>>(KEYS.counter, {});
    const current = counters[String(year)] ?? 0;
    const next = current + 1;
    counters[String(year)] = next;
    write(KEYS.counter, counters);
    return `SB-${year}-${String(next).padStart(4, "0")}`;
  }

  getItemNames(): string[] {
    return read<string[]>(KEYS.itemNames, []);
  }

  rememberItemName(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length < 2) return;
    const list = this.getItemNames().filter((n) => n !== trimmed);
    list.unshift(trimmed);
    write(KEYS.itemNames, list.slice(0, MAX_ITEM_NAMES));
  }

  getCompanyOverrides(): Record<string, unknown> {
    return read<Record<string, unknown>>(KEYS.company, {});
  }

  saveCompanyOverrides(values: Record<string, unknown>): void {
    write(KEYS.company, values);
  }

  clearCompanyOverrides(): void {
    try {
      localStorage.removeItem(KEYS.company);
    } catch {
      /* ignore */
    }
  }

  listQuotations(): Quotation[] {
    const raw = read<unknown[]>(KEYS.quotations, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => migrateQuotation(r))
      .filter((q): q is Quotation => q !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  saveQuotation(q: Quotation): void {
    const list = this.listQuotations().filter((x) => x.id !== q.id);
    list.unshift(q);
    write(KEYS.quotations, list);
  }

  deleteQuotation(id: string): void {
    write(
      KEYS.quotations,
      this.listQuotations().filter((x) => x.id !== id),
    );
  }
}
