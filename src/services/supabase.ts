import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Quotation } from "../state/quotation";
import { computeTotals } from "../utils/totals";
import { migrateQuotation } from "../state/quotation";

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ||
  "https://xzbjxhuvjbiucbtjwpbv.supabase.co";

const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
  "sb_publishable_QRmU1-08UfRJaAbmiAXCgw_Xvwmd86K";

export const isSupabaseConfigured = (): boolean => {
  return Boolean(supabaseUrl && supabaseAnonKey);
};

export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

export interface QuotationRow {
  id: string;
  number: string;
  client: string;
  attention?: string | null;
  total?: number;
  items: unknown;
  notes: unknown;
  options: unknown;
  approver?: string | null;
  thank_you?: string | null;
  quote_date?: string | null;
  created_at: string;
  updated_at: string;
  data: unknown;
}

/** Formats a quotation for Supabase storage */
export function toQuotationRow(q: Quotation): QuotationRow {
  const totals = computeTotals(q.items, q.options);
  const now = new Date().toISOString();
  return {
    id: q.id,
    number: q.number,
    client: q.client.trim(),
    attention: q.attention?.trim() || null,
    total: totals.total,
    items: q.items,
    notes: q.notes,
    options: q.options,
    approver: q.approver?.trim() || null,
    thank_you: q.thankYou?.trim() || null,
    quote_date: q.date || null,
    created_at: q.createdAt || now,
    updated_at: q.updatedAt || now,
    data: q,
  };
}

/** Converts a Supabase row back to a Quotation */
export function fromQuotationRow(row: QuotationRow): Quotation | null {
  if (row.data && typeof row.data === "object") {
    const migrated = migrateQuotation(row.data);
    if (migrated) return migrated;
  }
  // Fallback reconstruction
  try {
    const fallback = {
      id: row.id,
      number: row.number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      date: row.quote_date || undefined,
      client: row.client || "",
      attention: row.attention || undefined,
      items: Array.isArray(row.items) ? row.items : [],
      notes: Array.isArray(row.notes) ? row.notes : [],
      approver: row.approver || "",
      thankYou: row.thank_you || "",
      options: (row.options as Quotation["options"]) || {},
      schemaVersion: 1,
    };
    return migrateQuotation(fallback);
  } catch {
    return null;
  }
}

/** Save/upsert a quotation in Supabase */
export async function saveQuotationToSupabase(
  q: Quotation,
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: "Supabase is not configured" };
  }

  // Avoid saving completely empty quotations (no client name and no named items)
  const hasClient = Boolean(q.client && q.client.trim().length > 0);
  const hasItems = q.items.some((it) => it.name && it.name.trim().length > 0);
  if (!hasClient && !hasItems) {
    return { success: false, error: "Empty quotation skipped" };
  }

  try {
    const row = toQuotationRow(q);
    const { error } = await supabase.from("quotations").upsert(row, { onConflict: "id" });
    if (error) {
      console.warn("[Supabase] Upsert error:", error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[Supabase] Failed to save quotation:", msg);
    return { success: false, error: msg };
  }
}

/** List recent quotations from Supabase */
export async function fetchQuotationsFromSupabase(limit = 100): Promise<Quotation[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("quotations")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error || !data) {
      console.warn("[Supabase] Fetch error:", error?.message);
      return [];
    }

    return (data as QuotationRow[])
      .map(fromQuotationRow)
      .filter((q): q is Quotation => q !== null);
  } catch (err) {
    console.warn("[Supabase] Failed to fetch quotations:", err);
    return [];
  }
}

