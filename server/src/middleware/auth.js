import { query } from "../db.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { can, loadPermissions } from "../lib/rbac.js";
import { verifyAccessToken } from "../lib/tokens.js";

async function resolveUser(req) {
  const header = req.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    throw unauthorized("Session expired or invalid");
  }

  // Re-check the account on every request so suspension and role changes apply immediately.
  const { rows } = await query(
    "SELECT id, email, full_name, phone, role, status, locale, token_version FROM users WHERE id = $1",
    [Number(claims.sub)]
  );
  const user = rows[0];
  if (!user || user.status !== "active" || user.token_version !== claims.tv) {
    throw unauthorized("Session expired or invalid");
  }
  user.permissions = await loadPermissions(user);
  return user;
}

export async function authenticate(req, _res, next) {
  try {
    const user = await resolveUser(req);
    if (!user) throw unauthorized();
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Attach req.user when a valid token is present; continue anonymously otherwise. */
export async function optionalAuth(req, _res, next) {
  try {
    req.user = await resolveUser(req);
    next();
  } catch (err) {
    next(err);
  }
}

/** Require at least one of the given permissions. Must run after authenticate. */
export const requirePermission = (...permissions) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!permissions.some((p) => can(req.user, p))) return next(forbidden());
  next();
};

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};
