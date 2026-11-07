import { useState } from "react";
import { Alert, Badge, StaffLayout } from "../../components/staff/StaffLayout";
import { api, formatDate } from "../../lib/api";
import { useAction, useApi } from "../../lib/useApi";

/** Reviews appear on the shop only after approval. */
function CustomerReviews() {
  const [status, setStatus] = useState("pending");
  const { data, error, reload } = useApi(`/api/reviews${status ? `?status=${status}` : ""}`);
  const action = useAction();
  const reviews = data?.data ?? [];

  const moderate = (r, next) => action.run(async () => {
    await api.patch(`/api/reviews/${r.id}`, { status: next });
    await reload();
  });

  return (
    <StaffLayout title="Customer reviews" subtitle="Approve or reject reviews before they are published.">
      <Alert kind="error">{error || action.error}</Alert>
      <section className="st-card">
        <div className="st-toolbar">
          <select className="st-input" style={{ flex: "0 0 auto" }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Waiting for moderation</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option>
          </select>
        </div>
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>Date</th><th>Product</th><th>Customer</th><th>Rating</th><th>Comment</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.createdAt)}</td>
                  <td>{r.productName}</td>
                  <td>{r.customerName}</td>
                  <td aria-label={`${r.rating} stars`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</td>
                  <td style={{ maxWidth: 360 }}>{r.comment}</td>
                  <td><Badge status={r.status} /></td>
                  <td><div className="st-actions">
                    {r.status !== "approved" && <button className="st-btn small" onClick={() => moderate(r, "approved")}>Approve</button>}
                    {r.status !== "rejected" && <button className="st-btn danger small" onClick={() => moderate(r, "rejected")}>Reject</button>}
                  </div></td>
                </tr>
              ))}
              {!reviews.length && <tr><td colSpan={7} className="st-empty">No reviews here.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </StaffLayout>
  );
}

export default CustomerReviews;
