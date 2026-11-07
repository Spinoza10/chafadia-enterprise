import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OrderDetail } from "../../components/staff/OrderDetail";
import { Alert, Badge, StaffLayout } from "../../components/staff/StaffLayout";
import { formatDate, formatMoney, qs, STATUS_LABELS } from "../../lib/api";
import { useApi } from "../../lib/useApi";

function ManageOrders() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [search, setSearch] = useState("");
  const [attention, setAttention] = useState(false);
  const [page, setPage] = useState(1);
  const path = `/api/orders${qs({ status, channel, search, page, limit: 50, attention: attention ? "true" : "" })}`;
  const { data, error, reload } = useApi(path);
  const openId = params.get("open");

  // new orders appear without a manual refresh
  useEffect(() => {
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, [reload]);

  const orders = data?.data ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 50));

  return (
    <StaffLayout title="Orders & delivery" subtitle="Online and in-store orders. Paid status only comes from verified payments.">
      <Alert kind="error">{error}</Alert>
      <section className="st-card">
        <div className="st-toolbar">
          <input className="st-input" placeholder="Order, receipt, customer, phone..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <select className="st-input" style={{ flex: "0 0 auto" }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="st-input" style={{ flex: "0 0 auto" }} value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">Online + in store</option><option value="online">Online</option><option value="pos">In store (POS)</option>
          </select>
          <label className="st-check"><input type="checkbox" checked={attention} onChange={(e) => setAttention(e.target.checked)} /> Needs attention</label>
          <button className="st-btn light small" onClick={reload}>Refresh</button>
        </div>
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th className="num">Total</th><th>Status</th><th>Delivery</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => setParams({ open: o.id })}>
                  <td><strong>{o.orderNumber}</strong>{o.receipt && <div className="st-muted">{o.receipt.number}</div>}{o.needsAttention && <div><Badge status="failed">attention</Badge></div>}</td>
                  <td>{formatDate(o.createdAt)}</td>
                  <td>{o.customer.name}<div className="st-muted">{o.customer.phone}</div></td>
                  <td>{o.items.reduce((s, i) => s + i.quantity, 0)} item(s)</td>
                  <td className="num">{formatMoney(o.grandTotal)}</td>
                  <td><Badge status={o.status}>{STATUS_LABELS[o.status]}</Badge></td>
                  <td>{o.fulfilment === "delivery" ? (o.deliveryPerson?.name ?? <span className="st-muted">unassigned</span>) : <span className="st-muted">{o.fulfilment === "pickup" ? "pickup" : "in store"}</span>}</td>
                </tr>
              ))}
              {!orders.length && <tr><td colSpan={7} className="st-empty">No orders.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="st-toolbar" style={{ marginTop: 10 }}>
          <button className="st-btn light small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="st-muted">Page {page} of {pages}</span>
          <button className="st-btn light small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </section>
      {openId && <OrderDetail orderId={openId} onClose={() => setParams({})} onChanged={reload} />}
    </StaffLayout>
  );
}

export default ManageOrders;
