import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrderDetail } from "../../components/staff/OrderDetail";
import { Alert, Badge, Field, Modal, Stat, StaffLayout } from "../../components/staff/StaffLayout";
import { useAuth } from "../../context/AuthContext";
import { api, ApiError, formatDate, formatMoney, METHOD_LABELS, openPdf } from "../../lib/api";
import { imageUrl } from "../../lib/images";
import { useAction, useApi } from "../../lib/useApi";

const QUEUE_KEY = "chafadiaPosQueue";
const readQueue = () => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
  } catch {
    return [];
  }
};
const writeQueue = (q) => {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    // storage unavailable: queued sale stays in memory only
  }
};
const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function ShiftPanel({ shift, onChange }) {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const action = useAction();
  const [closed, setClosed] = useState(null);

  if (!shift) {
    return (
      <section className="st-card">
        <h2>Open your shift</h2>
        <p className="st-muted">Count the cash in the drawer before your first sale.</p>
        {closed && <Alert kind={closed.variance === 0 ? "success" : "warn"}>Last shift closed. Expected {formatMoney(closed.expectedCash)}, counted {formatMoney(closed.countedCash)}, difference {formatMoney(closed.variance)}.</Alert>}
        <Alert kind="error">{action.error}</Alert>
        <form className="st-row" style={{ alignItems: "end" }} onSubmit={(e) => { e.preventDefault(); action.run(async () => { await api.post("/api/pos/shifts/open", { openingFloat: Number(amount || 0) }); onChange(); }); }}>
          <Field label="Opening cash float (FCFA)"><input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <button className="st-btn gold" disabled={action.busy}>Open shift</button>
        </form>
      </section>
    );
  }
  const cash = shift.totals?.byMethod?.cash?.amount ?? 0;
  const expected = shift.openingFloat + cash - (shift.totals?.cashRefunds ?? 0);
  return (
    <section className="st-card">
      <h2>Shift since {formatDate(shift.openedAt)}</h2>
      <div className="st-grid">
        <Stat label="Opening float" value={formatMoney(shift.openingFloat)} />
        <Stat label="Sales this shift" value={formatMoney(shift.totals?.total ?? 0)} />
        <Stat label="Expected cash in drawer" value={formatMoney(expected)} />
      </div>
      <div className="st-grid" style={{ marginTop: 10 }}>
        {Object.entries(shift.totals?.byMethod ?? {}).map(([m, v]) => <Stat key={m} label={METHOD_LABELS[m]} value={formatMoney(v.amount)} hint={`${v.orders} sale(s)`} />)}
      </div>
      <Alert kind="error">{action.error}</Alert>
      <form className="st-row" style={{ alignItems: "end", marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (!window.confirm("Close your shift now?")) return; action.run(async () => { const r = await api.post("/api/pos/shifts/close", { countedCash: Number(amount || 0), notes: notes || undefined }); setClosed(r.data); setAmount(""); onChange(); }); }}>
        <Field label="Cash counted in drawer"><input type="number" min={0} required value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <button className="st-btn danger" disabled={action.busy}>Close shift</button>
      </form>
    </section>
  );
}

