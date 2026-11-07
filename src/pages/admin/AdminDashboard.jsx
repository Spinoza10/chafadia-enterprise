import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Badge, Bars, Stat, StaffLayout } from "../../components/staff/StaffLayout";
import { useAuth } from "../../context/AuthContext";
import { formatDate, formatMoney, METHOD_LABELS, STATUS_LABELS } from "../../lib/api";
import { useApi } from "../../lib/useApi";

const PERIODS = [
  ["today", "Today"],
  ["week", "Last 7 days"],
  ["month", "This month"],
  ["year", "This year"],
];

function OwnerDashboard({ period }) {
  const { data, error, loading } = useApi(`/api/reports/summary?period=${period}`);
  const d = data?.data;
  return (
    <>
      <Alert kind="error">{error}</Alert>
      {loading && !d && <div className="st-empty">Loading...</div>}
      {d && (
        <>
          <div className="st-grid">
            <Stat label="Total sales" value={formatMoney(d.revenue)} hint={`${d.orders} paid orders`} />
            <Stat label="Gross profit" value={formatMoney(d.grossProfit)} hint="selling price - cost price" />
            <Stat label="Net profit" value={formatMoney(d.netProfit)} hint={`after ${formatMoney(d.expenses)} expenses`} />
            <Stat label="Discounts given" value={formatMoney(d.discounts)} />
            <Stat label="Stock value (cost)" value={formatMoney(d.stockValue.cost_value)} hint={`${d.stockValue.units} units`} />
            <Stat label="Stock value (retail)" value={formatMoney(d.stockValue.retail_value)} />
            <Stat label="Pending deliveries" value={(d.pipeline.paid ?? 0) + (d.pipeline.processing ?? 0) + (d.pipeline.out_for_delivery ?? 0)} hint={`${d.pipeline.pending ?? 0} awaiting payment`} />
            <Stat label="Low stock items" value={d.lowStock.length} />
          </div>
          {d.costOfGoods === 0 && d.revenue > 0 && (
            <Alert kind="warn">Cost prices are 0 for the products sold, so profit equals revenue. Enter real cost prices in Products.</Alert>
          )}
          <div className="st-grid-2" style={{ marginTop: 16 }}>
            <section className="st-card"><h2>Revenue by payment method</h2><Bars rows={d.byMethod.map((r) => ({ ...r, label: METHOD_LABELS[r.method] ?? r.method }))} label="label" value="amount" format={formatMoney} /></section>
            <section className="st-card"><h2>Revenue by cashier</h2><Bars rows={d.byCashier} label="cashier" value="amount" format={formatMoney} /></section>
            <section className="st-card"><h2>Revenue by category</h2><Bars rows={d.byCategory} label="category" value="amount" format={formatMoney} /></section>
            <section className="st-card"><h2>Best sellers</h2><Bars rows={d.bestSellers} label="name" value="units" format={(v) => `${v} sold`} /></section>
            <section className="st-card">
              <h2>Low stock</h2>
              {d.lowStock.length === 0 ? <div className="st-empty">All stock levels are healthy.</div> : (
                <div className="st-table-wrap"><table className="st-table"><thead><tr><th>Product</th><th>SKU</th><th className="num">Available</th></tr></thead>
                  <tbody>{d.lowStock.map((r) => <tr key={r.variantId}><td>{r.name}</td><td>{r.sku}</td><td className="num"><Badge status={r.available <= 0 ? "refunded" : "pending"}>{r.available}</Badge></td></tr>)}</tbody></table></div>
              )}
            </section>
            <section className="st-card">
              <h2>Recent activity</h2>
              <ul className="st-timeline">
                {d.recentActivity.map((a, i) => <li key={i}><strong>{a.actor ?? "System"}</strong> {a.action.replace(/[._]/g, " ")} <span className="st-muted">{a.entityType} {a.entityId} - {formatDate(a.createdAt)}</span></li>)}
              </ul>
              <Link to="/admin/audit" className="st-btn light small" style={{ marginTop: 10 }}>Full audit log</Link>
            </section>
          </div>
        </>
      )}
    </>
  );
}

