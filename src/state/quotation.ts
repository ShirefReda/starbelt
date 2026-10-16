/**
 * Data model for quotations.
 * Designed so the upcoming features (history, reopen-and-edit, duplicate) fit
 * without reshaping: every quotation has an id, timestamps and a schemaVersion,
 * and options carry the document-level toggles.
 */

import type { CompanyConfig } from "../config/company";
import { displayDate } from "../utils/id";

export interface QuoteItem {
  id: string;
  name: string;
  qty: number;
  price: number;
}

export interface QuoteNote {
  id: string;
  text: string;
}

export interface QuoteOptions {
  /** Show auto quotation number + date near the title. */
  showNumberAndDate: boolean;
  /** VAT row (14%) under the totals. */
  showVat: boolean;
  vatRate: number; // percent, e.g. 14
  /** Discount row (percent of subtotal). */
  showDiscount: boolean;
  discountPercent: number;
  /** Tafqeet (amount in Arabic words) line. */
  showWords: boolean;
  /** Validity line, e.g. "هذا العرض ساري لمدة 30 يوم". */
  showValidity: boolean;
  validityDays: number;
  /** Watermark logo behind content. */
  showWatermark: boolean;
}

export interface Quotation {
  id: string;
  number: string;
  createdAt: string; // ISO date-time
  updatedAt: string; // ISO date-time
  date?: string; // formatted date string (DD/MM/YYYY)
  client: string;
  attention?: string;
  items: QuoteItem[];
  notes: QuoteNote[];
  approver: string;
  thankYou: string;
  options: QuoteOptions;
  schemaVersion: number;
}

export const SCHEMA_VERSION = 1;

export const defaultOptions: QuoteOptions = {
  showNumberAndDate: false,
  showVat: false,
  vatRate: 14,
  showDiscount: false,
  discountPercent: 0,
  showWords: false,
  showValidity: false,
  validityDays: 30,
  showWatermark: true,
};

export interface AppState {
  quotation: Quotation;
  company: CompanyConfig;
  /** Documents stored on disk (not part of the sheet). */
  saveStatus: "idle" | "dirty" | "saved";
}

export const emptyQuotation = (): Quotation => ({
  id: "",
  number: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  date: displayDate(new Date()),
  client: "",
  items: [],
  notes: [],
  approver: "",
  thankYou: "",
  options: { ...defaultOptions },
  schemaVersion: SCHEMA_VERSION,
});

/**
 * Migrate a stored quotation object (any shape) to the current schema.
 * Returns null when the payload is unusable.
 */
export function migrateQuotation(raw: unknown): Quotation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Quotation>;
  if (typeof r.id !== "string") return null;

  const base = emptyQuotation();
  const options: QuoteOptions = { ...defaultOptions };
  if (r.options && typeof r.options === "object") {
    Object.assign(options, r.options);
  }

  return {
    ...base,
    id: r.id,
    number: typeof r.number === "string" ? r.number : "",
    createdAt: typeof r.createdAt === "string" ? r.createdAt : base.createdAt,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : base.updatedAt,
    date: typeof r.date === "string" ? r.date : (r.createdAt ? displayDate(new Date(r.createdAt)) : base.date),
    client: typeof r.client === "string" ? r.client : "",
    attention: typeof r.attention === "string" ? r.attention : undefined,
    items: Array.isArray(r.items) ? r.items.filter(isQuoteItem) : [],
    notes: Array.isArray(r.notes) ? r.notes.filter(isQuoteNote) : [],
    approver: typeof r.approver === "string" ? r.approver : "",
    thankYou: typeof r.thankYou === "string" ? r.thankYou : "",
    options,
    schemaVersion: SCHEMA_VERSION,
  };
}

function isQuoteItem(v: unknown): v is QuoteItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Partial<QuoteItem>;
  return typeof o.id === "string" && typeof o.name === "string";
}

function isQuoteNote(v: unknown): v is QuoteNote {
  if (!v || typeof v !== "object") return false;
  const o = v as Partial<QuoteNote>;
  return typeof o.id === "string" && typeof o.text === "string";
}
