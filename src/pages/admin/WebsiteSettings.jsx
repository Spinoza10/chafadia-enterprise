import { useState } from "react";
import { Alert, Badge, Field, StaffLayout } from "../../components/staff/StaffLayout";
import { useAuth } from "../../context/AuthContext";
import { api, formatMoney } from "../../lib/api";
import { useAction, useApi } from "../../lib/useApi";

const NUMBER_SETTINGS = [
  ["tax_rate_percent", "Tax rate (%) added on top of prices", 0],
  ["reservation_minutes_online", "Minutes stock stays reserved for online payment", 30],
  ["reservation_hours_cash", "Hours stock stays reserved for cash-on-pickup/delivery", 48],
  ["slow_product_days", "A product is 'not selling' after this many days without a sale", 30],
  ["stuck_order_hours", "An order is 'stuck' after this many hours in the same status", 48],
  ["payment_approvals_required", "Different admins who must approve each payment screenshot (1-3)", 2],
  ["proof_review_hours", "Hours items stay reserved while a payment screenshot is being checked", 48],
];

function ShopSettings() {
  const { data, error, reload } = useApi("/api/settings");
  if (!data) return <Alert kind="error">{error}</Alert>;
  const map = Object.fromEntries(data.data.map((s) => [s.key, s.value]));
  // keyed by last update so the form re-initialises after each save
  return <ShopSettingsForm key={data.data.map((s) => s.updatedAt).join()} map={map} error={error} reload={reload} />;
}

function ShopSettingsForm({ map, error, reload }) {
  const action = useAction();
  const [shop, setShop] = useState(map.shop ?? {});
  const [numbers, setNumbers] = useState(() => Object.fromEntries(NUMBER_SETTINGS.map(([k, , d]) => [k, map[k] ?? d])));
  const [alertEmail, setAlertEmail] = useState(map.alert_email ?? "");
  const [accounts, setAccounts] = useState(map.settlement_accounts ?? { mtn_momo: { number: "", name: "" }, orange_money: { number: "", name: "" } });

  const save = (key, value) => action.run(async () => {
    await api.put(`/api/settings/${key}`, { value });
    await reload();
  }, "Saved.");

  const setS = (k) => (e) => setShop({ ...shop, [k]: e.target.value });
  return (
    <>
      <Alert kind="error">{error || action.error}</Alert>
      <Alert kind="success">{action.message}</Alert>
      <section className="st-card">
        <h2>Shop details (printed on receipts)</h2>
        <form className="st-form" onSubmit={(e) => { e.preventDefault(); save("shop", { ...shop, latitude: shop.latitude === "" ? undefined : Number(shop.latitude), longitude: shop.longitude === "" ? undefined : Number(shop.longitude) }); }}>
          <div className="st-row">
            <Field label="Shop name"><input required value={shop.name ?? ""} onChange={setS("name")} /></Field>
            <Field label="Slogan"><input value={shop.slogan ?? ""} onChange={setS("slogan")} /></Field>
            <Field label="Phone"><input value={shop.phone ?? ""} onChange={setS("phone")} /></Field>
            <Field label="Email"><input value={shop.email ?? ""} onChange={setS("email")} /></Field>
          </div>
          <div className="st-row">
            <Field label="Address"><input value={shop.address ?? ""} onChange={setS("address")} /></Field>
            <Field label="Shop latitude (directions start)"><input type="number" step="any" value={shop.latitude ?? ""} onChange={setS("latitude")} /></Field>
            <Field label="Shop longitude"><input type="number" step="any" value={shop.longitude ?? ""} onChange={setS("longitude")} /></Field>
          </div>
          <div><button className="st-btn" disabled={action.busy}>Save shop details</button></div>
        </form>
      </section>
      <section className="st-card">
        <h2>Rules & thresholds</h2>
        <div className="st-form">
          {NUMBER_SETTINGS.map(([key, label]) => (
            <div className="st-row" key={key} style={{ alignItems: "end" }}>
              <Field label={label}><input type="number" min={0} value={numbers[key] ?? ""} onChange={(e) => setNumbers({ ...numbers, [key]: e.target.value })} /></Field>
              <div><button className="st-btn light small" onClick={() => save(key, Number(numbers[key]))}>Save</button></div>
            </div>
          ))}
          <div className="st-row" style={{ alignItems: "end" }}>
            <Field label="Email for low-stock alerts"><input type="email" value={alertEmail} onChange={(e) => setAlertEmail(e.target.value)} /></Field>
            <div><button className="st-btn light small" onClick={() => save("alert_email", alertEmail.trim())}>Save</button></div>
          </div>
        </div>
        <p className="st-muted">Payment provider keys, SMTP and Google Maps keys are server environment variables and are never shown or edited in the browser.</p>
      </section>
      <section className="st-card">
        <h2>Mobile money withdrawal accounts</h2>
        <p className="st-muted">
          Customer MoMo and Orange Money payments are collected by the payment provider (Notch Pay) and withdrawn to these shop accounts.
          Register the same numbers as withdrawal accounts in the Notch Pay dashboard. Only the owner can see this.
        </p>
        <div className="st-form">
          {[["mtn_momo", "MTN MoMo"], ["orange_money", "Orange Money"]].map(([k, label]) => (
            <div className="st-row" key={k}>
              <Field label={`${label} number`}>
                <input value={accounts[k]?.number ?? ""} inputMode="tel" maxLength={9} onChange={(e) => setAccounts({ ...accounts, [k]: { ...accounts[k], number: e.target.value.replace(/\D/g, "") } })} />
              </Field>
              <Field label="Account holder name">
                <input value={accounts[k]?.name ?? ""} onChange={(e) => setAccounts({ ...accounts, [k]: { ...accounts[k], name: e.target.value } })} />
              </Field>
            </div>
          ))}
          <div><button className="st-btn light small" onClick={() => save("settlement_accounts", accounts)}>Save accounts</button></div>
        </div>
      </section>
    </>
  );
}

