import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import ProofImage from "../components/ProofImage";
import { Alert, Badge, Field } from "../components/staff/StaffLayout";
import "../components/staff/staff.css";
import { useAuth } from "../context/AuthContext";
import { api, formatDate, formatMoney } from "../lib/api";
import { localNumber, momoNumberError } from "../lib/momo";

const STEPS = ["Send the money", "Upload the screenshot", "Admins verify", "Approved"];

function copy(text, setCopied) {
  navigator.clipboard?.writeText(String(text)).then(() => {
    setCopied(String(text));
    setTimeout(() => setCopied(""), 1500);
  }).catch(() => {});
}

/**
 * Online payment by MTN MoMo / Orange Money transfer:
 * 1. the customer sends the exact amount to the shop's number (shown with the account name),
 * 2. uploads the screenshot of the confirmation with the transaction ID,
 * 3. admins verify it (two different admins by default) and the order becomes paid.
 * The page refreshes on its own so the customer sees each approval as it happens.
 */
export default function ManualPay() {
  const { orderNumber } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const { currentUser } = useAuth();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const order = await api.get(`/api/orders/track/${encodeURIComponent(orderNumber)}?token=${encodeURIComponent(token)}`);
      const res = await api.get(`/api/payments/manual/${order.data.id}?token=${encodeURIComponent(token)}`);
      setInfo(res.data);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [orderNumber, token]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  const latest = info?.proofs?.[0];
  const paid = info && !["pending", "cancelled"].includes(info.status);
  const step = paid ? 3 : latest?.status === "pending_review" ? 2 : 0;
  const track = info && `/track/${info.orderNumber}?token=${info.trackingToken}`;

  return (
    <>
      <Navbar />
      <div className="st-page">
        <div className="st-container" style={{ maxWidth: 860 }}>
          <header className="st-head">
            <div>
              <h1>Pay order {orderNumber}</h1>
              <p>{info ? <>Amount to pay: <strong>{formatMoney(info.amountDue)}</strong></> : "Loading..."}</p>
            </div>
            {track && <Link className="st-btn light" to={track}>Order details</Link>}
          </header>
          <Alert kind="error">{error}</Alert>

          {info && (
            <>
              <section className="st-card">
                <ol style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
                  {STEPS.map((label, i) => (
                    <li key={label} style={{ textAlign: "center" }}>
                      <div style={{ height: 8, borderRadius: 99, background: i <= step ? "linear-gradient(90deg,#004aad,#d4af37)" : "#e5e7eb" }} />
                      <small className={i === step ? "" : "st-muted"} style={{ fontWeight: i === step ? 700 : 400 }}>{label}</small>
                    </li>
                  ))}
                </ol>
              </section>

              {paid && (
                <section className="st-card" style={{ textAlign: "center", borderColor: "#16a34a" }}>
                  <div style={{ fontSize: 52 }} aria-hidden="true">✅</div>
                  <h2>Payment approved</h2>
                  <p>Your payment was checked and approved by our team{latest?.approvalCount ? ` (${latest.approvalCount} approval${latest.approvalCount > 1 ? "s" : ""})` : ""}. Your order is confirmed.</p>
                  <p className="st-muted">The receipt was sent by email and WhatsApp, and you can download it from your order page.</p>
                  <Link className="st-btn gold" to={track}>View my order and receipt</Link>
                </section>
              )}

              {!paid && info.status === "cancelled" && (
                <Alert kind="error">This order was cancelled. Please place a new order. If you already sent money, contact us with your transaction ID.</Alert>
              )}

              {!paid && latest?.status === "pending_review" && (
                <section className="st-card" style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 48 }} aria-hidden="true">⏳</div>
                  <h2>We are checking your payment</h2>
                  <p>
                    <strong>{latest.approvalCount} of {latest.approvalsRequired}</strong> admin approvals done.
                    {latest.approvalsRequired > 1 && " For your security, two different people at CHAFADIA verify every payment."}
                  </p>
                  <div style={{ maxWidth: 360, margin: "0 auto" }}>
                    <div style={{ height: 10, borderRadius: 99, background: "#e5e7eb", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${(latest.approvalCount / latest.approvalsRequired) * 100}%`, background: "#16a34a", transition: "width .4s" }} />
                    </div>
                  </div>
                  <p className="st-muted" style={{ marginTop: 10 }}>
                    Sent {formatDate(latest.createdAt)} - {latest.network}, transaction {latest.transactionId}. Your items stay reserved. This page updates by itself.
                  </p>
                </section>
              )}

              {!paid && latest?.status === "rejected" && (
                <Alert kind="error">
                  <strong>Your last screenshot was not accepted:</strong> {latest.rejectionReason}. Please check the details and upload the correct screenshot below.
                </Alert>
              )}

              {info.canSubmit && <PayForm info={info} token={token} currentUser={currentUser} onSent={load} />}

              {info.proofs.length > 0 && (
                <section className="st-card">
                  <h2>Screenshots sent</h2>
                  <div className="st-grid">
                    {info.proofs.map((p) => (
                      <div key={p.id} className="st-card" style={{ margin: 0 }}>
                        <ProofImage src={`${p.imageUrl}?token=${encodeURIComponent(token)}`} style={{ maxHeight: 220 }} />
                        <p style={{ margin: "8px 0 4px" }}>
                          <Badge status={{ pending_review: "pending", approved: "succeeded", rejected: "failed" }[p.status]}>
                            {{ pending_review: `Under review (${p.approvalCount}/${p.approvalsRequired})`, approved: "Approved", rejected: "Rejected" }[p.status]}
                          </Badge>
                        </p>
                        <small className="st-muted">{p.network} - {p.transactionId} - {formatDate(p.createdAt)}</small>
                        {p.rejectionReason && <p className="st-muted">Reason: {p.rejectionReason}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function PayForm({ info, token, currentUser, onSent }) {
  const methods = Object.keys(info.accounts);
  const [method, setMethod] = useState(methods.includes(info.paymentMethod) ? info.paymentMethod : methods[0]);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [form, setForm] = useState({
    transactionId: "",
    senderPhone: localNumber(currentUser?.phone) ?? "",
    senderName: currentUser?.name ?? "",
    amount: String(info.amountDue),
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const account = info.accounts[method];

  const pickFile = (f) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : "");
  };
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  if (!account) return <Alert kind="error">Mobile money payments are not set up yet. Please contact the shop.</Alert>;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!file) return setError("Attach the screenshot of your payment confirmation.");
    if (file.size > 5 * 1024 * 1024) return setError("The screenshot is too large (max 5 MB).");
    const numberError = momoNumberError(method, form.senderPhone);
    if (numberError) return setError(`Sender number: ${numberError}`);
    const fd = new FormData();
    fd.append("token", token);
    fd.append("method", method);
    fd.append("transactionId", form.transactionId.trim());
    fd.append("senderPhone", form.senderPhone);
    fd.append("senderName", form.senderName.trim());
    if (form.amount) fd.append("amountClaimed", form.amount);
    fd.append("screenshot", file);
    setBusy(true);
    try {
      await api.upload(`/api/payments/manual/${info.orderId}/proof`, fd);
      await onSent();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copyBtn = (value) => (
    <button type="button" className="st-btn light small" onClick={() => copy(value, setCopied)}>{copied === String(value) ? "Copied ✔" : "Copy"}</button>
  );

  return (
    <>
      <section className="st-card">
        <h2>1. Send the money</h2>
        {methods.length > 1 && (
          <div className="st-row" style={{ marginBottom: 10 }}>
            {methods.map((m) => (
              <label key={m} className="st-check st-card" style={{ margin: 0, cursor: "pointer", borderColor: method === m ? "var(--st-gold)" : undefined }}>
                <input type="radio" checked={method === m} onChange={() => setMethod(m)} /> {info.accounts[m].label}
              </label>
            ))}
          </div>
        )}
        <dl className="st-kv">
          <dt>Send to</dt>
          <dd><strong style={{ fontSize: 22, letterSpacing: 1 }}>{account.number}</strong> {copyBtn(account.number)}</dd>
          <dt>Account name</dt>
          <dd><strong>{account.name}</strong><br /><small className="st-muted">Check this name appears before you confirm.</small></dd>
          <dt>Exact amount</dt>
          <dd><strong style={{ fontSize: 20 }}>{formatMoney(info.amountDue)}</strong> {copyBtn(info.amountDue)}</dd>
          <dt>Reason / note</dt>
          <dd>{info.reference} {copyBtn(info.reference)}</dd>
        </dl>
        <ol className="st-muted" style={{ marginTop: 12 }}>
          <li>Dial <strong>{account.ussd}</strong> (or open the {account.label} app) and choose <em>transfer / send money</em>.</li>
          <li>Send <strong>{formatMoney(info.amountDue)}</strong> to <strong>{account.number}</strong> ({account.name}).</li>
          <li>Confirm with your PIN <strong>on your phone</strong>, then take a screenshot of the confirmation message.</li>
        </ol>
        <a className="st-btn gold" href={`tel:${encodeURIComponent(account.ussd)}`}>📞 Dial {account.ussd}</a>
        <p className="st-muted" style={{ fontSize: 12, marginTop: 8 }}>We never ask for your PIN. Our staff will never call you to ask for it.</p>
      </section>

      <form className="st-card st-form" onSubmit={submit}>
        <h2>2. Upload the screenshot</h2>
        <Field label="Screenshot of the payment confirmation (JPEG, PNG or WebP, max 5 MB)">
          <input type="file" accept="image/jpeg,image/png,image/webp" required onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        </Field>
        {preview && <img src={preview} alt="Selected screenshot" style={{ maxHeight: 260, maxWidth: "100%", borderRadius: 12, border: "1px solid #e5e7eb" }} />}
        <div className="st-row">
          <Field label="Transaction ID (from the confirmation SMS)">
            <input required minLength={4} maxLength={60} value={form.transactionId} onChange={set("transactionId")} placeholder="e.g. 1234567890" autoComplete="off" />
          </Field>
          <Field label="Amount you sent (FCFA)">
            <input type="number" min={1} value={form.amount} onChange={set("amount")} />
          </Field>
        </div>
        <div className="st-row">
          <Field label="Number you paid from">
            <input required value={form.senderPhone} onChange={set("senderPhone")} placeholder="6XX XXX XXX" inputMode="tel" autoComplete="tel" />
          </Field>
          <Field label="Name on that MoMo account">
            <input required minLength={2} value={form.senderName} onChange={set("senderName")} autoComplete="name" />
          </Field>
        </div>
        <Alert kind="error">{error}</Alert>
        <button className="st-btn gold block" disabled={busy} style={{ minHeight: 50 }}>{busy ? "Sending..." : "Send screenshot for verification"}</button>
        <p className="st-muted" style={{ fontSize: 12 }}>Your screenshot is private: only the shop's administrators can see it. Each transaction ID can be used only once.</p>
      </form>
    </>
  );
}
