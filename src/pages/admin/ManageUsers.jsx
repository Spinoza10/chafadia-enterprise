import { useMemo, useState } from "react";
import { Alert, Badge, Field, Modal, StaffLayout } from "../../components/staff/StaffLayout";
import PasswordInput from "../../components/PasswordInput";
import { STAFF_RULES } from "../../lib/passwordRules";
import { api, formatDate } from "../../lib/api";
import { useAction, useApi } from "../../lib/useApi";

const ROLE_LABELS = { super_admin: "Super Admin", admin: "Admin", cashier: "Cashier", delivery: "Delivery", customer: "Customer" };
const emptyForm = { fullName: "", email: "", phone: "", role: "cashier", password: "" };

function PermissionMatrix({ user, matrix, onClose }) {
  const { data, reload } = useApi(`/api/users/${user.id}/permissions`);
  const [overrides, setOverrides] = useState(null);
  const { busy, error, message, run } = useAction();
  const current = overrides ?? data?.overrides ?? {};
  const defaults = new Set(matrix.roleDefaults[user.role] ?? []);

  const effective = (code) => (code in current ? current[code] : defaults.has(code));
  const toggle = (code) => {
    const next = { ...current };
    const want = !effective(code);
    if (want === defaults.has(code)) delete next[code];
    else next[code] = want;
    setOverrides(next);
  };
  const save = () => run(async () => {
    await api.put(`/api/users/${user.id}/permissions`, { overrides: current });
    setOverrides(null);
    await reload();
  }, "Permissions saved. They apply on the user's next request.");

  const groups = matrix.permissions.reduce((acc, p) => ((acc[p.category] ??= []).push(p), acc), {});
  return (
    <Modal title={`Permissions - ${user.fullName} (${ROLE_LABELS[user.role]})`} onClose={onClose}>
      <p className="st-muted">Ticked = allowed. Bold items differ from the {ROLE_LABELS[user.role]} defaults. Items marked "owner only" can never be granted.</p>
      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{message}</Alert>
      {Object.entries(groups).map(([cat, perms]) => (
        <div key={cat} style={{ marginBottom: 12 }}>
          <h3>{cat}</h3>
          <div className="st-grid">
            {perms.map((p) => (
              <label key={p.code} className="st-check" title={p.code} style={{ fontWeight: p.code in current ? 950 : 650, opacity: p.grantable ? 1 : 0.5 }}>
                <input type="checkbox" disabled={!p.grantable} checked={p.grantable && effective(p.code)} onChange={() => toggle(p.code)} />
                {p.description}{!p.grantable && " (owner only)"}
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="st-actions">
        <button className="st-btn" disabled={busy} onClick={save}>Save permissions</button>
        <button className="st-btn light" onClick={() => setOverrides({})}>Reset to role defaults</button>
      </div>
    </Modal>
  );
}

function ManageUsers() {
  const [roleFilter, setRoleFilter] = useState("staff");
  const [search, setSearch] = useState("");
  const { data, error, reload } = useApi(`/api/users?role=${roleFilter}&limit=100${search ? `&search=${encodeURIComponent(search)}` : ""}`);
  const { data: matrix } = useApi("/api/users/permissions/matrix");
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [permUser, setPermUser] = useState(null);
  const action = useAction();
  const users = useMemo(() => data?.data ?? [], [data]);

  const create = (e) => {
    e.preventDefault();
    action.run(async () => {
      await api.post("/api/users", { ...form, phone: form.phone || undefined });
      setForm(emptyForm);
      await reload();
    }, "Account created. Share the temporary password privately and ask the person to change it.");
  };

  const update = (user, patch, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    action.run(async () => {
      await api.patch(`/api/users/${user.id}`, patch);
      setEditing(null);
      await reload();
    }, "Saved.");
  };

  const remove = (user) => {
    if (!window.confirm(`Delete ${user.fullName}? They lose access immediately. Their past sales stay in the records.`)) return;
    action.run(async () => {
      await api.del(`/api/users/${user.id}`);
      await reload();
    }, "Account deleted.");
  };

  return (
    <StaffLayout title="Staff & permissions" subtitle="Only the owner can add, suspend or remove admins, cashiers and delivery staff.">
      <Alert kind="error">{error || action.error}</Alert>
      <Alert kind="success">{action.message}</Alert>

      <section className="st-card">
        <h2>Add a staff member</h2>
        <form className="st-form" onSubmit={create}>
          <div className="st-row">
            <Field label="Full name"><input required minLength={2} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
            <Field label="Email"><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+237..." /></Field>
            <Field label="Role">
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="admin">Admin</option>
                <option value="cashier">Cashier</option>
                <option value="delivery">Delivery person</option>
              </select>
            </Field>
            <Field label="Temporary password"><PasswordInput value={form.password} onChange={(v) => setForm({ ...form, password: v })} placeholder="min 10, letters + numbers" autoComplete="new-password" rules={STAFF_RULES} /></Field>
          </div>
          <div><button className="st-btn" disabled={action.busy}>Create account</button></div>
        </form>
      </section>

      <section className="st-card">
        <div className="st-toolbar">
          <input className="st-input" placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="st-input" style={{ flex: "0 0 auto" }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="staff">All staff</option>
            <option value="admin">Admins</option>
            <option value="cashier">Cashiers</option>
            <option value="delivery">Delivery</option>
            <option value="customer">Customers</option>
          </select>
        </div>
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.fullName}</strong><div className="st-muted">{u.email}{u.phone ? ` - ${u.phone}` : ""}</div></td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td><Badge status={u.status} />{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <> <Badge status="pending">locked</Badge></>}</td>
                  <td>{formatDate(u.lastLoginAt)}</td>
                  <td>
                    {u.role === "super_admin" ? <span className="st-muted">Owner</span> : (
                      <div className="st-actions">
                        <button className="st-btn light small" onClick={() => setEditing({ ...u, password: "" })}>Edit</button>
                        {u.role !== "customer" && matrix && <button className="st-btn light small" onClick={() => setPermUser(u)}>Permissions</button>}
                        {u.status === "active"
                          ? <button className="st-btn danger small" onClick={() => update(u, { status: "suspended" }, `Suspend ${u.fullName}? They are signed out immediately.`)}>Suspend</button>
                          : <button className="st-btn small" onClick={() => update(u, { status: "active" })}>Reactivate</button>}
                        {u.lockedUntil && <button className="st-btn light small" onClick={() => update(u, { unlock: true })}>Unlock</button>}
                        <button className="st-btn danger small" onClick={() => remove(u)}>Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={5} className="st-empty">No accounts found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <Modal title={`Edit ${editing.fullName}`} onClose={() => setEditing(null)}>
          <form
            className="st-form"
            onSubmit={(e) => {
              e.preventDefault();
              update(editing, {
                fullName: editing.fullName,
                phone: editing.phone || null,
                ...(editing.role !== "customer" && { role: editing.role }),
                ...(editing.password && { password: editing.password }),
              });
            }}
          >
            <Field label="Full name"><input required value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} /></Field>
            <Field label="Phone"><input value={editing.phone ?? ""} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            {editing.role !== "customer" && (
              <Field label="Role">
                <select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                  <option value="admin">Admin</option>
                  <option value="cashier">Cashier</option>
                  <option value="delivery">Delivery person</option>
                </select>
              </Field>
            )}
            <Field label="New password (leave empty to keep)"><PasswordInput required={false} value={editing.password} onChange={(v) => setEditing({ ...editing, password: v })} placeholder="Leave empty to keep" autoComplete="new-password" rules={STAFF_RULES} /></Field>
            <p className="st-muted">Changing the role or password signs the person out of every device.</p>
            <div><button className="st-btn" disabled={action.busy}>Save</button></div>
          </form>
        </Modal>
      )}
      {permUser && matrix && <PermissionMatrix user={permUser} matrix={matrix} onClose={() => setPermUser(null)} />}
    </StaffLayout>
  );
}

export default ManageUsers;
