import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider } from "./context/AuthContext";
import { StoreProvider } from "./context/StoreContext";

import Home from "./pages/Home";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword, { ResetPassword } from "./pages/ForgotPassword";
import Products from "./pages/Products";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import About from "./pages/About";
import Contact from "./pages/Contact";
import { PaymentMock, PaymentReturn } from "./pages/PaymentPages";
import { TrackOrder, VerifyReceipt } from "./pages/TrackOrder";
import ManualPay from "./pages/ManualPay";

const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const ManageUsers = lazy(() => import("./pages/admin/ManageUsers"));
const ManageProducts = lazy(() => import("./pages/admin/ManageProducts"));
const ManageOrders = lazy(() => import("./pages/admin/ManageOrders"));
const StockControl = lazy(() => import("./pages/admin/StockControl"));
const PromotionsDiscounts = lazy(() => import("./pages/admin/PromotionsDiscounts"));
const Announcements = lazy(() => import("./pages/admin/Announcements"));
const CustomerReviews = lazy(() => import("./pages/admin/CustomerReviews"));
const CustomerMessages = lazy(() => import("./pages/admin/CustomerMessages"));
const SalesReports = lazy(() => import("./pages/admin/SalesReports"));
const WebsiteSettings = lazy(() => import("./pages/admin/WebsiteSettings"));
const Transactions = lazy(() => import("./pages/admin/Transactions"));
const Receipts = lazy(() => import("./pages/admin/Receipts"));
const AuditLog = lazy(() => import("./pages/admin/AuditLog"));
const PaymentVerification = lazy(() => import("./pages/admin/PaymentVerification"));
const CustomerDirectory = lazy(() => import("./pages/admin/CustomerDirectory"));

const CashierDashboard = lazy(() => import("./pages/cashier/CashierDashboard"));
const DeliveryDashboard = lazy(() => import("./pages/DeliveryDashboard"));
import CustomerDashboard from "./pages/customer/CustomerDashboard";

import ProtectedRoute from "./components/ProtectedRoute";

// Staff screens load on demand so shoppers on mobile data never download them.
// Route guards only decide what to show. Every API call is authorised again on the server.
const ADMIN_ROLES = ["super_admin", "admin"];
const staff = (element, permission, roles = ADMIN_ROLES) => (
  <ProtectedRoute allowedRoles={roles} permission={permission}>
    <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>Loading...</div>}>{element}</Suspense>
  </ProtectedRoute>
);

/** Clears a page error as soon as the visitor goes to another page. */
function RouteErrorBoundary({ children }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <AuthProvider>
      <StoreProvider>
        <BrowserRouter>
          <RouteErrorBoundary>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/products" element={<Products />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/payment/return" element={<PaymentReturn />} />
            <Route path="/payment/mock" element={<PaymentMock />} />
            <Route path="/track/:orderNumber" element={<TrackOrder />} />
            <Route path="/pay/:orderNumber" element={<ManualPay />} />
            <Route path="/verify/:token" element={<VerifyReceipt />} />

            <Route path="/admin" element={staff(<AdminDashboard />, ["reports.full", "reports.sales_total", "reports.slow_products"])} />
            <Route path="/admin/users" element={staff(<ManageUsers />, "users.manage")} />
            <Route path="/admin/products" element={staff(<ManageProducts />, "products.manage")} />
            <Route path="/admin/stock" element={staff(<StockControl />, "stock.adjust")} />
            <Route path="/admin/orders" element={staff(<ManageOrders />, "orders.view")} />
            <Route path="/admin/promotions" element={staff(<PromotionsDiscounts />, "coupons.manage")} />
            <Route path="/admin/announcements" element={staff(<Announcements />, "content.manage")} />
            <Route path="/admin/customers" element={staff(<CustomerReviews />, "reviews.moderate")} />
            <Route path="/admin/messages" element={staff(<CustomerMessages />, "content.manage")} />
            <Route path="/admin/reports" element={staff(<SalesReports />, ["reports.full", "reports.sales_total"])} />
            <Route path="/admin/settings" element={staff(<WebsiteSettings />, ["settings.manage", "delivery_zones.manage"])} />
            <Route path="/admin/transactions" element={staff(<Transactions />, "payments.view")} />
            <Route path="/admin/verify-payments" element={staff(<PaymentVerification />, "payments.verify")} />
            <Route path="/admin/customer-directory" element={staff(<CustomerDirectory />, "customers.manage")} />
            <Route path="/admin/receipts" element={staff(<Receipts />, "receipts.print", ["super_admin", "admin", "cashier"])} />
            <Route path="/admin/audit" element={staff(<AuditLog />, "audit.view")} />

            <Route path="/cashier" element={staff(<CashierDashboard />, "pos.sell", ["super_admin", "admin", "cashier"])} />
            <Route path="/delivery" element={staff(<DeliveryDashboard />, "delivery.perform", ["super_admin", "admin", "delivery"])} />

            <Route
              path="/customer"
              element={
                <ProtectedRoute allowedRoles={["customer"]}>
                  <CustomerDashboard />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </RouteErrorBoundary>
        </BrowserRouter>
      </StoreProvider>
    </AuthProvider>
  );
}

export default App;
