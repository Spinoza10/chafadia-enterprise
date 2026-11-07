import { Link } from "react-router-dom";
import { useStore } from "../context/StoreContext";
import "./alerts.css";

/** Tells the customer, on every page, that something in their cart or wishlist is no longer available. */
export default function StockAlertBanner() {
  const { stockAlerts, dismissStockAlert, cart, removeFromCart } = useStore();
  if (!stockAlerts.length) return null;
  return (
    <div className="sa-wrap" role="alert">
      {stockAlerts.slice(0, 3).map((a) => {
        const line = a.where === "cart" ? cart.find((i) => `cart:${i.variantId}:${a.status}` === a.key) : null;
        return (
          <div className="sa-item" key={a.key}>
            <span aria-hidden="true">⛔</span>
            <p>
              <b>{a.name}</b>{" "}
              {a.status === "sold_out" ? "has just sold out and is not available any more" : "is no longer sold"}
              {a.where === "cart" ? " - it is in your cart." : " - it is on your wishlist."}
            </p>
            {line && <button type="button" onClick={() => removeFromCart(line.cartId)}>Remove from cart</button>}
            {a.where === "cart" && <Link to="/cart">View cart</Link>}
            <button type="button" className="sa-x" aria-label="Dismiss" onClick={() => dismissStockAlert(a.key)}>×</button>
          </div>
        );
      })}
    </div>
  );
}
