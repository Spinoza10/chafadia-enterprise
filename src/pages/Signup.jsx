import { useState } from "react";
import PasswordInput from "../components/PasswordInput";
import { CUSTOMER_RULES, passwordOk } from "../lib/passwordRules";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import heroImage from "../assets/images/home-page4.png";

const countryCodes = [
  { flag: "🇨🇲", name: "Cameroon", code: "+237" },
  { flag: "🇳🇬", name: "Nigeria", code: "+234" },
  { flag: "🇬🇭", name: "Ghana", code: "+233" },
  { flag: "🇿🇦", name: "South Africa", code: "+27" },
  { flag: "🇰🇪", name: "Kenya", code: "+254" },
  { flag: "🇺🇬", name: "Uganda", code: "+256" },
  { flag: "🇹🇿", name: "Tanzania", code: "+255" },
  { flag: "🇪🇹", name: "Ethiopia", code: "+251" },
  { flag: "🇪🇬", name: "Egypt", code: "+20" },
  { flag: "🇲🇦", name: "Morocco", code: "+212" },
  { flag: "🇩🇿", name: "Algeria", code: "+213" },
  { flag: "🇹🇳", name: "Tunisia", code: "+216" },
  { flag: "🇸🇳", name: "Senegal", code: "+221" },
  { flag: "🇨🇮", name: "Côte d’Ivoire", code: "+225" },
  { flag: "🇬🇦", name: "Gabon", code: "+241" },
  { flag: "🇨🇬", name: "Congo", code: "+242" },
  { flag: "🇨🇩", name: "DR Congo", code: "+243" },
  { flag: "🇹🇩", name: "Chad", code: "+235" },
  { flag: "🇨🇫", name: "Central African Republic", code: "+236" },
  { flag: "🇺🇸", name: "United States", code: "+1" },
  { flag: "🇨🇦", name: "Canada", code: "+1" },
  { flag: "🇬🇧", name: "United Kingdom", code: "+44" },
  { flag: "🇫🇷", name: "France", code: "+33" },
  { flag: "🇩🇪", name: "Germany", code: "+49" },
  { flag: "🇮🇹", name: "Italy", code: "+39" },
  { flag: "🇪🇸", name: "Spain", code: "+34" },
  { flag: "🇧🇪", name: "Belgium", code: "+32" },
  { flag: "🇨🇭", name: "Switzerland", code: "+41" },
  { flag: "🇳🇱", name: "Netherlands", code: "+31" },
  { flag: "🇸🇦", name: "Saudi Arabia", code: "+966" },
  { flag: "🇦🇪", name: "United Arab Emirates", code: "+971" },
  { flag: "🇶🇦", name: "Qatar", code: "+974" },
  { flag: "🇹🇷", name: "Turkey", code: "+90" },
  { flag: "🇮🇳", name: "India", code: "+91" },
  { flag: "🇨🇳", name: "China", code: "+86" },
  { flag: "🇯🇵", name: "Japan", code: "+81" },
  { flag: "🇧🇷", name: "Brazil", code: "+55" },
  { flag: "🇦🇺", name: "Australia", code: "+61" },
];

/**
 * Quick sign-up: name, phone (WhatsApp) and a password. Email is optional.
 * The phone number is the login and is where receipts and messages arrive on WhatsApp.
 */
