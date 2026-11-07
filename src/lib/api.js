// Thin client for the CHAFADIA API.
// The access token lives only in memory (never localStorage). The refresh token is an
// httpOnly cookie the browser sends to /api/auth/refresh; this module renews the access
// token transparently when a request returns 401.

export const API_BASE = import.meta.env.VITE_API_URL || "";

let accessToken = null;
let refreshing = null;
let onSessionChange = () => {};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function setSessionListener(fn) {
  onSessionChange = fn;
}

export function setAccessToken(token) {
  accessToken = token;
}

export function refreshSession() {
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Requested-With": "chafadia" },
    })
      .then(async (res) => {
        // 204 = not signed in (no session cookie); 401 = session expired or revoked
        if (!res.ok || res.status === 204) {
          accessToken = null;
          onSessionChange(null);
          return null;
        }
        const data = await res.json();
        accessToken = data.accessToken;
        onSessionChange(data.user);
        return data;
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function request(path, { method = "GET", body, form, headers = {}, retry = true, blob = false } = {}) {
  const init = {
    method,
    credentials: "include",
    headers: { "X-Requested-With": "chafadia", ...headers },
  };
  if (accessToken) init.headers.Authorization = `Bearer ${accessToken}`;
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, init);
  if (res.status === 401 && retry && !path.startsWith("/api/auth/")) {
    const refreshed = await refreshSession();
    if (refreshed) return request(path, { method, body, form, headers, retry: false, blob });
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const details = data.error?.details;
    const first = Array.isArray(details) && details[0] ? ` (${details[0].field}: ${details[0].message})` : "";
    throw new ApiError(res.status, (data.error?.message || `Request failed (${res.status})`) + first, details);
  }
  if (blob) return res.blob();
  if (res.status === 204) return null;
  const type = res.headers.get("content-type") || "";
  return type.includes("application/json") ? res.json() : res.text();
}

export const api = {
  get: (path, opts) => request(path, opts),
  post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
  patch: (path, body, opts) => request(path, { ...opts, method: "PATCH", body }),
  put: (path, body, opts) => request(path, { ...opts, method: "PUT", body }),
  del: (path, body, opts) => request(path, { ...opts, method: "DELETE", body }),
  upload: (path, form) => request(path, { method: "POST", form }),
  blob: (path) => request(path, { blob: true }),
};

/** Query string from an object, skipping empty values. */
export const qs = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
  return s ? `?${s}` : "";
};

/** Open an authenticated PDF (receipt) in a new tab so it can be printed. */
export async function openPdf(path) {
  const win = window.open("", "_blank");
  try {
    const blob = await api.blob(path);
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    win?.close();
    throw err;
  }
}

/** Download an authenticated file (CSV export). */
export async function downloadFile(path, filename) {
  const blob = await api.blob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const formatMoney = (amount) => `${Math.round(Number(amount) || 0).toLocaleString("fr-FR")} FCFA`;

export const METHOD_LABELS = {
  cash: "Cash",
  mtn_momo: "MTN Mobile Money",
  orange_money: "Orange Money",
  card: "Bank card",
};

export const STATUS_LABELS = {
  pending: "Pending payment",
  paid: "Paid",
  processing: "Processing",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const formatDate = (value) =>
  value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "-";
