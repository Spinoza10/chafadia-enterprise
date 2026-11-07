import { useState } from "react";
import { Alert, Badge, Field, Modal, Stat, StaffLayout } from "../../components/staff/StaffLayout";
import { useAuth } from "../../context/AuthContext";
import { api, formatDate, formatMoney } from "../../lib/api";
import { useAction, useApi } from "../../lib/useApi";

const TYPE_LABELS = { purchase: "Purchase", sale: "Sale", adjustment: "Adjustment", return: "Return", cancellation: "Cancellation" };

function StockControl() {
  const { can } = useAuth();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const { data, error, reload } = useApi(`/api/admin/products?limit=500&status=${filter}${search ? `&search=${encodeURIComponent(search)}` : ""}`);
  const [target, setTarget] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const { data: history } = useApi(historyFor ? `/api/admin/stock-movements?variantId=${historyFor.id}&limit=100` : null);
  const [form, setForm] = useState({ type: "purchase", quantity: "", note: "", costPrice: "" });
  const action = useAction();

  const rows = (data?.data ?? []).flatMap((p) => p.variants.filter((v) => v.trackStock).map((v) => ({ ...v, productName: p.name })));
  const units = rows.reduce((s, v) => s + v.stockQty, 0);
  const value = rows.reduce((s, v) => s + v.stockQty * (v.costPrice ?? 0), 0);

  const submit = (e) => {
    e.preventDefault();
    action.run(async () => {
      const qty = Number(form.quantity);
      await api.post(`/api/admin/variants/${target.id}/stock`, {
        type: form.type,
        quantity: qty,
        note: form.note,
        ...(form.type === "purchase" && form.costPrice !== "" && { costPrice: Number(form.costPrice) }),
      });
      setTarget(null);
      setForm({ type: "purchase", quantity: "", note: "", costPrice: "" });
      await reload();
    }, "Stock updated and recorded.");
  };

  return (
    <StaffLayout title="Stock control" subtitle="Record deliveries from suppliers and corrections. Sales and returns update stock automatically.">
      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{action.message}</Alert>
      <div className="st-grid" style={{ marginBottom: 16 }}>
        <Stat label="Stock lines" value={rows.length} />
        <Stat label="Units in stock" value={units} />
        <Stat label="Low stock" value={rows.filter((v) => v.lowStock).length} />
        <Stat label="Out of stock" value={rows.filter((v) => v.available <= 0).length} />
        {can("products.view_cost") && <Stat label="Stock value (cost)" value={formatMoney(value)} />}
      </div>
      <section className="st-card">
        <div className="st-toolbar">
          <input className="st-input" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="st-input" style={{ flex: "0 0 auto" }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All</option><option value="low">Low stock</option><option value="out">Out of stock</option>
          </select>
        </div>
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>Product</th><th>SKU</th><th className="num">On hand</th><th className="num">Reserved</th><th className="num">Available</th><th className="num">Alert at</th><th></th></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>{v.productName}{v.name !== "Standard" ? ` - ${v.name}` : ""}</td>
                  <td>{v.sku}</td>
                  <td className="num">{v.stockQty}</td>
                  <td className="num">{v.reservedQty}</td>
                  <td className="num"><Badge status={v.available <= 0 ? "refunded" : v.lowStock ? "pending" : "active"}>{v.available}</Badge></td>
                  <td className="num">{v.lowStockThreshold}</td>
                  <td><div className="st-actions"><button className="st-btn small" onClick={() => setTarget(v)}>Adjust</button><button className="st-btn light small" onClick={() => setHistoryFor(v)}>History</button></div></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="st-empty">No stock items.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {target && (
        <Modal title={`Adjust stock - ${target.productName}`} onClose={() => setTarget(null)}>
          <p className="st-muted">On hand: {target.stockQty} - reserved by unpaid orders: {target.reservedQty}</p>
          <form className="st-form" onSubmit={submit}>
            <Alert kind="error">{action.error}</Alert>
            <div className="st-row">
              <Field label="Type">
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="purchase">Purchase / delivery received (+)</option>
                  <option value="adjustment">Adjustment / correction (+ or -)</option>
                </select>
              </Field>
              <Field label={form.type === "purchase" ? "Units received" : "Change (e.g. -2 for damaged)"}>
                <input type="number" required min={form.type === "purchase" ? 1 : undefined} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </Field>
              {form.type === "purchase" && can("products.view_cost") && (
                <Field label="New cost price (optional)"><input type="number" min={0} value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></Field>
              )}
            </div>
            <Field label="Reason / supplier / note"><input required minLength={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            <div><button className="st-btn" disabled={action.busy}>Record</button></div>
          </form>
        </Modal>
      )}

      {historyFor && (
        <Modal title={`Stock history - ${historyFor.productName}`} onClose={() => setHistoryFor(null)}>
          <div className="st-table-wrap">
            <table className="st-table">
              <thead><tr><th>Date</th><th>Type</th><th className="num">Change</th><th className="num">After</th><th>By</th><th>Note / ref</th></tr></thead>
              <tbody>
                {(history?.data ?? []).map((m) => (
                  <tr key={m.id}><td>{formatDate(m.createdAt)}</td><td>{TYPE_LABELS[m.type]}</td><td className="num">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td><td className="num">{m.stockAfter}</td><td>{m.createdBy ?? "System"}</td><td>{m.note ?? (m.referenceType === "order" ? `Order #${m.referenceId}` : m.referenceType)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </StaffLayout>
  );
}

export default StockControl;
