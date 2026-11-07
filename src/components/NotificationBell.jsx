import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, formatDate } from "../lib/api";
import "./alerts.css";

const ICONS = {
  sale: "💰", "stock.out": "⛔", "stock.low": "⚠️", "stock.back": "✅", "order.new": "🛒", "order.attention": "❗", "order.paid": "✅",
  "order.status": "📦", "payment.mismatch": "❗", "payment.proof": "🧾", "payment.review": "⏳", "payment.approved": "✅", "payment.rejected": "❌",
  "customer.new": "🙋", "whatsapp.in": "💬", "whatsapp.broadcast": "📣",
};
// where a click on a notification takes staff
const STAFF_LINKS = {
  "customer.new": "/admin/customer-directory", "whatsapp.in": "/admin/customer-directory", "whatsapp.broadcast": "/admin/customer-directory",
  "payment.proof": "/admin/verify-payments", "payment.rejected": "/admin/verify-payments", "stock.out": "/admin/stock", "stock.low": "/admin/stock", "stock.back": "/admin/stock" };

/**
 * Bell in the navbar. Admins and the owner see every sale and every sold-out product as it
 * happens (polled every 20 s); customers see their own order updates. New items also pop up
 * briefly in the corner of the screen.
 */
export default function NotificationBell() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const lastSeen = useRef(null);
  const boxRef = useRef(null);
  const userId = currentUser?.id;

  const load = useCallback(async () => {
    try {
      const res = await api.get("/api/notifications");
      setItems(res.data);
      setUnread(res.unread);
      const newest = res.data[0]?.id ?? 0;
      if (lastSeen.current !== null) {
        const fresh = res.data.filter((n) => n.id > lastSeen.current && !n.readAt).slice(0, 3);
        if (fresh.length) setToasts((t) => [...fresh, ...t].slice(0, 3));
      }
      lastSeen.current = Math.max(lastSeen.current ?? 0, newest);
    } catch {
      // offline or session ended: keep what we have
    }
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    lastSeen.current = null;
    const first = setTimeout(load, 0);
    const timer = setInterval(() => document.visibilityState === "visible" && load(), 20_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [userId, load]);

  useEffect(() => {
    if (!toasts.length) return undefined;
    const timer = setTimeout(() => setToasts((t) => t.slice(0, -1)), 8000);
    return () => clearTimeout(timer);
  }, [toasts]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const markRead = async (ids) => {
    await api.post("/api/notifications/read", ids ? { ids } : {}).catch(() => {});
    load();
  };

  if (!currentUser) return null;

  return (
    <div className="nb-wrap" ref={boxRef}>
      <button type="button" className="nb-bell" onClick={() => setOpen((o) => !o)} aria-label={`Notifications (${unread} unread)`} aria-expanded={open}>
        🔔{unread > 0 && <span className="nb-count">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className="nb-panel" role="dialog" aria-label="Notifications">
          <div className="nb-head">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" onClick={() => markRead()}>Mark all read</button>}
          </div>
          {items.length === 0 ? (
            <p className="nb-empty">Nothing yet.</p>
          ) : (
            <ul>
              {items.map((n) => (
                <li
                  key={n.id}
                  className={n.readAt ? "" : "unread"}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    if (!n.readAt) markRead([n.id]);
                    const to = currentUser.role === "customer" ? "/customer" : STAFF_LINKS[n.type];
                    if (to) {
                      setOpen(false);
                      navigate(to);
                    }
                  }}
                >
                  <span className="nb-icon" aria-hidden="true">{ICONS[n.type] ?? "🔔"}</span>
                  <div>
                    <b>{n.title}</b>
                    <p>{n.message}</p>
                    <small>{formatDate(n.createdAt)}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {toasts.length > 0 && (
        <div className="nb-toasts" role="status" aria-live="polite">
          {toasts.map((n) => (
            <div key={n.id} className={`nb-toast ${n.type.replace(".", "-")}`} onClick={() => STAFF_LINKS[n.type] && currentUser.role !== "customer" && navigate(STAFF_LINKS[n.type])}>
              <span aria-hidden="true">{ICONS[n.type] ?? "🔔"}</span>
              <div><b>{n.title}</b><p>{n.message}</p></div>
              <button type="button" aria-label="Dismiss" onClick={() => setToasts((t) => t.filter((x) => x.id !== n.id))}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