function AdminLimitedDashboard({ period }) {
  const { can } = useAuth();
  const { data, error } = useApi(`/api/reports/admin?period=${period}`);
  const d = data?.data;
  return (
    <>
      <Alert kind="error">{error}</Alert>
      {d && (
        <>
          {can("reports.sales_total") && (
            <div className="st-grid">
              <Stat label="Total amount sold" value={formatMoney(d.totalSold)} hint={`${d.ordersSold} paid orders`} />
              {["pending", "paid", "processing", "out_for_delivery"].map((s) => <Stat key={s} label={STATUS_LABELS[s]} value={d.pipeline[s] ?? 0} />)}
            </div>
          )}
          <div className="st-grid-2" style={{ marginTop: 16 }}>
            {d.deliveryQueue && (
              <section className="st-card">
                <h2>Delivery queue</h2>
                {d.deliveryQueue.length === 0 ? <div className="st-empty">No deliveries waiting.</div> : (
                  <div className="st-table-wrap"><table className="st-table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Rider</th></tr></thead>
                    <tbody>{d.deliveryQueue.map((o) => <tr key={o.id}><td><Link to={`/admin/orders?open=${o.id}`}>{o.orderNumber}</Link></td><td>{o.customerName}</td><td><Badge status={o.status}>{STATUS_LABELS[o.status]}</Badge></td><td>{o.deliveryPerson ?? <span className="st-muted">unassigned</span>}</td></tr>)}</tbody></table></div>
                )}
              </section>
            )}
            {d.stuckOrders && (
              <section className="st-card">
                <h2>Stuck or flagged orders</h2>
                <p className="st-muted">No status change for over {d.thresholds.stuckHours} hours, or flagged by the system.</p>
                {d.stuckOrders.length === 0 ? <div className="st-empty">Nothing stuck.</div> : (
                  <div className="st-table-wrap"><table className="st-table"><thead><tr><th>Order</th><th>Status</th><th>Since</th></tr></thead>
                    <tbody>{d.stuckOrders.map((o) => <tr key={o.id}><td><Link to={`/admin/orders?open=${o.id}`}>{o.orderNumber}</Link>{o.needsAttention && <div className="st-muted">{o.needsAttention}</div>}</td><td><Badge status={o.status}>{STATUS_LABELS[o.status]}</Badge></td><td>{formatDate(o.since)}</td></tr>)}</tbody></table></div>
                )}
              </section>
            )}
            {d.slowProducts && (
              <section className="st-card">
                <h2>Products not selling</h2>
                <p className="st-muted">No sale in the last {d.thresholds.slowDays} days.</p>
                {d.slowProducts.length === 0 ? <div className="st-empty">Everything is moving.</div> : (
                  <div className="st-table-wrap"><table className="st-table"><thead><tr><th>Product</th><th>SKU</th><th className="num">In stock</th><th>Last sold</th></tr></thead>
                    <tbody>{d.slowProducts.map((p) => <tr key={p.sku}><td>{p.name}</td><td>{p.sku}</td><td className="num">{p.stock}</td><td>{p.lastSoldAt ? formatDate(p.lastSoldAt) : "Never"}</td></tr>)}</tbody></table></div>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </>
  );
}

function AdminDashboard() {
  const { currentUser, can } = useAuth();
  const [period, setPeriod] = useState("month");
  const owner = can("reports.full");
  return (
    <StaffLayout
      title={owner ? "Owner dashboard" : "Admin dashboard"}
      subtitle={`Welcome, ${currentUser?.name}.`}
      actions={
        <select className="st-input" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period" style={{ width: "auto" }}>
          {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      }
    >
      {owner && <OwnerDashboard period={period} />}
      {(can("reports.sales_total") || can("reports.slow_products")) && <AdminLimitedDashboard period={period} />}
    </StaffLayout>
  );
}

export default AdminDashboard;
