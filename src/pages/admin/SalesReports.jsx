import { useState } from "react";
import { Alert, Field, Stat, StaffLayout } from "../../components/staff/StaffLayout";
import { useAuth } from "../../context/AuthContext";
import { api, downloadFile, formatMoney, qs } from "../../lib/api";
import { useAction, useApi } from "../../lib/useApi";

function SalesReports() {
  const { can } = useAuth();
  const full = can("reports.full");
  const [period, setPeriod] = useState("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = qs({ period, from: period === "custom" ? from : "", to: period === "custom" && to ? `${to}T23:59:59` : "" });
  const { data: products, error } = useApi(`/api/reports/products${range}`);
  const { data: summary } = useApi(full ? `/api/reports/summary${range}` : null);
  const { data: expenses, reload: reloadExpenses } = useApi(full ? "/api/expenses" : null);
  const [expense, setExpense] = useState({ description: "", category: "", amount: "", spentOn: "" });
  const action = useAction();
  const rows = products?.data ?? [];
  const s = summary?.data;

  const exportCsv = (path, name) => action.run(() => downloadFile(`${path}${range}${range ? "&" : "?"}format=csv`, `${name}-${period}.csv`));
  const addExpense = (e) => {
    e.preventDefault();
    action.run(async () => {
      await api.post("/api/expenses", { ...expense, amount: Number(expense.amount), category: expense.category || undefined, spentOn: expense.spentOn || undefined });
      setExpense({ description: "", category: "", amount: "", spentOn: "" });
      await reloadExpenses();
    }, "Expense recorded.");
  };

  return (
    <StaffLayout
      title="Reports"
      subtitle="Per-product stock, quantity sold, amount sold and profit. Export to CSV (opens in Excel)."
      actions={
        <>
          <select className="st-input" style={{ width: "auto" }} value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="today">Today</option><option value="week">Last 7 days</option><option value="month">This month</option><option value="year">This year</option><option value="all">All time</option><option value="custom">Custom range</option>
          </select>
          {period === "custom" && <><input className="st-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "auto" }} /><input className="st-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "auto" }} /></>}
        </>
      }
    >
      <Alert kind="error">{error || action.error}</Alert>
      <Alert kind="success">{action.message}</Alert>
      {s && (
        <div className="st-grid" style={{ marginBottom: 16 }}>
          <Stat label="Sales" value={formatMoney(s.revenue)} hint={`${s.orders} orders`} />
          <Stat label="Cost of goods" value={formatMoney(s.costOfGoods)} />
          <Stat label="Gross profit" value={formatMoney(s.grossProfit)} />
          <Stat label="Expenses" value={formatMoney(s.expenses)} />
          <Stat label="Net profit" value={formatMoney(s.netProfit)} />
        </div>
      )}
      <section className="st-card">
        <div className="st-toolbar">
          <h2 style={{ margin: 0, flex: 1 }}>Products</h2>
          <button className="st-btn light small" onClick={() => exportCsv("/api/reports/products", "products")}>Export products CSV</button>
          {full && <button className="st-btn light small" onClick={() => exportCsv("/api/reports/sales", "sales")}>Export sales CSV</button>}
          <button className="st-btn light small" onClick={() => window.print()}>Print / save as PDF</button>
        </div>
        <div className="st-table-wrap">
          <table className="st-table">
            <thead><tr><th>Product</th><th>SKU</th><th className="num">In stock</th><th className="num">Qty sold</th><th className="num">Amount sold</th>{full && <th className="num">Cost price</th>}{full && <th className="num">Profit</th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}><td>{r.name}</td><td>{r.sku}</td><td className="num">{r.inStock}</td><td className="num">{r.quantitySold}</td><td className="num">{formatMoney(r.amountSold)}</td>{full && <td className="num">{formatMoney(r.costPrice)}</td>}{full && <td className="num">{formatMoney(r.profit)}</td>}</tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot><tr><th>Total</th><th></th><th className="num">{rows.reduce((a, r) => a + r.inStock, 0)}</th><th className="num">{rows.reduce((a, r) => a + r.quantitySold, 0)}</th><th className="num">{formatMoney(rows.reduce((a, r) => a + r.amountSold, 0))}</th>{full && <th></th>}{full && <th className="num">{formatMoney(rows.reduce((a, r) => a + r.profit, 0))}</th>}</tr></tfoot>
            )}
          </table>
        </div>
      </section>

      {full && (
        <section className="st-card">
          <h2>Expenses</h2>
          <form className="st-row" onSubmit={addExpense} style={{ alignItems: "end", marginBottom: 12 }}>
            <Field label="Description"><input required minLength={2} value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} /></Field>
            <Field label="Category"><input value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })} placeholder="Rent, transport..." /></Field>
            <Field label="Amount (FCFA)"><input type="number" min={1} required value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} /></Field>
            <Field label="Date"><input type="date" value={expense.spentOn} onChange={(e) => setExpense({ ...expense, spentOn: e.target.value })} /></Field>
            <button className="st-btn" disabled={action.busy}>Add expense</button>
          </form>
          <div className="st-table-wrap">
            <table className="st-table">
              <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="num">Amount</th><th>By</th></tr></thead>
              <tbody>{(expenses?.data ?? []).map((e) => <tr key={e.id}><td>{String(e.spentOn).slice(0, 10)}</td><td>{e.description}</td><td>{e.category}</td><td className="num">{formatMoney(e.amount)}</td><td>{e.createdBy}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </StaffLayout>
  );
}

export default SalesReports;