function Signup() {
  const { signup, currentUser, loading, homePath } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from;

  const [countryCode, setCountryCode] = useState("+237");
  const [showEmail, setShowEmail] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "", confirmPassword: "", whatsapp: true });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const raw = form.phone.replace(/\D/g, "");
  // people often type the country code again ("+237 6..."): accept it
  const cc = countryCode.replace(/\D/g, "");
  const digits = raw.startsWith(cc) && raw.length > cc.length + 6 ? raw.slice(cc.length) : raw.replace(/^0+/, "");
  const phoneOk = countryCode === "+237" ? /^6\d{8}$/.test(digits) : digits.length >= 6;
  const ready = form.name.trim().length >= 2 && phoneOk && passwordOk(form.password, CUSTOMER_RULES) && form.password === form.confirmPassword;

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");
    if (form.name.trim().length < 2) return setError("Enter your name.");
    if (!phoneOk) return setError(countryCode === "+237" ? "Enter your 9-digit number starting with 6 (e.g. 6 52 43 33 38)." : "Enter your phone number.");
    if (!passwordOk(form.password, CUSTOMER_RULES)) return setError("Your password needs at least 8 characters with a letter and a number.");
    if (form.password !== form.confirmPassword) return setError("The two passwords are not the same.");
    setBusy(true);
    try {
      await signup(form.name.trim(), form.email.trim(), form.password, `${countryCode}${digits}`, form.whatsapp);
      const back = from && !/^\/(admin|cashier|delivery|login|signup)/.test(from);
      navigate(back ? from : "/customer", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (!loading && currentUser && !busy) return <Navigate to={homePath} replace />;

  return (
    <div
      className="auth-page"
      style={{
        backgroundImage: `linear-gradient(rgba(0, 31, 77, 0.42), rgba(0, 31, 77, 0.42)), url(${heroImage})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="auth-card">
        <h1 className="logo-text">
          CHAFADIA <span className="gold">ENTERPRISE</span>
        </h1>
        <p className="welcome-text">Create your account in less than a minute: just your name, phone number and a password.</p>

        <form onSubmit={handleSignup} noValidate>
          <input type="text" placeholder="Your name" required value={form.name} onChange={set("name")} autoComplete="name" autoFocus />

          <div className="phone-row">
            <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} aria-label="Country code">
              {countryCodes.map((country, index) => (
                <option key={index} value={country.code}>
                  {country.flag} {country.code} {country.name}
                </option>
              ))}
            </select>
            <input
              type="tel"
              inputMode="tel"
              placeholder={countryCode === "+237" ? "6XX XXX XXX" : "Phone number"}
              required
              value={form.phone}
              onChange={set("phone")}
              autoComplete="tel-national"
              aria-label="Phone number (WhatsApp)"
              style={form.phone ? { borderColor: phoneOk ? "#16a34a" : "#dc2626" } : undefined}
            />
          </div>
          <p style={{ margin: "4px 2px 10px", fontSize: 13, textAlign: "left" }}>
            {form.phone && !phoneOk ? <span style={{ color: "#b91c1c", fontWeight: 600 }}>✗ 9 digits starting with 6</span> : "Use your WhatsApp number: you log in with it and get your receipts there."}
          </p>

          <PasswordInput value={form.password} onChange={(v) => setForm((f) => ({ ...f, password: v }))} placeholder="Create a password" autoComplete="new-password" rules={CUSTOMER_RULES} />
          <PasswordInput value={form.confirmPassword} onChange={(v) => setForm((f) => ({ ...f, confirmPassword: v }))} placeholder="Type the password again" autoComplete="new-password" matchWith={form.password} />

          {showEmail ? (
            <input type="email" placeholder="Email (optional, for receipts by email)" value={form.email} onChange={set("email")} autoComplete="email" />
          ) : (
            <p style={{ margin: "0 0 10px", textAlign: "left" }}>
              <button type="button" onClick={() => setShowEmail(true)} style={{ background: "none", border: 0, padding: 0, color: "#004aad", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
                + Add an email (optional)
              </button>
            </p>
          )}

          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", textAlign: "left", fontSize: 14, margin: "4px 0 10px" }}>
            <input type="checkbox" checked={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })} style={{ width: "auto", margin: "3px 0 0" }} />
            <span>Send my receipts and order updates on WhatsApp.</span>
          </label>

          {error && <p role="alert" style={{ color: "#b91c1c", fontWeight: 800, margin: "4px 0 10px" }}>{error}</p>}

          <button className="btn" type="submit" disabled={busy} style={{ opacity: ready || busy ? 1 : 0.75 }}>
            {busy ? "Creating account..." : "Create my account"}
          </button>
        </form>

        <p>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
        <p style={{ fontSize: 13 }}>
          No time? You can also <Link to="/products">shop as a guest</Link> and create your account at checkout.
        </p>

        <div className="login-footer">
          <small>Secure Registration • Protected Access • Chafadia Enterprise</small>
        </div>
      </div>
    </div>
  );
}

export default Signup;
