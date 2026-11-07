import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { Alert, Field } from "../components/staff/StaffLayout";
import "../components/staff/staff.css";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";
import { api, formatMoney } from "../lib/api";
import { currentPosition, embedUrl, loadGoogleMaps, mapsEnabled } from "../lib/maps";
import { afterInitiate, momoNumberError } from "../lib/momo";
import PasswordInput from "../components/PasswordInput";
import { CUSTOMER_RULES, passwordOk } from "../lib/passwordRules";

const METHODS = [
  { value: "mtn_momo", label: "MTN Mobile Money", icon: "📱" },
  { value: "orange_money", label: "Orange Money", icon: "🟧" },
  { value: "card", label: "Visa / Mastercard", icon: "💳" },
  { value: "cash", label: "Cash on pickup / delivery", icon: "💵" },
];

function Checkout() {
  const { currentUser, signup } = useAuth();
  const { cart, cartIssues, cartForCheckout, clearCart, refreshOrders, loadProducts } = useStore();
  const navigate = useNavigate();
  const addressRef = useRef(null);

  const [zones, setZones] = useState([]);
  const [form, setForm] = useState({
    name: currentUser?.name || "",
    email: currentUser?.email || "",
    phone: currentUser?.phone || "",
    fulfilment: "pickup",
    zoneId: "",
    address: "",
    location: null,
    placeId: "",
    paymentMethod: "mtn_momo",
    payPhone: currentUser?.phone || "",
    coupon: sessionStorage.getItem("chafadiaCoupon") || "",
    notes: "",
    whatsapp: true,
    createAccount: false,
    accountPassword: "",
  });
  const [discount, setDiscount] = useState(0);
  const [couponNote, setCouponNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // manual = pay by MoMo / Orange transfer to the shop's numbers + screenshot verified by admins
  const [payConfig, setPayConfig] = useState({ mode: "manual", accounts: {} });
  const manual = payConfig.mode === "manual";
  const methods = manual ? METHODS.filter((m) => m.value !== "card") : METHODS;

  useEffect(() => {
    api.get("/api/delivery-zones").then((r) => setZones(r.data)).catch(() => setZones([]));
    api
      .get("/api/settings/public")
      .then((r) => setPayConfig({ mode: r.data.onlinePaymentMode ?? "manual", accounts: r.data.settlement_accounts ?? {} }))
      .catch(() => {});
  }, []);

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const zone = zones.find((z) => String(z.id) === String(form.zoneId));
  const deliveryFee = form.fulfilment === "delivery" ? zone?.fee ?? 0 : 0;
  const estimated = Math.max(0, subtotal - discount) + deliveryFee;

  useEffect(() => {
    if (!form.coupon || !subtotal) return;
    api
      .post("/api/coupons/validate", { code: form.coupon, subtotal })
      .then((r) => {
        setDiscount(r.data.discount);
        setCouponNote(`Coupon ${r.data.code}: -${formatMoney(r.data.discount)}`);
      })
      .catch((err) => {
        setDiscount(0);
        setCouponNote(err.message);
      });
  }, [form.coupon, subtotal]);

  // Google Places autocomplete on the address field when a Maps key is configured.
  useEffect(() => {
    if (form.fulfilment !== "delivery" || !mapsEnabled || !addressRef.current) return;
    let listener;
    loadGoogleMaps()
      .then((google) => {
        if (!google || !addressRef.current) return;
        const ac = new google.maps.places.Autocomplete(addressRef.current, { fields: ["formatted_address", "geometry", "place_id"] });
        listener = ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          if (!place.geometry) return;
          setForm((f) => ({
            ...f,
            address: place.formatted_address || f.address,
            placeId: place.place_id || "",
            location: { lat: Number(place.geometry.location.lat().toFixed(6)), lng: Number(place.geometry.location.lng().toFixed(6)) },
          }));
        });
      })
      .catch(() => {});
    return () => listener?.remove();
  }, [form.fulfilment]);

  const useMyLocation = async () => {
    setLocating(true);
    setError("");
    try {
      const location = await currentPosition();
      setForm((f) => ({ ...f, location, address: f.address || `GPS ${location.lat}, ${location.lng}` }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLocating(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!cart.length) return setError("Your cart is empty.");
    if (cartIssues.length) {
      return setError(`${cartIssues.map((i) => i.name).join(", ")}: sold out or not enough stock left. Update your cart to continue.`);
    }
    if (form.fulfilment === "delivery" && (!form.zoneId || !form.address.trim())) return setError("Choose a delivery zone and enter your address.");
    if (!manual && ["mtn_momo", "orange_money"].includes(form.paymentMethod)) {
      const numberError = momoNumberError(form.paymentMethod, form.payPhone);
      if (numberError) return setError(numberError);
    }

    if (!currentUser && form.createAccount && !passwordOk(form.accountPassword, CUSTOMER_RULES)) {
      return setError("Choose a password with at least 8 characters, a letter and a number (or untick \"Create my account\").");
    }

    setBusy(true);
    let placed = null;
    try {
      // one tick: the guest's details become their account, and this order is saved to it
      if (!currentUser && form.createAccount) {
        await signup(form.name, form.email, form.accountPassword, form.phone, form.whatsapp, "checkout");
      }
      const orderRes = await api.post("/api/orders", {
        items: cartForCheckout(),
        customer: { name: form.name, email: form.email || undefined, phone: form.phone },
        fulfilment: form.fulfilment,
        deliveryZoneId: form.fulfilment === "delivery" ? Number(form.zoneId) : undefined,
        address:
          form.fulfilment === "delivery"
            ? { line: form.address, latitude: form.location?.lat, longitude: form.location?.lng, placeId: form.placeId || undefined }
            : undefined,
        couponCode: form.coupon || undefined,
        paymentMethod: form.paymentMethod,
        notes: form.notes || undefined,
        whatsappOptIn: form.whatsapp,
      });
      const order = orderRes.data;
      placed = order;
      clearCart();
      sessionStorage.removeItem("chafadiaCoupon");
      sessionStorage.setItem("chafadiaLastOrder", JSON.stringify({ id: order.id, number: order.orderNumber, token: order.trackingToken }));
      refreshOrders();
      loadProducts();

      const trackPath = `/track/${order.orderNumber}?token=${order.trackingToken}`;
      if (form.paymentMethod === "cash") return navigate(trackPath);
      if (manual) return navigate(`/pay/${order.orderNumber}?token=${order.trackingToken}`);

      const pay = await api.post("/api/payments/initiate", {
        orderId: order.id,
        token: order.trackingToken,
        method: form.paymentMethod,
        phone: form.payPhone || undefined,
      });
      afterInitiate(navigate, pay.data);
    } catch (err) {
      if (placed) {
        // The order exists (items reserved) but the payment request failed: let them retry from the order page.
        navigate(`/track/${placed.orderNumber}?token=${placed.trackingToken}`, { state: { paymentError: err.message } });
        return;
      }
      setError(err.message);
      if (err.status === 409) loadProducts();
    } finally {
      setBusy(false);
    }
  };

  if (!cart.length) {
    return (
      <>
        <Navbar />
        <div className="st-page">
          <div className="st-container" style={{ maxWidth: 720 }}>
            <div className="st-card st-empty">
              <h2>Your cart is empty</h2>
              <p>Add products to your cart before checking out.</p>
              <Link className="st-btn gold" to="/products">Browse products</Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="st-page">
        <div className="st-container" style={{ maxWidth: 1080 }}>
          <header className="st-head">
            <div>
              <h1>Checkout</h1>
              <p>{currentUser ? `Signed in as ${currentUser.email}` : "Checking out as a guest. "}
                {!currentUser && <Link to="/login" state={{ from: "/checkout" }} style={{ color: "#fff7d6" }}>Log in to save this order to your account</Link>}
              </p>
            </div>
          </header>

          <form className="st-grid-2" onSubmit={submit}>
            <div>
              <section className="st-card st-form">
                <h2>Your details</h2>
                <Field label="Full name"><input required minLength={2} value={form.name} onChange={set("name")} autoComplete="name" /></Field>
                <div className="st-row">
                  <Field label="Phone"><input required value={form.phone} onChange={set("phone")} placeholder="+237 6XX XXX XXX" autoComplete="tel" inputMode="tel" /></Field>
                  <Field label="Email (for your receipt)"><input type="email" value={form.email} onChange={set("email")} autoComplete="email" /></Field>
                </div>
                <label className="st-check">
                  <input type="checkbox" checked={form.whatsapp} onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.checked }))} />
                  Also send my receipt on WhatsApp{currentUser?.phone ? " (to the number on my account)" : ""}
                </label>
                {!currentUser && (
                  <>
                    <label className="st-check">
                      <input type="checkbox" checked={form.createAccount} onChange={(e) => setForm((f) => ({ ...f, createAccount: e.target.checked }))} />
                      Create my account with this phone number (track orders and pay faster next time)
                    </label>
                    {form.createAccount && (
                      <PasswordInput
                        value={form.accountPassword}
                        onChange={(v) => setForm((f) => ({ ...f, accountPassword: v }))}
                        placeholder="Choose a password"
                        autoComplete="new-password"
                        rules={CUSTOMER_RULES}
                      />
                    )}
                  </>
                )}
              </section>

              <section className="st-card st-form">
                <h2>Pickup or delivery</h2>
                <div className="st-row">
                  <label className="st-check"><input type="radio" name="ful" checked={form.fulfilment === "pickup"} onChange={() => setForm((f) => ({ ...f, fulfilment: "pickup" }))} /> Pickup in store (free)</label>
                  <label className="st-check"><input type="radio" name="ful" checked={form.fulfilment === "delivery"} onChange={() => setForm((f) => ({ ...f, fulfilment: "delivery" }))} /> Delivery</label>
                </div>
                {form.fulfilment === "delivery" && (
                  <>
                    <Field label="Delivery zone">
                      <select required value={form.zoneId} onChange={set("zoneId")}>
                        <option value="">Choose a zone</option>
                        {zones.map((z) => <option key={z.id} value={z.id}>{z.name} - {formatMoney(z.fee)}</option>)}
                      </select>
                    </Field>
                    <Field label="Delivery address">
                      <input ref={addressRef} required value={form.address} onChange={set("address")} placeholder={mapsEnabled ? "Start typing your address..." : "Quarter, street, landmark, city"} autoComplete="street-address" />
                    </Field>
                    <div className="st-actions">
                      <button type="button" className="st-btn light small" onClick={useMyLocation} disabled={locating}>{locating ? "Locating..." : "📍 Use my current location"}</button>
                      {form.location && <span className="st-badge green">Location saved ({form.location.lat}, {form.location.lng})</span>}
                    </div>
                    {form.location && (
                      <iframe title="Delivery location" src={embedUrl(form.location)} style={{ width: "100%", height: 220, border: 0, borderRadius: 14 }} loading="lazy" referrerPolicy="no-referrer" />
                    )}
                  </>
                )}
                <Field label="Notes (optional)"><textarea value={form.notes} onChange={set("notes")} maxLength={1000} placeholder="Landmark, preferred time..." /></Field>
              </section>

              <section className="st-card st-form">
                <h2>Payment</h2>
                <div className="st-grid">
                  {methods.map((m) => (
                    <label key={m.value} className="st-check st-card" style={{ margin: 0, cursor: "pointer", borderColor: form.paymentMethod === m.value ? "var(--st-gold)" : undefined }}>
                      <input type="radio" name="pm" checked={form.paymentMethod === m.value} onChange={() => setForm((f) => ({ ...f, paymentMethod: m.value }))} />
                      <span>{m.icon} {m.label}</span>
                    </label>
                  ))}
                </div>
                {manual && ["mtn_momo", "orange_money"].includes(form.paymentMethod) && (
                  <div className="st-card" style={{ margin: "10px 0 0", background: "#fffbeb" }}>
                    {payConfig.accounts[form.paymentMethod]?.number ? (
                      <>
                        <p style={{ margin: 0 }}>
                          After placing the order, send the total to{" "}
                          <strong>{payConfig.accounts[form.paymentMethod].number}</strong> ({payConfig.accounts[form.paymentMethod].name}) by{" "}
                          {form.paymentMethod === "mtn_momo" ? "MTN MoMo" : "Orange Money"}.
                        </p>
                        <p className="st-muted" style={{ margin: "6px 0 0" }}>
                          Then upload the screenshot of the payment. Our admins check it and approve your order. You will see each step on screen and get an email.
                        </p>
                      </>
                    ) : (
                      <p style={{ margin: 0 }}>This payment method is not set up yet. Please choose another one.</p>
                    )}
                  </div>
                )}
                {!manual && ["mtn_momo", "orange_money"].includes(form.paymentMethod) && (
                  <>
                    <Field label={`${form.paymentMethod === "mtn_momo" ? "MTN MoMo" : "Orange Money"} number that will pay`}>
                      <input value={form.payPhone} onChange={set("payPhone")} placeholder={form.paymentMethod === "mtn_momo" ? "67X XXX XXX" : "69X XXX XXX"} inputMode="tel" autoComplete="tel" />
                    </Field>
                    <p className="st-muted">
                      📲 We send the payment request straight to this phone. Confirm it by typing your{" "}
                      {form.paymentMethod === "mtn_momo" ? "MTN MoMo" : "Orange Money"} PIN <b>on your phone</b>, and the amount is withdrawn
                      from that account. We never ask for your PIN on this website.
                    </p>
                  </>
                )}
                {form.paymentMethod === "card" && <p className="st-muted">You will enter your card on the payment provider's secure page. We never see or store card numbers.</p>}
                {form.paymentMethod === "cash" && <p className="st-muted">Your items are reserved and the order is confirmed once our staff record your cash payment.</p>}
              </section>
            </div>

            <aside>
              <section className="st-card">
                <h2>Order summary</h2>
                <div className="st-table-wrap">
                  <table className="st-table">
                    <tbody>
                      {cart.map((item) => (
                        <tr key={item.cartId}>
                          <td>{item.name}{item.selectedVariant && item.selectedVariant !== "Standard" ? ` (${item.selectedVariant})` : ""}<br /><small className="st-muted">{item.qty} × {formatMoney(item.price)}</small></td>
                          <td className="num">{formatMoney(item.price * item.qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <dl className="st-kv" style={{ marginTop: 14 }}>
                  <dt>Subtotal</dt><dd className="num">{formatMoney(subtotal)}</dd>
                  {discount > 0 && <><dt>Discount</dt><dd>- {formatMoney(discount)}</dd></>}
                  <dt>Delivery</dt><dd>{form.fulfilment === "delivery" ? (zone ? formatMoney(deliveryFee) : "Choose a zone") : "Free"}</dd>
                  <dt>Estimated total</dt><dd><strong>{formatMoney(estimated)}</strong></dd>
                </dl>
                <p className="st-muted" style={{ fontSize: 12 }}>Final prices, taxes and stock are confirmed by our server when you place the order.</p>
                <Field label="Coupon code">
                  <input value={form.coupon} onChange={(e) => setForm((f) => ({ ...f, coupon: e.target.value.toUpperCase() }))} placeholder="Optional" />
                </Field>
                {couponNote && <p className="st-muted">{couponNote}</p>}
                {cartIssues.length > 0 && (
                  <Alert kind="error">
                    {cartIssues.map((i) => i.name).join(", ")} {cartIssues.length === 1 ? "is" : "are"} sold out or above the stock left.{" "}
                    <Link to="/cart">Update your cart</Link> to continue.
                  </Alert>
                )}
                <Alert kind="error">{error}</Alert>
                <button type="submit" className="st-btn gold block" disabled={busy || cartIssues.length > 0} style={{ marginTop: 10, minHeight: 50 }}>
                  {busy ? "Placing order..." : form.paymentMethod === "cash" ? "Place order" : "Place order & pay"}
                </button>
              </section>
            </aside>
          </form>
        </div>
      </div>
    </>
  );
}

export default Checkout;
