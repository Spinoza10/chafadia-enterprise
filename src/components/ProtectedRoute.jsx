import { Link, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function NoAccess() {
  const { logout } = useAuth();
  return (
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ maxWidth: 440, textAlign: "center" }}>
        <h1 style={{ color: "#001f4d", fontSize: 22 }}>You do not have access to this page</h1>
        <p style={{ color: "#4b5563" }}>Your account has no permission for this section. Ask the shop owner to give you access in "Staff & permissions".</p>
        <p>
          <Link to="/">Go to the shop</Link> · <button type="button" onClick={logout} style={{ background: "none", border: 0, color: "#004aad", cursor: "pointer", textDecoration: "underline" }}>Log out</button>
        </p>
      </div>
    </div>
  );
}

/**
 * Hides pages the user may not use. This is a convenience only: every API call is
 * authorised again on the server, so bypassing this component grants nothing.
 */
function ProtectedRoute({ children, allowedRoles, permission }) {
  const { currentUser, loading, can, homePath } = useAuth();
  const location = useLocation();

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#001f4d", fontWeight: 800 }}>Loading...</div>;
  if (!currentUser) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;

  const roleOk = !allowedRoles || allowedRoles.includes(currentUser.role);
  const list = permission ? (Array.isArray(permission) ? permission : [permission]) : [];
  const permissionOk = !list.length || list.some((p) => can(p));
  if (roleOk && permissionOk) return children;
  // never redirect to the page we are already on (that would loop forever)
  if (homePath === location.pathname) return <NoAccess />;
  return <Navigate to={homePath} replace />;
}

export default ProtectedRoute;
