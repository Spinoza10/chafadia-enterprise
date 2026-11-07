import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { Alert, Field } from "../components/staff/StaffLayout";
import "../components/staff/staff.css";
import { afterInitiate, momoNumberError } from "../lib/momo";
import { api } from "../lib/api";

function Shell({ children }) {
  return (
    <>
      <Navbar />
      <div className="st-page">
        <div className="st-container" style={{ maxWidth: 640 }}>{children}</div>
      </div>
    </>
  );
}

const NETWORK = { mtn_momo: "MTN Mobile Money", orange_money: "Orange Money" };
const MAX_CHECKS = 60; // 3 minutes at one check every 3 s

/**
 * Where the customer waits while paying. For MTN MoMo / Orange Money the request is pushed to
 * their phone and they confirm it with their PIN on the phone. The page never trusts the URL: it
 * asks the server, which re-verifies with the payment provider, until the payment succeeds or fails.
 */
export function PaymentReturn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const reference = params.get("reference") || params.get("trxref") || "";
  const [state, setState] = useState({ status: "pending" });
  const [attempts, setAttempts] = useState(0);
  const [kick, setKick] = useState(0); // restart polling after the simulated phone answers

  useEffect(() => {
    if (!reference) return undefined;
    let stopped = false;
    let timer;
    let after = 0;
    const poll = async (n) => {
      try {
        const res = await api.get(`/api/payments/${encodeURIComponent(reference)}/status`);
        if (stopped) return;
        setState(res.data);
        setAttempts(n);
        if (res.data.status === "pending" && n < MAX_CHECKS) timer = setTimeout(() => poll(n + 1), 3000);
        // the receipt is sent in the background just after payment: refresh a few times to show where it went
        else if (res.data.status === "succeeded" && after++ < 4 && !res.data.receiptSent?.whatsapp) timer = setTimeout(() => poll(n), 1500);
      } catch (err) {
        if (!stopped) setState({ status: "error", message: err.message });
      }
    };
    poll(1);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [reference, kick]);

  const track = state.orderNumber && `/track/${state.orderNumber}?token=${state.trackingToken}`;
  const network = NETWORK[state.method];
  return (
    <Shell>
      <section className="st-card" style={{ textAlign: "center" }}>
        {!reference && <Alert kind="error">Missing payment reference.</Alert>}

        {state.status === "pending" && reference && state.mode === "push" && (
          <>
            <div style={{ fontSize: 48 }} aria-hidden="true">📲</div>
            <h2>Check your phone</h2>
            <p>{state.instructions}</p>
            <p className="st-muted">This page updates by itself as soon as you confirm{attempts > 1 ? ` (check ${attempts})` : ""}.</p>
            <details style={{ textAlign: "left", margin: "10px auto", maxWidth: 460 }}>
              <summary>No prompt on your phone?</summary>
              <ul className="st-muted">
                <li>Make sure the phone is on, has network, and the {network} account has enough balance.</li>
                <li>The prompt expires after about a minute. If it does, this page lets you send a new one.</li>
                <li>You can also open your {network} menu and look for pending approvals.</li>
              </ul>
            </details>
            {attempts >= MAX_CHECKS && <Alert kind="warn">Still waiting. If you confirmed on your phone, it will appear on your order shortly.</Alert>}
            {state.simulated && <SimulatedPhone reference={reference} amount={state.amount} network={network} onDone={() => setKick((k) => k + 1)} />}
          </>
        )}

        {state.status === "pending" && reference && state.mode !== "push" && (
          <>
            <h2>Waiting for payment confirmation...</h2>
            <p className="st-muted">This page updates automatically{attempts > 1 ? ` (check ${attempts})` : ""}.</p>
          </>
        )}

        {state.status === "succeeded" && (
          <>
            <h2>✅ Payment confirmed</h2>
            <p>{state.amount ? `${Number(state.amount).toLocaleString("fr-FR")} FCFA` : "The amount"} was paid{state.phone ? ` from ${state.phone}` : ""}. Thank you!</p>
            <p className="st-muted">
              Your receipt:{" "}
              {state.receiptSent?.email ? "✔ sent by email" : "email not sent (no email address)"}
              {" · "}
              {state.receiptSent?.whatsapp ? "✔ sent on WhatsApp" : "not sent on WhatsApp"}
              {" · always available on your order page."}
            </p>
          </>
        )}

        {["failed", "cancelled", "expired"].includes(state.status) && (
          <>
            <h2>Payment {state.status === "failed" ? "not completed" : state.status}</h2>
            <p className="st-muted">No money was taken for this attempt (declined, wrong PIN, not enough balance or the prompt expired).</p>
            {state.canRetry && state.mode === "push" && <RetryMobileMoney state={state} navigate={navigate} />}
          </>
        )}

        {state.status === "error" && <Alert kind="error">{state.message}</Alert>}
        {track && <Link className="st-btn gold" to={track} style={{ marginTop: 10 }}>View my order</Link>}
      </section>
    </Shell>
  );
}

