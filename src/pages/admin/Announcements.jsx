import { useState } from "react";
import { Alert, Badge, Field, StaffLayout } from "../../components/staff/StaffLayout";
import { api, formatDate } from "../../lib/api";
import { useAction, useApi } from "../../lib/useApi";

/** Short notices shown to shoppers (opening hours, promotions, delivery delays...). */
function Announcements() {
  const { data, error, reload } = useApi("/api/announcements/all");
  const action = useAction();
  const [form, setForm] = useState({ title: "", body: "", startsAt: "", endsAt: "" });
  const items = data?.data ?? [];

  const create = (e) => {
    e.preventDefault();
    action.run(async () => {
      await api.post("/api/announcements", { ...form, startsAt: form.startsAt || null, endsAt: form.endsAt || null });
      setForm({ title: "", body: "", startsAt: "", endsAt: "" });
      await reload();
    }, "Announcement published.");
  };
  const toggle = (a) => action.run(async () => {
    await api.patch(`/api/announcements/${a.id}`, { isActive: !a.isActive });
    await reload();
  });
  const remove = (a) => {
    if (!window.confirm(`Delete "${a.title}"?`)) return;
    action.run(async () => {
      await api.del(`/api/announcements/${a.id}`);
      await reload();
    });
  };

  return (
    <StaffLayout title="Announcements" subtitle="Notices displayed to customers on the shop.">
      <Alert kind="error">{error || action.error}</Alert>
      <Alert kind="success">{action.message}</Alert>
      <section className="st-card">
        <form className="st-form" onSubmit={create}>
          <Field label="Title"><input required minLength={2} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Message"><textarea required minLength={2} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <div className="st-row">
            <Field label="Show from"><input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></Field>
            <Field label="Show until"><input type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></Field>
          </div>
          <div><button className="st-btn" disabled={action.busy}>Publish</button></div>
        </form>
      </section>
      {items.map((a) => (
        <section className="st-card" key={a.id}>
          <div className="st-toolbar" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>{a.title}</h3>
            <Badge status={a.isActive ? "active" : "closed"}>{a.isActive ? "visible" : "hidden"}</Badge>
          </div>
          <p style={{ whiteSpace: "pre-wrap" }}>{a.body}</p>
          <p className="st-muted">{formatDate(a.createdAt)}{a.endsAt ? ` - until ${formatDate(a.endsAt)}` : ""}</p>
          <div className="st-actions">
            <button className="st-btn light small" onClick={() => toggle(a)}>{a.isActive ? "Hide" : "Show"}</button>
            <button className="st-btn danger small" onClick={() => remove(a)}>Delete</button>
          </div>
        </section>
      ))}
    </StaffLayout>
  );
}

export default Announcements;
