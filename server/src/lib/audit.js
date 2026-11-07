import { query } from "../db.js";

const SENSITIVE_KEYS = new Set(["password", "password_hash", "passwordHash", "token", "token_hash"]);

function scrub(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEYS.has(k) ? "[redacted]" : scrub(v)])
    );
  }
  return value;
}

/**
 * Append an entry to the audit log. Pass `client` to write inside the caller's transaction,
 * so the log entry commits or rolls back together with the change it describes.
 */
export async function audit({ req, actor, action, entityType, entityId, oldValue, newValue, client }) {
  const user = actor ?? req?.user ?? null;
  const run = client ? client.query.bind(client) : query;
  await run(
    `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, old_value, new_value, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      user?.id ?? null,
      user?.role ?? null,
      action,
      entityType,
      entityId === undefined || entityId === null ? null : String(entityId),
      oldValue === undefined ? null : JSON.stringify(scrub(oldValue)),
      newValue === undefined ? null : JSON.stringify(scrub(newValue)),
      req?.ip ?? null,
      req?.get?.("user-agent")?.slice(0, 300) ?? null,
    ]
  );
}

/** Only the keys whose values differ, as { old, new } objects, for compact audit entries. */
export function diff(before, after) {
  const oldValue = {};
  const newValue = {};
  for (const key of Object.keys(after)) {
    if (after[key] === undefined) continue;
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after[key])) {
      oldValue[key] = before?.[key] ?? null;
      newValue[key] = after[key];
    }
  }
  return { oldValue, newValue, changed: Object.keys(newValue).length > 0 };
}
