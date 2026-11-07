import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, StaffLayout } from "../../components/staff/StaffLayout";
import { formatDate, formatMoney, METHOD_LABELS, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";

/** Every payment attempt (online and in store). Read-only: payments change only through verified webhooks or cash recording. */
function Transactions() {
  const [status, setStatus] = useState("");
  const [method, setMethod] = useState("");
  const [search, setSearch] = useState("");
  const { data, error } = useApi(`/api/payments${qs({ status, method, search, limit: 200 })}`);
  const rows = data?.data ?? [];
  const succeeded = rows.filter((p) => p.status === "succeeded" || p.status.includes("refunded"));

  return (
    <StaffLayout title="Payments" subtitle="MTN MoMo, Orange Money, card and cash payments with provider references.">
      <Alert kind="error">{error}</Alert>
      <section className="st-card">
        <div className="st-toolbar">
          <input className="st-input" placeholder="Reference, order, customer, phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="st-input" style={{ flex: "0 0 auto" }} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">All methods</option>
            {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="st-input" style={{ flex: "0 0 auto" }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {["pending", "succeeded", "failed", "expired", "cancelled", "refunded", "partially_refunded"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
          <span className="st-muted">{succeeded.length} successful - {formatMoney(succeeded.reduce((s, p) => s + p.amount, 0))}</span>
        </div>
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>Date</th><th>Reference</th><th>Order</th><th>Customer</th><th>Method</th><th className="num">Amount</th><th>Status</th><th>Recorded by</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.createdAt)}</td>
                  <td><code>{p.reference}</code>{p.providerReference && <div className="st-muted">{p.providerReference}</div>}</td>
                  <td><Link to={`/admin/orders?open=${p.orderId}`}>{p.orderNumber}</Link></td>
                  <td>{p.customerName}<div className="st-muted">{p.phone}</div></td>
                  <td>{METHOD_LABELS[p.method]} <span className="st-muted">({p.provider})</span></td>
                  <td className="num">{formatMoney(p.amount)}</td>
                  <td><Badge status={p.status} />{p.failureReason && <div className="st-muted">{p.failureReason}</div>}</td>
                  <td>{p.recordedBy ?? <span className="st-muted">provider webhook</span>}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="st-empty">No payments.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </StaffLayout>
  );
}

export default Transactions;