function DeliveryZones() {
  const { data, error, reload } = useApi("/api/delivery-zones/all");
  const action = useAction();
  const [form, setForm] = useState({ name: "", description: "", fee: "" });
  const zones = data?.data ?? [];

  const add = (e) => {
    e.preventDefault();
    action.run(async () => {
      await api.post("/api/delivery-zones", { ...form, fee: Number(form.fee), description: form.description || null });
      setForm({ name: "", description: "", fee: "" });
      await reload();
    }, "Zone added.");
  };
  const update = (z, patch) => action.run(async () => {
    await api.patch(`/api/delivery-zones/${z.id}`, patch);
    await reload();
  });

  return (
    <section className="st-card">
      <h2>Delivery zones & fees</h2>
      <Alert kind="error">{error || action.error}</Alert>
      <form className="st-row" style={{ alignItems: "end", marginBottom: 12 }} onSubmit={add}>
        <Field label="Zone name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Description"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Fee (FCFA)"><input type="number" min={0} required value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} /></Field>
        <button className="st-btn">Add zone</button>
      </form>
      <div className="st-table-wrap">
        <table className="st-table">
          <thead><tr><th>Zone</th><th className="num">Fee</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id}>
                <td>{z.name}<div className="st-muted">{z.description}</div></td>
                <td className="num">{formatMoney(z.fee)}</td>
                <td><Badge status={z.isActive ? "active" : "closed"}>{z.isActive ? "active" : "disabled"}</Badge></td>
                <td><div className="st-actions">
                  <button className="st-btn light small" onClick={() => { const fee = window.prompt(`New fee for ${z.name}`, z.fee); if (fee !== null) update(z, { fee: Number(fee) }); }}>Change fee</button>
                  <button className="st-btn light small" onClick={() => update(z, { isActive: !z.isActive })}>{z.isActive ? "Disable" : "Enable"}</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WebsiteSettings() {
  const { can } = useAuth();
  return (
    <StaffLayout title="Settings" subtitle="Shop details, taxes, thresholds and delivery zones. Changes are recorded in the audit log.">
      {can("settings.manage") && <ShopSettings />}
      {can("delivery_zones.manage") && <DeliveryZones />}
    </StaffLayout>
  );
}

export default WebsiteSettings;
