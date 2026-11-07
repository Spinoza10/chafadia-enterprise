import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { homeFor } from "../lib/roles";
import { useStore } from "../context/StoreContext";
import logo from "../assets/images/chafadia-enterprise1.png";
import NotificationBell from "./NotificationBell";
import StockAlertBanner from "./StockAlertBanner";

const ROLE_LABELS = {
  super_admin: "Owner",
  admin: "Admin",
  cashier: "Cashier",
  delivery: "Deliveries",
  customer: "My account",
};

function Navbar() {
  const [open, setOpen] = useState(false);
  const { currentUser, logout } = useAuth();
  const { getCartCount } = useStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <>
    <nav className="navbar">
      <div className="nav-inner">
        <Link to="/" className="nav-brand">
          <img
            src={logo}
            alt="CHAFADIA ENTERPRISE"
            className="nav-logo"
          />

          <div className="nav-brand-text">
            <div className="nav-brand-title">
              CHAFADIA <span className="gold">ENTERPRISE</span>
            </div>

            <div className="nav-brand-subtitle">
              Where Vision Becomes Legacy
            </div>
          </div>
        </Link>

        <button
          className="nav-menu-btn"
          onClick={() => setOpen(!open)}
          aria-label="Menu"
          aria-expanded={open}
        >
          ☰
        </button>

        <div className={open ? "nav-links open" : "nav-links"}>
          <Link to="/">Home</Link>
          <Link to="/about">About Us</Link>
          <Link to="/contact">Contact Us</Link>
          <Link to="/products">Products</Link>
          <Link to="/cart">Cart ({getCartCount()})</Link>

          {currentUser && (
            <Link to={homeFor(currentUser)}>{ROLE_LABELS[currentUser.role]}</Link>
          )}

          {currentUser && <NotificationBell />}

          {!currentUser ? (
            <>
              <Link to="/login">Login</Link>
              <Link to="/signup">Signup</Link>
            </>
          ) : (
            <button className="btn btn-danger" onClick={handleLogout}>
              Logout
            </button>
          )}
        </div>
      </div>
    </nav>
    <StockAlertBanner />
    </>
  );
}

export default Navbar;
