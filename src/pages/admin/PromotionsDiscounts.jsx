import { useState } from "react";
import { Alert, Badge, Field, StaffLayout } from "../../components/staff/StaffLayout";
import { api, formatDate, formatMoney } from "../../lib/api";
import { useAction, useApi } from "../../lib/useApi";

const blank = { code: "", description: "", discountType: "percent", value: "", minOrder: "", maxUses: "", startsAt: "", endsAt: "" };

/** Coupon codes validated by the server at checkout (flash sales = coupons with a short date window). */
function PromotionsDiscounts() {
  const { data, error, reload } = useApi("/api/coupons");
  const action = useAction();
  const [form, setForm] = useState(blank);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const coupons = data?.data ?? [];

  const create = (e) => {
    e.preventDefault();
    action.run(async () => {
      await api.post("/api/coupons", {
        code: form.code,
        description: form.description || null,
        discountType: form.discountType,
        value: Number(form.value),
        minOrder: Number(form.minOrder || 0),
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        startsAt: form.startsAt || null,
        endsAt: form.endsAt || null,
      });
      setForm(blank);
      await reload();
    }, "Coupon created.");
  };

  const toggle = (c) => action.run(async () => {
    await api.patch(`/api/coupons/${c.id}`, { isActive: !c.isActive });
    await reload();
  });

  return (
    <StaffLayout title="Coupons & promotions" subtitle="Discount codes for customers. Usage is counted only on paid orders.">
      <Alert kind="error">{error || action.error}</Alert>
      <Alert kind="success">{action.message}</Alert>
      <section className="st-card">
        <h2>New coupon</h2>
        <form className="st-form" onSubmit={create}>
          <div className="st-row">
            <Field label="Code"><input required minLength={3} pattern="[A-Za-z0-9_-]+" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Type"><select value={form.discountType} onChange={set("discountType")}><option value="percent">Percent off</option><option value="fixed">Fixed amount off</option></select></Field>
            <Field label={form.discountType === "percent" ? "Percent (1-100)" : "Amount (FCFA)"}><input type="number" min={1} max={form.discountType === "percent" ? 100 : undefined} required value={form.value} onChange={set("value")} /></Field>
            <Field label="Minimum order (FCFA)"><input type="number" min={0} value={form.minOrder} onChange={set("minOrder")} /></Field>
          </div>
          <div className="st-row">
            <Field label="Max uses"><input type="number" min={1} value={form.maxUses} onChange={set("maxUses")} placeholder="unlimited" /></Field>
            <Field label="Starts"><input type="datetime-local" value={form.startsAt} onChange={set("startsAt")} /></Field>
            <Field label="Ends"><input type="datetime-local" value={form.endsAt} onChange={set("endsAt")} /></Field>
            <Field label="Description"><input value={form.description} onChange={set("description")} /></Field>
          </div>
          <div><button className="st-btn" disabled={action.busy}>Create coupon</button></div>
        </form>
      </section>
      <section className="st-card">
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>Code</th><th>Discount</th><th className="num">Min order</th><th>Used</th><th>Valid</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.code}</strong><div className="st-muted">{c.description}</div></td>
                  <td>{c.discountType === "percent" ? `${c.value}%` : formatMoney(c.value)}</td>
                  <td className="num">{formatMoney(c.minOrder)}</td>
                  <td>{c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ""}</td>
                  <td>{c.startsAt ? formatDate(c.startsAt) : "now"} - {c.endsAt ? formatDate(c.endsAt) : "no end"}</td>
                  <td><Badge status={c.isActive ? "active" : "closed"}>{c.isActive ? "active" : "off"}</Badge></td>
                  <td><button className="st-btn light small" onClick={() => toggle(c)}>{c.isActive ? "Disable" : "Enable"}</button></td>
                </tr>
              ))}
              {!coupons.length && <tr><td colSpan={7} className="st-empty">No coupons yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </StaffLayout>
  );
}

export default PromotionsDiscounts;
