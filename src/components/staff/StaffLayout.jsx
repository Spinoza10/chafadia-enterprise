import { NavLink } from "react-router-dom";
import Navbar from "../Navbar";
import { useAuth } from "../../context/AuthContext";
import "./staff.css";

// Navigation is filtered by permission for convenience only; the API enforces every rule.
const LINKS = [
  { to: "/admin", label: "Dashboard", any: ["reports.full", "reports.sales_total", "reports.slow_products"], end: true },
  { to: "/admin/orders", label: "Orders & delivery", any: ["orders.view"] },
  { to: "/admin/products", label: "Products", any: ["products.manage"] },
  { to: "/admin/stock", label: "Stock", any: ["stock.adjust"] },
  { to: "/admin/receipts", label: "Receipts", any: ["receipts.print"] },
  { to: "/admin/verify-payments", label: "✔ Verify payments", any: ["payments.verify"] },
  { to: "/admin/customer-directory", label: "Customers", any: ["customers.manage"] },
  { to: "/admin/transactions", label: "Payments", any: ["payments.view"] },
  { to: "/admin/reports", label: "Reports", any: ["reports.full", "reports.sales_total"] },
  { to: "/admin/users", label: "Staff & permissions", any: ["users.manage"] },
  { to: "/admin/promotions", label: "Coupons", any: ["coupons.manage"] },
  { to: "/admin/customers", label: "Reviews", any: ["reviews.moderate"] },
  { to: "/admin/messages", label: "Messages", any: ["content.manage"] },
  { to: "/admin/announcements", label: "Announcements", any: ["content.manage"] },
  { to: "/admin/settings", label: "Settings", any: ["settings.manage", "delivery_zones.manage"] },
  { to: "/admin/audit", label: "Audit log", any: ["audit.view"] },
  { to: "/cashier", label: "POS", any: ["pos.sell"], end: true },
  { to: "/delivery", label: "My deliveries", any: ["delivery.perform"] },
];

export function StaffLayout({ title, subtitle, actions, children }) {
  const { can } = useAuth();
  const links = LINKS.filter((l) => l.any.some((p) => can(p)));
  return (
    <>
      <Navbar />
      <div className="st-page">
        <div className="st-container">
          {links.length > 1 && (
            <nav className="st-nav" aria-label="Staff sections">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "active" : "")}>
                  {l.label}
                </NavLink>
              ))}
            </nav>
          )}
          <header className="st-head">
            <div>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
            {actions && <div className="st-head-actions">{actions}</div>}
          </header>
          {children}
        </div>
      </div>
    </>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="st-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="st-modal-bg" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="st-modal">
        <div className="st-modal-head">
          <h2>{title}</h2>
          <button type="button" className="st-btn light small" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const STATUS_TONE = {
  pending: "amber", paid: "", processing: "", out_for_delivery: "", delivered: "green", completed: "green",
  cancelled: "grey", refunded: "red", succeeded: "green", failed: "red", expired: "grey", partially_refunded: "amber",
  active: "green", suspended: "red", approved: "green", rejected: "red", open: "green", closed: "grey", new: "amber",
};

export function Badge({ status, children }) {
  return <span className={`st-badge ${STATUS_TONE[status] ?? ""}`}>{children ?? String(status).replace(/_/g, " ")}</span>;
}

export function Field({ label, children }) {
  return (
    <label className="st-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Alert({ kind = "info", children }) {
  if (!children) return null;
  return <div className={`st-alert ${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

/** Horizontal bar list for small breakdowns (by method, by category...). */
export function Bars({ rows, label, value, format = (v) => v }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[value]) || 0));
  if (!rows.length) return <div className="st-empty">No data for this period.</div>;
  return (
    <div className="st-bars">
      {rows.map((r, i) => (
        <div className="st-bar" key={i}>
          <span title={r[label]}>{r[label]}</span>
          <div className="st-bar-track"><div className="st-bar-fill" style={{ width: `${(Number(r[value]) / max) * 100}%` }} /></div>
          <strong>{format(r[value])}</strong>
        </div>
      ))}
    </div>
  );
}
