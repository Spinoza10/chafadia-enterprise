import { useState } from "react";
import { Alert, Badge, Field, Modal, Stat, StaffLayout } from "../../components/staff/StaffLayout";
import { useAuth } from "../../context/AuthContext";
import { api, downloadFile, formatDate, formatMoney, qs, STATUS_LABELS } from "../../lib/api";
import { useAction, useApi } from "../../lib/useApi";

const WA = {
  on_whatsapp: { label: "On WhatsApp", tone: "succeeded" },
  not_on_whatsapp: { label: "Not on WhatsApp", tone: "failed" },
  unknown: { label: "Not checked yet", tone: "expired" },
};

function WaBadge({ status }) {
  const w = WA[status] ?? WA.unknown;
  return <Badge status={w.tone}>{w.label}</Badge>;
}

/**
 * Every registered customer in one place: contact details, WhatsApp status, what they bought,
 * notes and tags; message one customer or many on WhatsApp straight from the system.
 */
export default function CustomerDirectory() {
  const { can } = useAuth();
  const canMessage = can("customers.message");
  const [filters, setFilters] = useState({ search: "", whatsapp: "", tag: "", sort: "newest", page: 1 });
  const { data, error, reload } = useApi(`/api/customers${qs(filters)}`, { interval: 30_000 });
  const { data: stats, reload: reloadStats } = useApi("/api/customers/stats");
  const [openId, setOpenId] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [broadcast, setBroadcast] = useState(null);
  const action = useAction();
  const rows = data?.data ?? [];
  const st = stats?.data;
  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value, page: 1 }));
  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const exportCsv = () => action.run(() => downloadFile(`/api/customers/export.csv${qs({ ...filters, page: undefined })}`, `chafadia-customers-${new Date().toISOString().slice(0, 10)}.csv`));

  return (
    <StaffLayout
      title="Customers"
      subtitle="Everyone who registered, how to reach them, and what they bought."
      actions={
        <>
          {canMessage && <button className="st-btn gold small" onClick={() => setBroadcast({ text: "", target: selected.size ? "selected" : "all", tag: "" })}>💬 WhatsApp message to many</button>}
          <button className="st-btn light small" onClick={exportCsv}>Export CSV</button>
        </>
      }
    >
      <Alert kind="error">{error || action.error}</Alert>
      <Alert kind="success">{action.message}</Alert>
      {st && !st.whatsappEnabled && <Alert kind="warn">WhatsApp sending is turned off on the server (WHATSAPP_PROVIDER=off). You can still use the "Chat" links.</Alert>}

      {st && (
        <div className="st-grid">
          <Stat label="Registered customers" value={st.total} hint={`${st.newLast7Days} new this week`} />
          <Stat label="On WhatsApp" value={st.onWhatsApp} hint={`${st.unknown} not checked yet`} />
          <Stat label="Accept WhatsApp messages" value={st.optedIn} />
          <Stat label="Have bought" value={st.buyers} />
        </div>
      )}

      <section className="st-card">
        <div className="st-row" style={{ alignItems: "end" }}>
          <Field label="Search name, phone or email"><input value={filters.search} onChange={setF("search")} placeholder="e.g. 652 or Awa" /></Field>
          <Field label="WhatsApp">
            <select value={filters.whatsapp} onChange={setF("whatsapp")}>
              <option value="">All</option><option value="on_whatsapp">On WhatsApp</option><option value="not_on_whatsapp">Not on WhatsApp</option><option value="unknown">Not checked</option>
            </select>
          </Field>
          <Field label="Tag">
            <select value={filters.tag} onChange={setF("tag")}>
              <option value="">All</option>
              {(st?.tags ?? []).map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}
            </select>
          </Field>
          <Field label="Sort">
            <select value={filters.sort} onChange={setF("sort")}>
              <option value="newest">Newest</option><option value="name">Name</option><option value="spent">Top spenders</option><option value="orders">Most orders</option><option value="last_order">Last order</option>
            </select>
          </Field>
        </div>

        <div className="st-table-wrap">
          <table className="st-table">
            <thead>
              <tr>
                {canMessage && <th aria-label="Select" />}
                <th>Customer</th><th>Phone / WhatsApp</th><th className="num">Orders</th><th className="num">Spent</th><th>Registered</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  {canMessage && <td><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.fullName}`} /></td>}
                  <td>
                    <strong>{c.fullName}</strong>{c.status === "suspended" && <> <Badge status="suspended" /></>}
                    {c.email && <div className="st-muted">{c.email}</div>}
                    {c.tags.length > 0 && <div>{c.tags.map((t) => <span key={t} className="st-badge" style={{ marginRight: 4 }}>{t}</span>)}</div>}
                  </td>
                  <td>
                    {c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : <span className="st-muted">no phone</span>}
                    {c.phone && <div><WaBadge status={c.whatsapp.status} />{!c.whatsapp.optIn && <span className="st-muted"> - no WhatsApp messages</span>}</div>}
                  </td>
                  <td className="num">{c.orders}</td>
                  <td className="num">{formatMoney(c.totalSpent)}</td>
                  <td>{formatDate(c.createdAt)}<div className="st-muted">{c.source === "checkout" ? "at checkout" : "sign-up"}</div></td>
                  <td>
                    <div className="st-actions" style={{ flexWrap: "nowrap" }}>
                      <button className="st-btn light small" onClick={() => setOpenId(c.id)}>Open</button>
                      {c.whatsapp.chatLink && c.whatsapp.status !== "not_on_whatsapp" && (
                        <a className="st-btn small" href={c.whatsapp.chatLink} target="_blank" rel="noopener noreferrer" title="Open a chat in WhatsApp">Chat</a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="st-empty">No customer matches.</td></tr>}
            </tbody>
          </table>
        </div>
        {data && data.total > data.limit && (
          <div className="st-actions" style={{ justifyContent: "center" }}>
            <button className="st-btn light small" disabled={filters.page <= 1} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>Previous</button>
            <span className="st-muted">Page {filters.page} of {Math.ceil(data.total / data.limit)} ({data.total} customers)</span>
            <button className="st-btn light small" disabled={filters.page * data.limit >= data.total} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Next</button>
          </div>
        )}
      </section>

      {openId && <CustomerModal id={openId} canMessage={canMessage} onClose={() => setOpenId(null)} onChanged={() => { reload(); reloadStats(); }} />}
      {broadcast && (
        <BroadcastModal
          state={broadcast}
          setState={setBroadcast}
          selected={selected}
          tags={st?.tags ?? []}
          onSent={(msg) => { setBroadcast(null); setSelected(new Set()); action.setMessage(msg); }}
        />
      )}
    </StaffLayout>
  );
}

function BroadcastModal({ state, setState, selected, tags, onSent }) {
  const action = useAction();
  const target = state.target === "selected" ? { ids: [...selected] } : state.target === "tag" ? { tag: state.tag } : {};
  const previewQs = qs({ tag: target.tag, ids: target.ids?.join(",") });
  const { data: preview } = useApi(state.target === "tag" && !state.tag ? null : `/api/customers/broadcast/preview${previewQs}`);
  const count = preview?.data?.recipients;

  const send = (e) => {
    e.preventDefault();
    if (!window.confirm(`Send this WhatsApp message to ${count} customer(s)?`)) return;
    action.run(async () => {
      const res = await api.post("/api/customers/broadcast", { text: state.text, ...target });
      onSent(res.message);
    });
  };

  return (
    <Modal title="WhatsApp message to many customers" onClose={() => setState(null)}>
      <form className="st-form" onSubmit={send}>
        <Field label="Send to">
          <select value={state.target} onChange={(e) => setState({ ...state, target: e.target.value })}>
            <option value="all">All customers who accept WhatsApp messages</option>
            {selected.size > 0 && <option value="selected">The {selected.size} customer(s) I ticked</option>}
            <option value="tag">Customers with a tag</option>
          </select>
        </Field>
        {state.target === "tag" && (
          <Field label="Tag">
            <select required value={state.tag} onChange={(e) => setState({ ...state, tag: e.target.value })}>
              <option value="">Choose...</option>
              {tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}
            </select>
          </Field>
        )}
        <Field label={`Message (${state.text.length}/1000)`}>
          <textarea required minLength={2} maxLength={1000} rows={5} value={state.text} onChange={(e) => setState({ ...state, text: e.target.value })} placeholder="e.g. New arrivals this weekend! 10% off with code CHAFADIA10." />
        </Field>
        <p className="st-muted">
          {count === undefined ? "Counting..." : <><strong>{count}</strong> customer(s) will receive it.</>} Customers who turned off WhatsApp messages or whose number is not on WhatsApp are skipped automatically.
          Each message starts with "Hello [first name]".
        </p>
        <Alert kind="error">{action.error}</Alert>
        <div className="st-actions">
          <button className="st-btn gold" disabled={action.busy || !count}>Send</button>
          <button type="button" className="st-btn light" onClick={() => setState(null)}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function CustomerModal({ id, canMessage, onClose, onChanged }) {
  const { data, error, reload } = useApi(`/api/customers/${id}`, { interval: 15_000 });
  const action = useAction();
  const [edit, setEdit] = useState(null);
  const [text, setText] = useState("");
  const c = data?.data;

  const save = (e) => {
    e.preventDefault();
    action.run(async () => {
      await api.patch(`/api/customers/${id}`, {
        fullName: edit.fullName,
        phone: edit.phone,
        email: edit.email,
        notes: edit.notes,
        tags: edit.tags.split(",").map((t) => t.trim()).filter(Boolean),
        whatsappOptIn: edit.whatsappOptIn,
        status: edit.status,
      });
      setEdit(null);
      await reload();
      onChanged();
    }, "Customer saved.");
  };
  const send = (e) => {
    e.preventDefault();
    action.run(async () => {
      const res = await api.post(`/api/customers/${id}/message`, { text });
      if (res.data.status === "sent") setText("");
      await reload();
      action.setMessage(res.message);
    });
  };
  const check = () => action.run(async () => {
    const res = await api.post(`/api/customers/${id}/check-whatsapp`, {});
    await reload();
    onChanged();
    action.setMessage(res.message);
  });
  const simulateReply = () => {
    const reply = window.prompt("TEST MODE: what does the customer reply on WhatsApp?", "Thank you!");
    if (!reply) return;
    action.run(async () => {
      await api.post("/api/whatsapp/mock/inbound", { phone: c.phone, text: reply });
      await reload();
    });
  };

  return (
    <Modal title={c ? c.fullName : "Customer"} onClose={onClose}>
      <Alert kind="error">{error || action.error}</Alert>
      <Alert kind="success">{action.message}</Alert>
      {c && !edit && (
        <div className="st-form">
          <div className="st-grid-2">
            <dl className="st-kv">
              <dt>Phone</dt><dd>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "-"}</dd>
              <dt>WhatsApp</dt><dd><WaBadge status={c.whatsapp.status} />{c.whatsapp.checkedAt && <div className="st-muted">checked {formatDate(c.whatsapp.checkedAt)}</div>}{!c.whatsapp.optIn && <div className="st-muted">Customer turned off WhatsApp messages</div>}</dd>
              <dt>Email</dt><dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "-"}</dd>
              <dt>Registered</dt><dd>{formatDate(c.createdAt)} ({c.source === "checkout" ? "at checkout" : "sign-up"})</dd>
              <dt>Last login</dt><dd>{formatDate(c.lastLoginAt)}</dd>
              <dt>Orders</dt><dd>{c.orders} - {formatMoney(c.totalSpent)} spent</dd>
              <dt>Tags</dt><dd>{c.tags.length ? c.tags.join(", ") : "-"}</dd>
              <dt>Notes</dt><dd style={{ whiteSpace: "pre-wrap" }}>{c.notes || "-"}</dd>
              <dt>Status</dt><dd><Badge status={c.status} /></dd>
            </dl>
            <div>
              <h3 style={{ marginTop: 0 }}>Recent orders</h3>
              {c.recentOrders.length === 0 ? <p className="st-muted">No order yet.</p> : (
                <ul className="st-timeline">
                  {c.recentOrders.map((o) => <li key={o.id}><strong>{o.orderNumber}</strong> - {formatMoney(o.total)} - {STATUS_LABELS[o.status] ?? o.status} <span className="st-muted">{formatDate(o.createdAt)}</span></li>)}
                </ul>
              )}
            </div>
          </div>
          <div className="st-actions">
            <button className="st-btn light small" onClick={() => setEdit({ fullName: c.fullName, phone: c.phone ?? "", email: c.email ?? "", notes: c.notes ?? "", tags: c.tags.join(", "), whatsappOptIn: c.whatsapp.optIn, status: c.status })}>Edit details</button>
            {c.whatsapp.chatLink && <a className="st-btn small" href={c.whatsapp.chatLink} target="_blank" rel="noopener noreferrer">Open chat in WhatsApp</a>}
            {canMessage && c.phone && <button className="st-btn light small" disabled={action.busy} onClick={check}>Check if on WhatsApp</button>}
            {canMessage && import.meta.env.DEV && c.phone && <button className="st-btn light small" onClick={simulateReply}>Simulate customer reply (test)</button>}
          </div>

          {canMessage && (
            <section className="st-card" style={{ margin: 0 }}>
              <h3 style={{ marginTop: 0 }}>WhatsApp conversation</h3>
              <div style={{ maxHeight: 320, overflowY: "auto", display: "grid", gap: 6, padding: 8, background: "#efeae2", borderRadius: 12 }}>
                {c.messages.length === 0 && <p className="st-muted" style={{ textAlign: "center" }}>No message yet.</p>}
                {c.messages.map((m) => (
                  <div key={m.id} style={{ justifySelf: m.direction === "in" ? "start" : "end", maxWidth: "80%", background: m.direction === "in" ? "#fff" : "#d9fdd3", borderRadius: 10, padding: "6px 10px", boxShadow: "0 1px 1px rgba(0,0,0,.08)" }}>
                    <div style={{ whiteSpace: "pre-wrap" }}>{m.body ?? { receipt: "🧾 Receipt (PDF)", welcome: "👋 Welcome message", reset: "🔑 Password reset link" }[m.purpose] ?? m.purpose}</div>
                    <small className="st-muted">
                      {formatDate(m.createdAt)}
                      {m.direction === "out" && ` - ${m.purpose === "broadcast" ? "broadcast" : m.purpose}${m.sentBy ? ` by ${m.sentBy}` : ""} - ${m.status}`}
                      {m.error ? ` - ${m.error}` : ""}
                    </small>
                  </div>
                ))}
              </div>
              {c.canMessage ? (
                <form onSubmit={send} className="st-form" style={{ marginTop: 8 }}>
                  <Field label={c.replyWindowOpen ? "Reply (the customer wrote in the last 24 h: free text allowed)" : 'Message (sent with the approved template: "Hello [name], [your message]")'}>
                    <textarea required maxLength={1000} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
                  </Field>
                  <button className="st-btn gold" disabled={action.busy || !text.trim()}>Send on WhatsApp</button>
                </form>
              ) : (
                <p className="st-muted">{c.phone ? "WhatsApp sending is turned off on the server. Use \"Open chat in WhatsApp\"." : "This customer has no phone number."}</p>
              )}
            </section>
          )}
        </div>
      )}

      {c && edit && (
        <form className="st-form" onSubmit={save}>
          <div className="st-row">
            <Field label="Name"><input required minLength={2} value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} /></Field>
            <Field label="Phone (WhatsApp)"><input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} placeholder="+237 6XX XXX XXX" inputMode="tel" /></Field>
          </div>
          <div className="st-row">
            <Field label="Email"><input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Tags (comma separated)"><input value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} placeholder="vip, wholesale, yaounde" /></Field>
          </div>
          <Field label="Private notes (staff only)"><textarea rows={3} maxLength={2000} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          <label className="st-check"><input type="checkbox" checked={edit.whatsappOptIn} onChange={(e) => setEdit({ ...edit, whatsappOptIn: e.target.checked })} /> Accepts receipts and messages on WhatsApp</label>
          <Field label="Account">
            <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
              <option value="active">Active</option><option value="suspended">Suspended (cannot log in)</option>
            </select>
          </Field>
          <div className="st-actions">
            <button className="st-btn" disabled={action.busy}>Save</button>
            <button type="button" className="st-btn light" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
