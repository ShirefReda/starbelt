import { useEffect, useMemo, useState } from "preact/hooks";
import type { Quotation } from "../state/quotation";
import { fetchQuotationsFromSupabase, isSupabaseConfigured } from "../services/supabase";
import { repo } from "../state/actions";
import { computeTotals } from "../utils/totals";
import { formatMoney } from "../utils/money";
import { IconClose, IconCloud } from "./icons";

interface QuotationsHistoryDialogProps {
  onClose: () => void;
  onSelectQuotation: (q: Quotation) => void;
  onToast: (msg: string, isError?: boolean) => void;
}

export function QuotationsHistoryDialog({
  onClose,
  onSelectQuotation,
  onToast,
}: QuotationsHistoryDialogProps) {
  const [items, setItems] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const isCloud = isSupabaseConfigured();

  const loadData = async () => {
    setLoading(true);
    try {
      if (isCloud) {
        const cloudData = await fetchQuotationsFromSupabase(100);
        if (cloudData.length > 0) {
          setItems(cloudData);
          setLoading(false);
          return;
        }
      }
      // Fallback to local
      const local = repo.listQuotations();
      setItems(local);
    } catch {
      const local = repo.listQuotations();
      setItems(local);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.number.toLowerCase().includes(q) ||
        item.client.toLowerCase().includes(q) ||
        (item.attention && item.attention.toLowerCase().includes(q)) ||
        (item.date && item.date.includes(q)),
    );
  }, [items, query]);

  const handleSelect = (q: Quotation) => {
    onSelectQuotation(q);
    onToast(`تم تحميل عرض السعر (${q.number})`);
    onClose();
  };

  return (
    <div
      class="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="سجل عروض الأسعار"
      onClick={onClose}
    >
      <div
        class="dialog"
        style={{ maxWidth: "780px", width: "95vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="dialog__head">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <IconCloud size={20} />
            <h2 class="dialog__title">سجل عروض الأسعار (Supabase)</h2>
          </div>
          <button class="dialog__close" onClick={onClose} aria-label="إغلاق">
            <IconClose />
          </button>
        </div>

        <div class="dialog__body" style={{ maxHeight: "70vh", overflowY: "auto" }}>
          <div
            style={{
              display: "flex",
              gap: "10px",
              marginBottom: "16px",
              alignItems: "center",
            }}
          >
            <input
              type="text"
              class="input"
              placeholder="ابحث برقم العرض، اسم العميل، أو التاريخ…"
              value={query}
              onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
              style={{ flex: 1 }}
              autoFocus
            />
            <button
              type="button"
              class="btn"
              onClick={loadData}
              disabled={loading}
              title="تحديث القائمة"
            >
              {loading ? "جارٍ التحديث…" : "تحديث"}
            </button>
          </div>

          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              جارٍ تحميل عروض الأسعار من السحابة…
            </div>
          ) : filtered.length === 0 ? (
            <div
              style={{
                padding: "48px 24px",
                textAlign: "center",
                color: "var(--text-muted)",
                background: "var(--surface-2)",
                borderRadius: "var(--radius)",
                border: "1px dashed var(--border)",
              }}
            >
              {query ? "لا توجد نتائج مطابقة لبحثك." : "لا توجد عروض أسعار محفوظة حتى الآن."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {filtered.map((item) => {
                const totals = computeTotals(item.items || [], item.options || ({} as any));
                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "14px 18px",
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      gap: "14px",
                      flexWrap: "wrap",
                      transition: "border-color 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "200px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            fontWeight: 700,
                            fontFamily: "monospace",
                            background: "var(--surface-1)",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            border: "1px solid var(--border)",
                            color: "var(--title-blue)",
                          }}
                        >
                          {item.number}
                        </span>
                        <span style={{ fontWeight: 600, fontSize: "15px" }}>
                          {item.client || "بدون اسم عميل"}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--text-muted)",
                          display: "flex",
                          gap: "12px",
                        }}
                      >
                        {item.date && <span>📅 {item.date}</span>}
                        {item.attention && <span>عناية: {item.attention}</span>}
                        <span>{item.items?.length || 0} أصناف</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                      <div style={{ textAlign: "left", minWidth: "100px" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block" }}>
                          الإجمالي
                        </span>
                        <span style={{ fontWeight: 700, color: "var(--gold-dark)", fontSize: "16px" }}>
                          {formatMoney(totals.total)} ج.م
                        </span>
                      </div>

                      <button
                        type="button"
                        class="btn btn--primary"
                        onClick={() => handleSelect(item)}
                        title="تحميل عرض السعر في المحرر"
                      >
                        فتح العرض
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div class="dialog__foot">
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-muted)" }}>
            <span
              style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: isCloud ? "var(--success)" : "var(--text-faint)",
              }}
            />
            <span>{isCloud ? "قاعدة بيانات Supabase السحابية متصلة" : "الوضع المحلي (Offline)"}</span>
          </div>
          <span class="spacer" />
          <button type="button" class="btn" onClick={onClose}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
