import { useState } from "react";
import { OrderDetail } from "../components/staff/OrderDetail";
import { Alert, Badge, StaffLayout } from "../components/staff/StaffLayout";
import { formatDate, formatMoney, STATUS_LABELS } from "../lib/api";
import { directionsUrl } from "../lib/maps";
import { useApi } from "../lib/useApi";

/** Delivery person's screen: only orders assigned to them (enforced by the API). */
function DeliveryDashboard() {
  const { data, error, reload } = useApi("/api/orders?limit=100");
  const [open, setOpen] = useState(null);
  const orders = (data?.data ?? []).filter((o) => !["delivered", "cancelled", "refunded"].includes(o.status));
  const done = (data?.data ?? []).filter((o) => o.status === "delivered");

  return (
    <StaffLayout title="My deliveries" subtitle="Orders assigned to you. Tap an order to update its status.">
      <Alert kind="error">{error}</Alert>
      <div className="st-grid-2">
        {orders.map((o) => (
          <section className="st-card" key={o.id}>
            <div className="st-toolbar" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>{o.orderNumber}</h3>
              <Badge status={o.status}>{STATUS_LABELS[o.status]}</Badge>
            </div>
            <p><strong>{o.customer.name}</strong> - <a href={`tel:${o.customer.phone}`}>{o.customer.phone}</a></p>
            <p className="st-muted">{o.deliveryAddress}</p>
            <p>{o.items.reduce((s, i) => s + i.quantity, 0)} item(s) - {o.balance > 0 ? <Badge status="pending">collect {formatMoney(o.balance)}</Badge> : <Badge status="paid">paid</Badge>}</p>
            <div className="st-actions">
              {o.location && <a className="st-btn gold small" href={directionsUrl(o.location)} target="_blank" rel="noreferrer">🧭 Directions</a>}
              <button className="st-btn small" onClick={() => setOpen(o.id)}>Open / update</button>
            </div>
          </section>
        ))}
      </div>
      {!orders.length && <div className="st-card st-empty">No active deliveries assigned to you.</div>}
      {done.length > 0 && (
        <section className="st-card">
          <h2>Delivered</h2>
          <ul className="st-timeline">{done.slice(0, 20).map((o) => <li key={o.id}>{o.orderNumber} - {o.customer.name} - {formatDate(o.deliveredAt)}</li>)}</ul>
        </section>
      )}
      {open && <OrderDetail orderId={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </StaffLayout>
  );
}

export default DeliveryDashboard;
