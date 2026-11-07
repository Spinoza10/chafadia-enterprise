import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import PasswordInput from "../components/PasswordInput";
import { homeFor } from "../lib/roles";
import heroImage from "../assets/images/home-page3.png";

function Login() {
  const { login, currentUser, loading, homePath } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from;

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = await login(form.email.trim(), form.password);
      // go back where they were (e.g. checkout) when it is a page for their role
      const back = from && (user.role === "customer" ? !from.startsWith("/admin") && !from.startsWith("/cashier") && !from.startsWith("/delivery") : from.startsWith("/admin") || from.startsWith("/cashier") || from.startsWith("/delivery"));
      navigate(back ? from : homeFor(user), { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  // already logged in: no need to see the form again
  if (!loading && currentUser && !busy) return <Navigate to={homePath} replace />;

  return (
    <div
      className="auth-page"
      style={{
        backgroundImage: `
          linear-gradient(
            rgba(0, 31, 77, 0.42),
            rgba(0, 31, 77, 0.42)
          ),
          url(${heroImage})
        `,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="auth-card">
        <h1 className="logo-text">
          CHAFADIA <span className="gold">ENTERPRISE</span>
        </h1>

        <p className="welcome-text">
          Welcome back. Sign in to access your account.
        </p>

        <form onSubmit={handleLogin}>
          <input
            type="text"
            placeholder="Phone number or email"
            required
            value={form.email}
            autoComplete="username"
            autoCapitalize="none"
            onChange={(e) =>
              setForm({
                ...form,
                email: e.target.value,
              })
            }
          />

          <PasswordInput
            value={form.password}
            onChange={(v) => setForm({ ...form, password: v })}
            placeholder="Enter your password"
            autoComplete="current-password"
          />

          {error && <p role="alert" style={{ color: "#b91c1c", fontWeight: 800, margin: "4px 0 10px" }}>{error}</p>}

          <button
            className="btn"
            type="submit"
            disabled={busy}
          >
            {busy ? "Signing in..." : "Login"}
          </button>
        </form>


        <p>
          <Link to="/forgot-password">
            Forgot Password?
          </Link>
        </p>

        <p>
          Don't have an account?{" "}
          <Link to="/signup" state={from ? { from } : undefined}>
            Create Account
          </Link>
        </p>

        <div className="login-footer">
          <small>
            Secure Login • Protected Access •
            Chafadia Enterprise
          </small>
        </div>
      </div>
    </div>
  );
}

export default Login;