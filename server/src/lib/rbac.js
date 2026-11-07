import { query } from "../db.js";

export const STAFF_ROLES = ["super_admin", "admin", "cashier", "delivery"];

/** Effective permission codes for a user: role defaults plus per-user overrides. */
export async function loadPermissions(user, run = query) {
  if (user.role === "super_admin") {
    const { rows } = await run("SELECT code FROM permissions");
    return rows.map((r) => r.code);
  }
  const { rows } = await run(
    `SELECT p.code
       FROM permissions p
       LEFT JOIN role_permissions rp ON rp.permission_code = p.code AND rp.role = $2
       LEFT JOIN user_permissions up ON up.permission_code = p.code AND up.user_id = $1
      WHERE p.grantable
        AND COALESCE(up.granted, rp.role IS NOT NULL)`,
    [user.id, user.role]
  );
  return rows.map((r) => r.code);
}

export const can = (user, permission) =>
  Boolean(user) && (user.role === "super_admin" || user.permissions?.includes(permission));
