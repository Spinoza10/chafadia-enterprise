import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { api, formatDate, formatMoney, METHOD_LABELS, openPdf, STATUS_LABELS } from "../../lib/api";
import { currentPosition, directionsUrl, embedUrl } from "../../lib/maps";
import { useAction, useApi } from "../../lib/useApi";
import { Alert, Badge, Field, Modal } from "./StaffLayout";

const NEXT = {
  paid: ["processing", "completed"],
  processing: ["out_for_delivery", "completed"],
  out_for_delivery: ["delivered"],
};

/** Order detail modal used by Orders, Delivery and POS screens. Buttons reflect the user's permissions; the API re-checks all of them. */
export function OrderDetail({ orderId, onClose, onChanged }) {
  const { can, currentUser } = useAuth();
  const { data, error, reload } = useApi(`/api/orders/${orderId}`);
  const { data: riders } = useApi(can("orders.manage_delivery") ? "/api/staff/delivery-people" : null);
  const { data: settings } = useApi("/api/settings/public");
  const action = useAction();
  const [refund, setRefund] = useState(null);
  const o = data?.data;

  const done = async (msg) => {
    await reload();
    onChanged?.();
    if (msg) action.setMessage(msg);
  };
  const setStatus = (status) => action.run(async () => {
    await api.patch(`/api/orders/${orderId}/status`, { status });
    await done(`Marked ${STATUS_LABELS[status]}. The customer is notified by email.`);
  });
  const assign = (id) => action.run(async () => {
    await api.patch(`/api/orders/${orderId}/assign`, { deliveryPersonId: id ? Number(id) : null });
    await done("Delivery person updated.");
  });
  const cash = () => {
    if (!window.confirm(`Confirm you received ${formatMoney(o.balance)} in cash?`)) return;
    action.run(async () => {
      await api.post(`/api/orders/${orderId}/payments/cash`, {});
      await done("Cash payment recorded. Receipt issued.");
    });
  };
  const cancel = () => {
    const reason = window.prompt("Reason for cancelling?");
    if (!reason) return;
    action.run(async () => {
      await api.post(`/api/orders/${orderId}/cancel`, { reason });
      await done("Order cancelled and stock released.");
    });
  };
  const doRefund = (e) => {
    e.preventDefault();
    action.run(async () => {
      await api.post(`/api/orders/${orderId}/refunds`, {
        amount: refund.amount ? Number(refund.amount) : undefined,
        reason: refund.reason,
        restock: refund.restock,
      });
      setRefund(null);
      await done("Refund recorded.");
    });
  };
  const directions = async () => {
    const shop = settings?.data?.shop;
    let origin = shop?.latitude ? { lat: shop.latitude, lng: shop.longitude } : undefined;
    if (currentUser.role === "delivery") origin = await currentPosition().catch(() => origin);
    window.open(directionsUrl(o.location, origin), "_blank", "noopener");
  };
  const print = (format) => openPdf(`/api/receipts/${o.receipt.id}/pdf?format=${format}`).catch((e) => action.setError(e.message));
  const resend = (channel) => action.run(async () => {
    const res = await api.post(`/api/receipts/${o.receipt.id}/${channel}`, {});
    await done(res.message);
  });

  return (
    <Modal title={o ? `Order ${o.orderNumber}` : "Order"} onClose={onClose}>
      <Alert kind="error">{error || action.error}</Alert>
      <Alert kind="success">{action.message}</Alert>
      {o && (
        <div className="st-form">
          {o.needsAttention && <Alert kind="warn">{o.needsAttention}</Alert>}
          {o.paymentUnderReview && (
            <Alert kind="info">
              🧾 The customer sent a Mobile Money screenshot for this order. {can("payments.verify") ? <a href="/admin/verify-payments">Check it in Verify payments</a> : "An admin must verify it."}
            </Alert>
          )}
          <div className="st-grid-2">
            <dl className="st-kv">
              <dt>Status</dt><dd><Badge status={o.status}>{STATUS_LABELS[o.status]}</Badge></dd>
              <dt>Channel</dt><dd>{o.channel === "pos" ? `In store (${o.cashier?.name})` : "Online"}</dd>
              <dt>Customer</dt><dd>{o.customer.name}<br /><a href={`tel:${o.customer.phone}`}>{o.customer.phone}</a>{o.customer.email && <><br />{o.customer.email}</>}</dd>
              <dt>Placed</dt><dd>{formatDate(o.createdAt)}</dd>
              <dt>Payment</dt><dd>{formatMoney(o.amountPaid)} / {formatMoney(o.grandTotal)} {o.paymentMethod && `- ${METHOD_LABELS[o.paymentMethod]}`}</dd>
              {o.amountRefunded > 0 && <><dt>Refunded</dt><dd>{formatMoney(o.amountRefunded)}</dd></>}
              <dt>Fulfilment</dt><dd>{o.fulfilment === "delivery" ? `Delivery - ${o.deliveryZone?.name ?? ""}` : o.fulfilment === "pickup" ? "Pickup" : "In store"}</dd>
              {o.deliveryAddress && <><dt>Address</dt><dd>{o.deliveryAddress}</dd></>}
              {o.deliveryPerson && <><dt>Rider</dt><dd>{o.deliveryPerson.name} {o.deliveryPerson.phone}</dd></>}
              {o.notes && <><dt>Notes</dt><dd>{o.notes}</dd></>}
              {o.receipt && (
                <>
                  <dt>Receipt sent</dt>
                  <dd>
                    {o.receipt.number}
                    <br />Email: {o.receipt.emailedAt ? `✔ ${formatDate(o.receipt.emailedAt)}` : o.customer.email ? "not sent yet" : "no email address"}
                    <br />WhatsApp: {o.receipt.whatsapp
                      ? <><Badge status={{ delivered: "succeeded", read: "succeeded", sent: "pending", failed: "failed", skipped: "expired" }[o.receipt.whatsapp.status]}>{o.receipt.whatsapp.status}</Badge>{o.receipt.whatsapp.error ? <span className="st-muted"> - {o.receipt.whatsapp.error}</span> : null}</>
                      : o.whatsappOptIn === false ? "customer opted out" : "not sent"}
                  </dd>
                </>
              )}
            </dl>
            {o.location ? (
              <div>
                <iframe title="Customer location" src={embedUrl(o.location)} style={{ width: "100%", height: 230, border: 0, borderRadius: 14 }} loading="lazy" referrerPolicy="no-referrer" />
                <button type="button" className="st-btn gold small" style={{ marginTop: 8 }} onClick={directions}>🧭 Get directions</button>
              </div>
            ) : o.fulfilment === "delivery" ? <p className="st-muted">The customer did not share a map location.</p> : null}
          </div>

          <div className="st-table-wrap">
            <table className="st-table">
              <thead><tr><th>Item</th><th>SKU</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Total</th></tr></thead>
              <tbody>{o.items.map((i) => <tr key={i.id}><td>{i.name}{i.option ? ` (${i.option})` : ""}{i.bookingAt ? <div className="st-muted">Booking: {formatDate(i.bookingAt)}</div> : null}</td><td>{i.sku}</td><td className="num">{i.quantity}</td><td className="num">{formatMoney(i.unitPrice)}</td><td className="num">{formatMoney(i.lineTotal)}</td></tr>)}</tbody>
            </table>
          </div>
          <dl className="st-kv">
            <dt>Subtotal</dt><dd>{formatMoney(o.subtotal)}</dd>
            {o.discountTotal > 0 && <><dt>Discount</dt><dd>- {formatMoney(o.discountTotal)}</dd></>}
            {o.taxTotal > 0 && <><dt>Tax</dt><dd>{formatMoney(o.taxTotal)}</dd></>}
            {o.deliveryFee > 0 && <><dt>Delivery</dt><dd>{formatMoney(o.deliveryFee)}</dd></>}
            <dt>Total</dt><dd><strong>{formatMoney(o.grandTotal)}</strong></dd>
          </dl>

          <div className="st-actions">
            {(NEXT[o.status] ?? [])
              .filter((s) => (o.fulfilment === "delivery" ? s !== "completed" : s !== "out_for_delivery"))
              .filter((s) => can("orders.manage_delivery") || (can("delivery.perform") && ["out_for_delivery", "delivered"].includes(s)))
              .map((s) => <button key={s} className="st-btn" disabled={action.busy} onClick={() => setStatus(s)}>Mark {STATUS_LABELS[s]}</button>)}
            {o.status === "pending" && !o.paymentUnderReview && can("payments.record_cash") && <button className="st-btn gold" disabled={action.busy} onClick={cash}>Record cash payment</button>}
            {o.status === "pending" && !o.paymentUnderReview && can("orders.manage_delivery") && <button className="st-btn danger" disabled={action.busy} onClick={cancel}>Cancel order</button>}
            {o.receipt && can("receipts.print") && (
              <>
                <button className="st-btn light" onClick={() => print("80mm")}>Print receipt (80mm)</button>
                <button className="st-btn light" onClick={() => print("a4")}>Print A4</button>
                {o.customer.email && <button className="st-btn light" disabled={action.busy} onClick={() => resend("email")}>Email receipt</button>}
                {o.customer.phone && <button className="st-btn light" disabled={action.busy} onClick={() => resend("whatsapp")}>WhatsApp receipt</button>}
              </>
            )}
            {can("refunds.manage") && o.amountPaid > o.amountRefunded && <button className="st-btn danger" onClick={() => setRefund({ amount: "", reason: "", restock: true })}>Refund</button>}
          </div>

          {o.fulfilment === "delivery" && can("orders.manage_delivery") && !["delivered", "cancelled", "refunded"].includes(o.status) && (
            <Field label="Delivery person">
              <select value={o.deliveryPerson?.id ?? ""} onChange={(e) => assign(e.target.value)}>
                <option value="">Not assigned</option>
                {(riders?.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.fullName} ({r.role}){r.phone ? ` - ${r.phone}` : ""}</option>)}
              </select>
            </Field>
          )}

          {refund && (
            <form className="st-card st-form" onSubmit={doRefund}>
              <h3>Refund (max {formatMoney(o.amountPaid - o.amountRefunded)})</h3>
              <div className="st-row">
                <Field label="Amount (empty = full refund)"><input type="number" min={1} max={o.amountPaid - o.amountRefunded} value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} /></Field>
                <Field label="Reason"><input required minLength={3} value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} /></Field>
              </div>
              <label className="st-check"><input type="checkbox" checked={refund.restock} onChange={(e) => setRefund({ ...refund, restock: e.target.checked })} /> Put items back in stock (full refunds only)</label>
              {o.payments.some((p) => !["cash", "manual"].includes(p.provider)) && <p className="st-muted">Online payments: if the provider cannot refund automatically, complete the refund in the provider dashboard. It is recorded here either way.</p>}
              <div className="st-actions"><button className="st-btn danger" disabled={action.busy}>Confirm refund</button><button type="button" className="st-btn light" onClick={() => setRefund(null)}>Cancel</button></div>
            </form>
          )}

          <div className="st-grid-2">
            <div>
              <h3>Status history</h3>
              <ul className="st-timeline">{o.history.map((h, i) => <li key={i}><strong>{STATUS_LABELS[h.to]}</strong> - {formatDate(h.at)}{h.by ? ` - ${h.by}` : ""}{h.note ? ` - ${h.note}` : ""}</li>)}</ul>
            </div>
            <div>
              <h3>Payments</h3>
              <ul className="st-timeline">{o.payments.map((p) => <li key={p.id}>{METHOD_LABELS[p.method]} {formatMoney(p.amount)} <Badge status={p.status} /> <span className="st-muted">{p.reference}</span>{p.failureReason ? <div className="st-muted">{p.failureReason}</div> : null}</li>)}</ul>
              {o.refunds.length > 0 && <><h3>Refunds</h3><ul className="st-timeline">{o.refunds.map((r) => <li key={r.id}>{formatMoney(r.amount)} - {r.reason} <Badge status={r.status === "completed" ? "succeeded" : "pending"}>{r.status}</Badge></li>)}</ul></>}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
