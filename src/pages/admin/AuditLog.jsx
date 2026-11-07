import { useState } from "react";
import { Alert, StaffLayout } from "../../components/staff/StaffLayout";
import { formatDate, qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";

const short = (v) => (v === null || v === undefined ? "" : JSON.stringify(v));

/** Read-only, append-only log of sensitive actions (the database refuses edits and deletes). */
function AuditLog() {
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);
  const { data, error } = useApi(`/api/audit-logs${qs({ action, entityType, page, limit: 100 })}`);
  const rows = data?.data ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 100));

  return (
    <StaffLayout title="Audit log" subtitle="Who did what and when, with old and new values. Entries cannot be edited or deleted.">
      <Alert kind="error">{error}</Alert>
      <section className="st-card">
        <div className="st-toolbar">
          <select className="st-input" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <option value="">All actions</option>
            {["auth", "user", "product", "variant.price_change", "stock", "order", "payment", "refund", "receipt.reprint", "settings", "coupon", "shift", "pos.discount"].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="st-input" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
            <option value="">All records</option>
            {["user", "product", "variant", "order", "receipt", "setting", "coupon", "shift", "delivery_zone", "expense"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Old value</th><th>New value</th><th>IP</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatDate(r.createdAt)}</td>
                  <td>{r.actorName ?? "System"}<div className="st-muted">{r.actorRole}</div></td>
                  <td><code>{r.action}</code></td>
                  <td>{r.entityType} {r.entityId}</td>
                  <td style={{ maxWidth: 260, wordBreak: "break-word", fontSize: 12 }}>{short(r.oldValue)}</td>
                  <td style={{ maxWidth: 260, wordBreak: "break-word", fontSize: 12 }}>{short(r.newValue)}</td>
                  <td className="st-muted">{r.ip}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="st-empty">No entries.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="st-toolbar" style={{ marginTop: 10 }}>
          <button className="st-btn light small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
          <span className="st-muted">Page {page} of {pages}</span>
          <button className="st-btn light small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</button>
        </div>
      </section>
    </StaffLayout>
  );
}

export default AuditLog;
