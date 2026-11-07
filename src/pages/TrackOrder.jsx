import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { afterInitiate, momoNumberError } from "../lib/momo";
import Navbar from "../components/Navbar";
import { Alert, Badge } from "../components/staff/StaffLayout";
import "../components/staff/staff.css";
import { api, formatDate, formatMoney, METHOD_LABELS, openPdf, STATUS_LABELS } from "../lib/api";

const STEPS = { delivery: ["pending", "paid", "processing", "out_for_delivery", "delivered"], pickup: ["pending", "paid", "processing", "completed"] };

/** Public order tracking (order number + secret token from the confirmation/email link). */
export function TrackOrder() {
  const { orderNumber } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const location = useLocation();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const paymentError = location.state?.paymentError;
  const [payMode, setPayMode] = useState("manual");

  useEffect(() => {
    api.get("/api/settings/public").then((r) => setPayMode(r.data.onlinePaymentMode ?? "manual")).catch(() => {});
  }, []);

  useEffect(() => {
    let timer;
    const load = () =>
      api
        .get(`/api/orders/track/${encodeURIComponent(orderNumber)}?token=${encodeURIComponent(token)}`)
        .then((r) => {
          setOrder(r.data);
          setError("");
        })
        .catch((err) => setError(err.message));
    load();
    timer = setInterval(load, 30000); // live status
    return () => clearInterval(timer);
  }, [orderNumber, token]);

  const pay = async (method) => {
    setBusy(true);
    try {
      const network = method === "mtn_momo" ? "MTN MoMo" : "Orange Money";
      const phone = method === "card"
        ? undefined
        : window.prompt(`${network} number that will pay (you will confirm with your PIN on your phone):`, order.customer.phone || "");
      if (method !== "card" && !phone) return;
      if (method !== "card") {
        const numberError = momoNumberError(method, phone);
        if (numberError) return setError(numberError);
      }
      const res = await api.post("/api/payments/initiate", { orderId: order.id, token, method, phone });
      afterInitiate(navigate, res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!window.confirm("Cancel this unpaid order?")) return;
    try {
      const res = await api.post(`/api/orders/${order.id}/cancel`, { token });
      setOrder(res.data);
    } catch (err) {
      setError(err.message);
    }
  };

  const steps = order ? STEPS[order.fulfilment] ?? STEPS.pickup : [];
  const current = order ? steps.indexOf(order.status) : -1;

  return (
    <>
      <Navbar />
      <div className="st-page">
        <div className="st-container" style={{ maxWidth: 820 }}>
          <header className="st-head">
            <div>
              <h1>Order {orderNumber}</h1>
              <p>{order ? `Placed ${formatDate(order.createdAt)}` : "Order tracking"}</p>
            </div>
            {order && <Badge status={order.status}>{STATUS_LABELS[order.status]}</Badge>}
          </header>
          <Alert kind="error">{error}</Alert>
          {order && (
            <>
              {!["cancelled", "refunded"].includes(order.status) && (
                <section className="st-card">
                  <h2>Progress</h2>
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: 6 }}>
                    {steps.map((s, i) => (
                      <div key={s} style={{ textAlign: "center" }}>
                        <div style={{ height: 8, borderRadius: 99, background: i <= current ? "linear-gradient(90deg,#004aad,#d4af37)" : "#e5e7eb" }} />
                        <small className="st-muted">{STATUS_LABELS[s]}</small>
                      </div>
                    ))}
                  </div>
                  <p className="st-muted" style={{ marginTop: 10 }}>This page refreshes automatically.</p>
                </section>
              )}

              {order.status === "pending" && (
                <section className="st-card">
                  <h2>Payment</h2>
                  {paymentError && (
                    <Alert kind="error">Your order is saved and your items are reserved, but the payment request failed: {paymentError} Try again below.</Alert>
                  )}
                  {order.paymentMethod === "cash" ? (
                    <p>Pay <strong>{formatMoney(order.balance)}</strong> in cash at {order.fulfilment === "delivery" ? "delivery" : "pickup"}. Your items are reserved until {formatDate(order.reservationExpiresAt)}.</p>
                  ) : (
                    <p>Balance due: <strong>{formatMoney(order.balance)}</strong>. Items reserved until {formatDate(order.reservationExpiresAt)}.</p>
                  )}
                  {order.paymentUnderReview ? (
                    <>
                      <Alert kind="info">⏳ Your payment screenshot is being checked by our team. This page updates by itself.</Alert>
                      <div className="st-actions">
                        <Link className="st-btn gold" to={`/pay/${order.orderNumber}?token=${encodeURIComponent(token)}`}>Follow the verification</Link>
                      </div>
                    </>
                  ) : payMode === "manual" ? (
                    <div className="st-actions">
                      <Link className="st-btn gold" to={`/pay/${order.orderNumber}?token=${encodeURIComponent(token)}`}>
                        Pay by MoMo / Orange Money & upload screenshot
                      </Link>
                      <button className="st-btn danger" onClick={cancel}>Cancel order</button>
                    </div>
                  ) : (
                    <div className="st-actions">
                      <button className="st-btn" disabled={busy} onClick={() => pay("mtn_momo")}>Pay with MTN MoMo</button>
                      <button className="st-btn" disabled={busy} onClick={() => pay("orange_money")}>Pay with Orange Money</button>
                      <button className="st-btn light" disabled={busy} onClick={() => pay("card")}>Pay by card</button>
                      <button className="st-btn danger" onClick={cancel}>Cancel order</button>
                    </div>
                  )}
                </section>
              )}

              <section className="st-card">
                <h2>Items</h2>
                <div className="st-table-wrap">
                  <table className="st-table">
                    <thead><tr><th>Item</th><th>SKU</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Total</th></tr></thead>
                    <tbody>
                      {order.items.map((i) => (
                        <tr key={i.id}><td>{i.name}{i.option ? ` (${i.option})` : ""}</td><td>{i.sku}</td><td className="num">{i.quantity}</td><td className="num">{formatMoney(i.unitPrice)}</td><td className="num">{formatMoney(i.lineTotal)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <dl className="st-kv" style={{ marginTop: 12 }}>
                  <dt>Subtotal</dt><dd>{formatMoney(order.subtotal)}</dd>
                  {order.discountTotal > 0 && <><dt>Discount</dt><dd>- {formatMoney(order.discountTotal)}</dd></>}
                  {order.taxTotal > 0 && <><dt>Tax</dt><dd>{formatMoney(order.taxTotal)}</dd></>}
                  <dt>Delivery</dt><dd>{formatMoney(order.deliveryFee)}</dd>
                  <dt>Total</dt><dd><strong>{formatMoney(order.grandTotal)}</strong></dd>
                  <dt>Paid</dt><dd>{formatMoney(order.amountPaid)} {order.paymentMethod && `(${METHOD_LABELS[order.paymentMethod]})`}</dd>
                  {order.deliveryAddress && <><dt>Deliver to</dt><dd>{order.deliveryAddress}</dd></>}
                </dl>
                {order.receipt && (
                  <button className="st-btn gold" style={{ marginTop: 12 }} onClick={() => openPdf(`/api/receipts/${order.receipt.id}/pdf?token=${encodeURIComponent(token)}`).catch((e) => setError(e.message))}>
                    Download receipt {order.receipt.number}
                  </button>
                )}
              </section>

              <section className="st-card">
                <h2>History</h2>
                <ul className="st-timeline">
                  {order.history.map((h, i) => (
                    <li key={i}><strong>{STATUS_LABELS[h.to]}</strong> - {formatDate(h.at)}{h.note ? ` - ${h.note}` : ""}</li>
                  ))}
                </ul>
              </section>
            </>
          )}
          <Link to="/products" className="st-btn light">Continue shopping</Link>
        </div>
      </div>
    </>
  );
}

/** Public page opened by the QR code printed on every receipt. */
export function VerifyReceipt() {
  const { token } = useParams();
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get(`/api/receipts/verify/${encodeURIComponent(token)}`).then((r) => setResult(r.data)).catch((e) => setError(e.message));
  }, [token]);
  return (
    <>
      <Navbar />
      <div className="st-page">
        <div className="st-container" style={{ maxWidth: 560 }}>
          <section className="st-card" style={{ textAlign: "center" }}>
            <Alert kind="error">{error}</Alert>
            {result?.valid && (
              <>
                <h2>✅ Genuine receipt</h2>
                <dl className="st-kv" style={{ textAlign: "left", marginTop: 12 }}>
                  <dt>Receipt</dt><dd>{result.number}</dd>
                  <dt>Issued</dt><dd>{formatDate(result.issuedAt)}</dd>
                  <dt>Total</dt><dd>{formatMoney(result.grandTotal)}</dd>
                  <dt>Status</dt><dd>{result.refunded ? "Refunded" : STATUS_LABELS[result.orderStatus]}</dd>
                </dl>
              </>
            )}
            {result && !result.valid && <><h2>❌ Not recognised</h2><p className="st-muted">This receipt was not issued by CHAFADIA ENTERPRISE.</p></>}
          </section>
        </div>
      </div>
    </>
  );
}
