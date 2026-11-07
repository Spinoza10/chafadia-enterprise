import { useState } from "react";
import { Alert, Badge, StaffLayout } from "../../components/staff/StaffLayout";
import { useAuth } from "../../context/AuthContext";
import { api, formatDate, formatMoney, METHOD_LABELS, openPdf, qs } from "../../lib/api";
import { useAction, useApi } from "../../lib/useApi";

/** Receipt list with print (80mm thermal / A4), reprint (stamped COPY and logged) and email. */
function Receipts() {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const { data, error, reload } = useApi(`/api/receipts${qs({ search, limit: 100 })}`);
  const action = useAction();
  const receipts = data?.data ?? [];

  const print = (r, format) =>
    action.run(async () => {
      await openPdf(`/api/receipts/${r.id}/pdf?format=${format}`);
      await reload();
    });
  const email = (r) =>
    action.run(async () => {
      const res = await api.post(`/api/receipts/${r.id}/email`);
      action.setMessage(res.message);
    });

  return (
    <StaffLayout title="Receipts" subtitle="The first print is the original. Every later print is stamped COPY and recorded.">
      <Alert kind="error">{error || action.error}</Alert>
      <Alert kind="success">{action.message}</Alert>
      <section className="st-card">
        <div className="st-toolbar">
          <input className="st-input" placeholder={can("orders.view") ? "Receipt no, order no, customer, phone" : "Exact receipt number to reprint (e.g. RCP-2026-000012)"} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>Receipt</th><th>Date</th><th>Customer</th><th>Method</th><th className="num">Total</th><th>Prints</th><th></th></tr></thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.number}</strong><div className="st-muted">{r.orderNumber} - {r.channel === "pos" ? `POS (${r.cashierName})` : "Online"}</div></td>
                  <td>{formatDate(r.issuedAt)}</td>
                  <td>{r.customerName}<div className="st-muted">{r.customerPhone}</div></td>
                  <td>{METHOD_LABELS[r.paymentMethod]}</td>
                  <td className="num">{formatMoney(r.grandTotal)}{r.amountRefunded > 0 && <div><Badge status="refunded">refunded {formatMoney(r.amountRefunded)}</Badge></div>}</td>
                  <td>{r.printCount}{r.emailedAt && <div className="st-muted">emailed</div>}</td>
                  <td>
                    <div className="st-actions">
                      <button className="st-btn small" disabled={action.busy} onClick={() => print(r, "80mm")}>{r.printCount ? "Reprint" : "Print"} 80mm</button>
                      <button className="st-btn light small" disabled={action.busy} onClick={() => print(r, "a4")}>A4</button>
                      <button className="st-btn light small" disabled={action.busy} onClick={() => email(r)}>Email</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!receipts.length && <tr><td colSpan={7} className="st-empty">No receipts found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </StaffLayout>
  );
}

export default Receipts;
