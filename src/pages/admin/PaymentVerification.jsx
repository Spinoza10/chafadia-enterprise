import { useState } from "react";
import ProofImage from "../../components/ProofImage";
import { Alert, Badge, Field, Modal, StaffLayout } from "../../components/staff/StaffLayout";
import { api, formatDate, formatMoney } from "../../lib/api";
import { useAction, useApi } from "../../lib/useApi";

const TABS = [
  ["pending_review", "Waiting for approval"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["all", "All"],
];
const REASONS = [
  "The amount on the screenshot is not the amount due",
  "The money has not arrived in the shop's account",
  "The transaction ID does not match the screenshot",
  "The screenshot is unreadable or cropped",
  "The payment was sent to another number",
];

/**
 * Admins check each online payment screenshot against the shop's MoMo / Orange Money account
 * before approving. Each admin's approval is counted once; the order is paid only when the
 * required number of different admins (Settings) have approved.
 */
export default function PaymentVerification() {
  const [status, setStatus] = useState("pending_review");
  const { data, error, reload } = useApi(`/api/payments/proofs?status=${status}`, { interval: 20_000 });
  const action = useAction();
  const [reject, setReject] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [zoom, setZoom] = useState(null);
  const rows = data?.data ?? [];

  const doApprove = (e) => {
    e.preventDefault();
    action.run(async () => {
      const res = await api.post(`/api/payments/proofs/${confirm.proof.id}/approve`, { confirmReceived: true, note: confirm.note || undefined });
      setConfirm(null);
      await reload();
      action.setMessage(res.message);
    });
  };
  const doReject = (e) => {
    e.preventDefault();
    action.run(async () => {
      const res = await api.post(`/api/payments/proofs/${reject.proof.id}/reject`, { reason: reject.reason });
      setReject(null);
      await reload();
      action.setMessage(res.message);
    });
  };

  return (
    <StaffLayout
      title="Verify payments"
      subtitle={`${data?.pending ?? 0} payment(s) waiting. Check every screenshot against the shop's MoMo / Orange Money account before approving.`}
      actions={<button className="st-btn light small" onClick={reload}>Refresh</button>}
    >
      <Alert kind="error">{error || action.error}</Alert>
      <Alert kind="success">{action.message}</Alert>
      <nav className="st-nav" aria-label="Filter">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" className={status === k ? "active" : ""} onClick={() => setStatus(k)}>
            {label}{k === "pending_review" && data?.pending ? ` (${data.pending})` : ""}
          </button>
        ))}
      </nav>

      {rows.length === 0 && <div className="st-card st-empty">{status === "pending_review" ? "No payment is waiting for approval. 🎉" : "Nothing here."}</div>}

      {rows.map((p) => (
        <section key={p.id} className="st-card" style={{ borderLeft: `5px solid ${p.status === "approved" ? "#16a34a" : p.status === "rejected" ? "#dc2626" : "#d4af37"}` }}>
          <div className="st-grid-2">
            <div>
              <ProofImage src={p.imageUrl} style={{ maxHeight: 420, width: "100%" }} onOpen={setZoom} />
            </div>
            <div>
              <h2 style={{ marginTop: 0 }}>
                {formatMoney(p.amountDue)} - {p.network}{" "}
                <Badge status={{ pending_review: "pending", approved: "succeeded", rejected: "failed" }[p.status]}>
                  {{ pending_review: `${p.approvalCount} of ${p.approvalsRequired} approvals`, approved: "Approved", rejected: "Rejected" }[p.status]}
                </Badge>
              </h2>
              {p.warnings?.length > 0 && (
                <Alert kind="warn">
                  <strong>Check carefully:</strong>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </Alert>
              )}
              <dl className="st-kv">
                <dt>Order</dt><dd>{p.order.number} ({p.order.fulfilment}) - {formatDate(p.order.createdAt)}</dd>
                <dt>Customer</dt><dd>{p.order.customer.name}<br /><a href={`tel:${p.order.customer.phone}`}>{p.order.customer.phone}</a>{p.order.customer.email ? <><br />{p.order.customer.email}</> : null}</dd>
                <dt>Amount due</dt><dd><strong>{formatMoney(p.amountDue)}</strong>{p.amountClaimed && p.amountClaimed !== p.amountDue ? <span style={{ color: "#b91c1c" }}> (customer says {formatMoney(p.amountClaimed)})</span> : null}</dd>
                <dt>Paid to</dt><dd>{p.paidTo}</dd>
                <dt>Sender</dt><dd>{p.senderName}<br />{p.senderPhone}</dd>
                <dt>Transaction ID</dt><dd><code>{p.transactionId}</code></dd>
                <dt>Sent</dt><dd>{formatDate(p.createdAt)}</dd>
                <dt>Approvals</dt>
                <dd>
                  {p.approvals.length === 0 ? "None yet" : p.approvals.map((a) => <div key={a.approverId}>✔ {a.name} ({a.role === "super_admin" ? "owner" : a.role}) - {formatDate(a.at)}{a.note ? ` - ${a.note}` : ""}</div>)}
                </dd>
                {p.status === "rejected" && <><dt>Rejected</dt><dd>{p.rejectionReason} - {p.reviewer} - {formatDate(p.reviewedAt)}</dd></>}
                {p.status === "approved" && <><dt>Finalized</dt><dd>{p.reviewer} - {formatDate(p.reviewedAt)}</dd></>}
              </dl>
              {p.status === "pending_review" && (
                <div className="st-actions">
                  {p.youApproved ? (
                    <span className="st-badge green">You approved - waiting for another admin</span>
                  ) : (
                    <button className="st-btn" disabled={action.busy} onClick={() => setConfirm({ proof: p, checked: false, note: "" })}>Approve</button>
                  )}
                  <button className="st-btn danger" disabled={action.busy} onClick={() => setReject({ proof: p, reason: "" })}>Reject</button>
                </div>
              )}
            </div>
          </div>
        </section>
      ))}

      {confirm && (
        <Modal title={`Approve ${formatMoney(confirm.proof.amountDue)}`} onClose={() => setConfirm(null)}>
          <form className="st-form" onSubmit={doApprove}>
            <p>Open the shop's <strong>{confirm.proof.network}</strong> account ({confirm.proof.paidTo}) and find transaction <code>{confirm.proof.transactionId}</code>.</p>
            <label className="st-check">
              <input type="checkbox" required checked={confirm.checked} onChange={(e) => setConfirm({ ...confirm, checked: e.target.checked })} />
              I confirm {formatMoney(confirm.proof.amountDue)} from {confirm.proof.senderName} ({confirm.proof.senderPhone}) is in the shop's account.
            </label>
            <Field label="Note (optional)"><input value={confirm.note} maxLength={300} onChange={(e) => setConfirm({ ...confirm, note: e.target.value })} /></Field>
            <p className="st-muted">
              {confirm.proof.approvalCount + 1 >= confirm.proof.approvalsRequired
                ? "This is the final approval: the order becomes paid and the receipt is sent to the customer."
                : `After your approval, ${confirm.proof.approvalsRequired - confirm.proof.approvalCount - 1} more admin must approve.`}
            </p>
            <div className="st-actions">
              <button className="st-btn" disabled={action.busy || !confirm.checked}>Approve payment</button>
              <button type="button" className="st-btn light" onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {reject && (
        <Modal title="Reject payment" onClose={() => setReject(null)}>
          <form className="st-form" onSubmit={doReject}>
            <p>The customer sees this reason and can upload a new screenshot. Their items stay reserved for 24 hours.</p>
            <div className="st-actions">
              {REASONS.map((r) => <button key={r} type="button" className="st-btn light small" onClick={() => setReject({ ...reject, reason: r })}>{r}</button>)}
            </div>
            <Field label="Reason shown to the customer"><textarea required minLength={5} maxLength={300} value={reject.reason} onChange={(e) => setReject({ ...reject, reason: e.target.value })} /></Field>
            <div className="st-actions">
              <button className="st-btn danger" disabled={action.busy}>Reject</button>
              <button type="button" className="st-btn light" onClick={() => setReject(null)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {zoom && (
        <Modal title="Screenshot" onClose={() => setZoom(null)}>
          <img src={zoom} alt="Payment screenshot, full size" style={{ width: "100%", borderRadius: 12 }} />
        </Modal>
      )}
    </StaffLayout>
  );
}