/** Send a new prompt, to the same or another number / network. */
function RetryMobileMoney({ state, navigate }) {
  const [method, setMethod] = useState(state.method);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const retry = async (e) => {
    e.preventDefault();
    const numberError = momoNumberError(method, phone);
    if (numberError) return setError(numberError);
    setBusy(true);
    setError("");
    try {
      const res = await api.post("/api/payments/initiate", { orderId: state.orderId, token: state.trackingToken, method, phone });
      afterInitiate(navigate, res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="st-form" onSubmit={retry} style={{ maxWidth: 420, margin: "12px auto", textAlign: "left" }}>
      <h3>Try again</h3>
      <div className="st-row">
        <label className="st-check"><input type="radio" checked={method === "mtn_momo"} onChange={() => setMethod("mtn_momo")} /> MTN MoMo</label>
        <label className="st-check"><input type="radio" checked={method === "orange_money"} onChange={() => setMethod("orange_money")} /> Orange Money</label>
      </div>
      <Field label="Number that will pay">
        <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={state.phone || "6XX XXX XXX"} inputMode="tel" autoComplete="tel" />
      </Field>
      <Alert kind="error">{error}</Alert>
      <button className="st-btn gold block" disabled={busy}>{busy ? "Sending..." : "Send a new payment request"}</button>
    </form>
  );
}

/**
 * TEST MODE ONLY (PAYMENT_PROVIDER=mock): stands in for the customer's phone so the whole flow
 * can be tried without real money. With a real provider this box never appears: the operator's
 * prompt shows on the customer's own phone. The PIN typed here never leaves this component.
 */
function SimulatedPhone({ reference, amount, network, onDone }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const answer = async (outcome) => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/payments/mock/${encodeURIComponent(reference)}/complete`, { outcome });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ margin: "18px auto 6px", maxWidth: 300, border: "10px solid #111827", borderRadius: 30, padding: "18px 14px", background: "#f9fafb", textAlign: "left" }}>
      <span className="st-badge amber">TEST MODE - simulated phone</span>
      <p style={{ margin: "12px 0 6px", fontFamily: "monospace", fontSize: 13 }}>
        {network}: Pay {Number(amount || 0).toLocaleString("fr-FR")} FCFA to CHAFADIA ENTERPRISE?<br />Enter your PIN to confirm.
      </p>
      <input
        type="password"
        inputMode="numeric"
        maxLength={5}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
        placeholder="PIN"
        aria-label="Simulated PIN (not sent anywhere)"
        style={{ width: "100%", fontSize: 20, letterSpacing: 6, textAlign: "center", padding: 8 }}
      />
      <Alert kind="error">{error}</Alert>
      <div className="st-actions" style={{ marginTop: 10 }}>
        <button type="button" className="st-btn" disabled={busy || pin.length < 4} onClick={() => answer("success")}>Confirm</button>
        <button type="button" className="st-btn danger" disabled={busy} onClick={() => answer("failure")}>Cancel</button>
      </div>
      <small className="st-muted">Any 4-5 digits work here. The PIN is not sent to the server.</small>
    </div>
  );
}

/** Development-only simulated gateway (PAYMENT_PROVIDER=mock). It triggers a real signed webhook. */
export function PaymentMock() {
  const [params] = useSearchParams();
  const reference = params.get("reference") || "";
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const complete = async (outcome) => {
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/payments/mock/${encodeURIComponent(reference)}/complete`, { outcome });
      navigate(`/payment/return?reference=${encodeURIComponent(reference)}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <section className="st-card" style={{ textAlign: "center" }}>
        <span className="st-badge amber">TEST MODE - no real money</span>
        <h2 style={{ marginTop: 12 }}>Simulated payment gateway</h2>
        <p className="st-muted">Reference: <code>{reference}</code></p>
        <p className="st-muted">In production this page is replaced by the real MTN MoMo / Orange Money / card page of the payment provider.</p>
        <Alert kind="error">{error}</Alert>
        <div className="st-actions" style={{ justifyContent: "center" }}>
          <button className="st-btn" disabled={busy} onClick={() => complete("success")}>Approve payment</button>
          <button className="st-btn danger" disabled={busy} onClick={() => complete("failure")}>Decline payment</button>
        </div>
      </section>
    </Shell>
  );
}
