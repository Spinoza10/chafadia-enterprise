import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, refreshSession, setAccessToken, setSessionListener } from "../lib/api";
import { homeFor } from "../lib/roles";

const AuthContext = createContext(null);

// The server is the only authority on who the user is and what they may do.
// Nothing about the session is stored in localStorage.
const toUser = (u) =>
  u && {
    id: u.id,
    name: u.fullName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    locale: u.locale,
    permissions: u.permissions || [],
  };

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSessionListener((u) => setCurrentUser(toUser(u)));
    refreshSession().finally(() => setLoading(false));
  }, []);

  const startSession = (data) => {
    setAccessToken(data.accessToken);
    const user = toUser(data.user);
    setCurrentUser(user);
    return user;
  };

  // `identifier` is the phone number or the email the person registered with
  const login = async (identifier, password) => startSession(await api.post("/api/auth/login", { login: identifier, password }));

  const signup = async (fullName, email, password, phone, whatsappOptIn = true, source = "signup") =>
    startSession(await api.post("/api/auth/register", { fullName, email: email || undefined, password, phone: phone || undefined, whatsappOptIn, source }));

  const logout = useCallback(async () => {
    await api.post("/api/auth/logout").catch(() => {});
    setAccessToken(null);
    setCurrentUser(null);
  }, []);

  const can = useCallback(
    (permission) => Boolean(currentUser) && (currentUser.role === "super_admin" || currentUser.permissions.includes(permission)),
    [currentUser]
  );

  const value = useMemo(
    () => ({
      currentUser,
      loading,
      login,
      signup,
      logout,
      can,
      isStaff: Boolean(currentUser) && currentUser.role !== "customer",
      homePath: homeFor(currentUser),
      refresh: refreshSession,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUser, loading, can, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// This hook belongs to the context API and must remain available from this module.
// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
