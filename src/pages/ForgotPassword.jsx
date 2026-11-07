import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import PasswordInput from "../components/PasswordInput";
import { CUSTOMER_RULES } from "../lib/passwordRules";
import heroImage from "../assets/images/home-page1.png";

function AuthShell({ subtitle, children }) {
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
        <p className="welcome-text">{subtitle}</p>
        {children}
        <p>
          <Link to="/login">Back to Login</Link>
        </p>
        <div className="login-footer">
          <small>Secure Recovery • Protected Access • Chafadia Enterprise</small>
        </div>
      </div>
    </div>
  );
}

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const handleRecover = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post("/api/auth/forgot-password", { login: email.trim() });
      setMessage(res.message);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell subtitle="Enter the phone number or email you registered with. We send a link to choose a new password by WhatsApp and/or email.">
      <form onSubmit={handleRecover}>
        <input type="text" inputMode="email" autoCapitalize="none" placeholder="Phone number or email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Sending..." : "Send reset link"}
        </button>
      </form>
      {message && <p className="message">{message}</p>}
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setMessage("Passwords do not match.");
    setBusy(true);
    try {
      await api.post("/api/auth/reset-password", { token: params.get("token") || "", password });
      navigate("/login", { replace: true });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell subtitle="Choose a new password. Customers: at least 8 characters with a letter and a number (staff: 10).">
      <form onSubmit={submit}>
        <PasswordInput value={password} onChange={setPassword} placeholder="New password" autoComplete="new-password" rules={CUSTOMER_RULES} />
        <PasswordInput value={confirm} onChange={setConfirm} placeholder="Type the new password again" autoComplete="new-password" matchWith={password} />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving..." : "Set new password"}
        </button>
      </form>
      {message && <p className="message">{message}</p>}
    </AuthShell>
  );
}

export default ForgotPassword;