function CashierDashboard() {
  const { can, currentUser } = useAuth();
  const { data: shiftData, reload: reloadShift } = useApi("/api/pos/shifts/current");
  const { data: productData, reload: reloadProducts } = useApi("/api/admin/products?status=active&limit=500");
  const { data: summary, reload: reloadSummary } = useApi("/api/pos/summary");
  const { data: recent, reload: reloadRecent } = useApi(`/api/orders?channel=pos&limit=15`);
  const shift = shiftData?.data;

  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [lines, setLines] = useState([]);
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "" });
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState("cash");
  const [tendered, setTendered] = useState("");
  const [reference, setReference] = useState("");
  const [result, setResult] = useState(null);
  const [queue, setQueue] = useState(readQueue);
  const [openOrder, setOpenOrder] = useState(null);
  const action = useAction();
  const { setError: setActionError } = action;
  const scanRef = useRef(null);

  const products = useMemo(
    () =>
      (productData?.data ?? []).flatMap((p) =>
        p.variants.filter((v) => v.isActive !== false).map((v) => ({ variantId: v.id, sku: v.sku, barcode: v.barcode, name: v.name === "Standard" ? p.name : `${p.name} - ${v.name}`, price: v.price, available: v.trackStock ? v.available : null, image: p.images[0], options: p.options ?? [] }))
      ),
    [productData]
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (q ? products.filter((p) => `${p.name} ${p.sku} ${p.barcode ?? ""}`.toLowerCase().includes(q)) : products).slice(0, 40);
  }, [products, search]);

  const add = (p) => {
    setLines((prev) => {
      const key = `${p.variantId}|`;
      const existing = prev.find((l) => l.key === key);
      if (existing) return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { ...p, key, quantity: 1, option: "" }];
    });
  };
  const scan = async (e) => {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    const local = products.find((p) => p.barcode === c || p.sku.toUpperCase() === c.toUpperCase());
    if (local) add(local);
    else action.setError(`No product with code ${c}`);
    setCode("");
    scanRef.current?.focus();
  };

  const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const disc = can("pos.discount") ? Math.min(Number(discount || 0), subtotal) : 0;
  const total = subtotal - disc; // tax (if configured) is added by the server
  const change = method === "cash" && tendered ? Number(tendered) - total : 0;

  const finish = (sale) => {
    setResult(sale);
    setLines([]);
    setDiscount("");
    setTendered("");
    setReference("");
    setCustomer({ name: "", phone: "", email: "" });
    reloadShift();
    reloadSummary();
    reloadRecent();
    reloadProducts();
    if (sale.receipt) openPdf(`/api/receipts/${sale.receipt.id}/pdf?format=80mm`).catch(() => {});
  };

  const syncQueue = useCallback(async () => {
    let q = readQueue();
    for (const sale of [...q]) {
      try {
        await api.post("/api/pos/sales", sale);
        q = q.filter((s) => s.clientReference !== sale.clientReference);
      } catch (err) {
        if (!(err instanceof ApiError)) break; // still offline
        q = q.filter((s) => s.clientReference !== sale.clientReference);
        setActionError(`A queued sale was rejected: ${err.message}`);
      }
    }
    writeQueue(q);
    setQueue(q);
    reloadRecent();
    reloadShift();
  }, [setActionError, reloadRecent, reloadShift]);

  useEffect(() => {
    window.addEventListener("online", syncQueue);
    const t = setInterval(() => readQueue().length && syncQueue(), 30000);
    return () => {
      window.removeEventListener("online", syncQueue);
      clearInterval(t);
    };
  }, [syncQueue]);

  const complete = async () => {
    action.setError("");
    if (!lines.length) return action.setError("Add at least one item.");
    if (method !== "cash" && !reference.trim()) return action.setError("Enter the transaction reference shown on the customer's phone or card terminal.");
    if (method === "cash" && tendered && Number(tendered) < total) return action.setError("Cash received is less than the total.");
    const body = {
      clientReference: newRef(),
      items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, ...(l.option && { option: l.option }) })),
      customer: { name: customer.name || undefined, phone: customer.phone || undefined, email: customer.email || undefined },
      discount: disc,
      payment: { method, ...(method === "cash" && tendered && { amountTendered: Number(tendered) }), ...(reference && { reference: reference.trim() }) },
    };
    action.run(async () => {
      try {
        const res = await api.post("/api/pos/sales", body);
        finish(res.data);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        // network down: keep the sale and sync it later (the clientReference prevents duplicates)
        const q = [...readQueue(), body];
        writeQueue(q);
        setQueue(q);
        setLines([]);
        action.setMessage("No connection. Sale saved and will sync automatically; print the receipt from Recent sales once synced.");
      }
    });
  };

  return (
    <StaffLayout title="Point of sale" subtitle={`Cashier: ${currentUser?.name}`}>
      {queue.length > 0 && <Alert kind="warn">{queue.length} sale(s) waiting to sync. <button className="st-btn small" onClick={syncQueue}>Sync now</button></Alert>}
      <Alert kind="error">{action.error}</Alert>
      <Alert kind="success">{action.message}</Alert>

      {summary?.data && (
        <div className="st-grid" style={{ marginBottom: 16 }}>
          <Stat label="My sales today" value={formatMoney(summary.data.total)} hint={`${summary.data.orders} sale(s), ${summary.data.unitsSold} item(s)`} />
          {summary.data.byMethod.map((m) => <Stat key={m.method} label={METHOD_LABELS[m.method]} value={formatMoney(m.amount)} />)}
        </div>
      )}

      {!shift ? (
        <ShiftPanel shift={null} onChange={reloadShift} />
      ) : (
        <>
          <div className="st-grid-2">
            <section className="st-card">
              <form onSubmit={scan} className="st-toolbar">
                <input ref={scanRef} autoFocus className="st-input" placeholder="Scan barcode or type SKU, then Enter" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Barcode" />
                <button className="st-btn small">Add</button>
              </form>
              <input className="st-input" style={{ width: "100%", marginBottom: 10 }} placeholder="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="st-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", maxHeight: 520, overflowY: "auto" }}>
                {shown.map((p) => (
                  <button key={p.variantId} type="button" className="st-card" style={{ margin: 0, padding: 10, textAlign: "left", cursor: p.available === 0 ? "not-allowed" : "pointer", opacity: p.available === 0 ? 0.5 : 1 }} disabled={p.available === 0} onClick={() => add(p)}>
                    {p.image && <img src={imageUrl(p.image)} alt="" style={{ width: "100%", height: 80, objectFit: "cover", borderRadius: 10 }} loading="lazy" />}
                    <div style={{ fontWeight: 900, fontSize: 13 }}>{p.name}</div>
                    <div className="st-muted" style={{ fontSize: 12 }}>{formatMoney(p.price)}{p.available !== null && ` - ${p.available} left`}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="st-card">
              <h2>Current sale</h2>
              {!lines.length && <div className="st-empty">Scan or tap products to add them.</div>}
              {lines.length > 0 && (
                <div className="st-table-wrap">
                  <table className="st-table">
                    <tbody>
                      {lines.map((l) => (
                        <tr key={l.key}>
                          <td>{l.name}<div className="st-muted">{l.sku}</div>
                            {l.options.length > 0 && (
                              <select className="st-input" style={{ minHeight: 30, marginTop: 4 }} value={l.option} onChange={(e) => setLines(lines.map((x) => (x.key === l.key ? { ...x, option: e.target.value } : x)))}>
                                <option value="">Option...</option>{l.options.map((o) => <option key={o}>{o}</option>)}
                              </select>
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button className="st-btn light small" onClick={() => setLines(lines.map((x) => (x.key === l.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))} aria-label="Less">−</button>
                            <strong style={{ margin: "0 8px" }}>{l.quantity}</strong>
                            <button className="st-btn light small" onClick={() => setLines(lines.map((x) => (x.key === l.key ? { ...x, quantity: x.quantity + 1 } : x)))} aria-label="More">+</button>
                          </td>
                          <td className="num">{formatMoney(l.price * l.quantity)}</td>
                          <td><button className="st-btn danger small" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label="Remove">✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="st-form" style={{ marginTop: 12 }}>
                <div className="st-row">
                  <Field label="Customer name (optional)"><input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} /></Field>
                  <Field label="Phone"><input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} inputMode="tel" /></Field>
                  <Field label="Email (sends receipt)"><input type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} /></Field>
                </div>
                {can("pos.discount") && <Field label="Discount (FCFA)"><input type="number" min={0} max={subtotal} value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>}
                <div className="st-actions">
                  {Object.entries(METHOD_LABELS).map(([m, label]) => <button key={m} type="button" className={`st-btn ${method === m ? "gold" : "light"}`} onClick={() => setMethod(m)}>{label}</button>)}
                </div>
                {method === "cash" ? (
                  <Field label="Cash received"><input type="number" min={0} value={tendered} onChange={(e) => setTendered(e.target.value)} /></Field>
                ) : (
                  <Field label="Transaction reference"><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="MoMo/Orange/terminal transaction ID" /></Field>
                )}
                <dl className="st-kv">
                  <dt>Subtotal</dt><dd>{formatMoney(subtotal)}</dd>
                  {disc > 0 && <><dt>Discount</dt><dd>- {formatMoney(disc)}</dd></>}
                  <dt>Total</dt><dd><strong style={{ fontSize: 22 }}>{formatMoney(total)}</strong></dd>
                  {method === "cash" && tendered && <><dt>Change</dt><dd><strong>{formatMoney(Math.max(0, change))}</strong></dd></>}
                </dl>
                <button className="st-btn gold block" style={{ minHeight: 54, fontSize: 16 }} disabled={action.busy || !lines.length} onClick={complete}>
                  {action.busy ? "Processing..." : `Complete sale - ${formatMoney(total)}`}
                </button>
              </div>
            </section>
          </div>
          <ShiftPanel shift={shift} onChange={reloadShift} />
        </>
      )}

      <section className="st-card">
        <h2>My recent sales</h2>
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>Receipt</th><th>Time</th><th>Customer</th><th>Method</th><th className="num">Total</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {(recent?.data ?? []).map((o) => (
                <tr key={o.id}>
                  <td>{o.receipt?.number ?? o.orderNumber}</td>
                  <td>{formatDate(o.createdAt)}</td>
                  <td>{o.customer.name}</td>
                  <td>{METHOD_LABELS[o.paymentMethod]}</td>
                  <td className="num">{formatMoney(o.grandTotal)}</td>
                  <td><Badge status={o.status} /></td>
                  <td><div className="st-actions">
                    {o.receipt && <button className="st-btn light small" onClick={() => openPdf(`/api/receipts/${o.receipt.id}/pdf?format=80mm`).catch((e) => action.setError(e.message))}>Reprint</button>}
                    <button className="st-btn light small" onClick={() => setOpenOrder(o.id)}>Details</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {result && (
        <Modal title="Sale completed" onClose={() => { setResult(null); scanRef.current?.focus(); }}>
          <dl className="st-kv">
            <dt>Receipt</dt><dd>{result.receipt?.number}</dd>
            <dt>Total</dt><dd>{formatMoney(result.grandTotal)}</dd>
            <dt>Payment</dt><dd>{METHOD_LABELS[result.paymentMethod]}</dd>
            {result.change > 0 && <><dt>Change to give</dt><dd><strong style={{ fontSize: 22 }}>{formatMoney(result.change)}</strong></dd></>}
          </dl>
          <div className="st-actions" style={{ marginTop: 14 }}>
            <button className="st-btn" onClick={() => openPdf(`/api/receipts/${result.receipt.id}/pdf?format=80mm`)}>Print 80mm</button>
            <button className="st-btn light" onClick={() => openPdf(`/api/receipts/${result.receipt.id}/pdf?format=a4`)}>Print A4</button>
            <button className="st-btn gold" onClick={() => { setResult(null); scanRef.current?.focus(); }}>New sale</button>
          </div>
        </Modal>
      )}
      {openOrder && <OrderDetail orderId={openOrder} onClose={() => setOpenOrder(null)} />}
    </StaffLayout>
  );
}

export default CashierDashboard;
