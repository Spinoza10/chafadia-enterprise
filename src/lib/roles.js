/** Default landing page for each role after login. */
export const HOME_BY_ROLE = {
  super_admin: "/admin",
  admin: "/admin",
  cashier: "/cashier",
  delivery: "/delivery",
  customer: "/customer",
};

// Staff pages in order of preference, with the permissions that open them.
const STAFF_PAGES = [
  ["/admin", ["reports.full", "reports.sales_total", "reports.slow_products"]],
  ["/admin/orders", ["orders.view"]],
  ["/admin/verify-payments", ["payments.verify"]],
  ["/admin/products", ["products.manage"]],
  ["/admin/customer-directory", ["customers.manage"]],
  ["/admin/receipts", ["receipts.print"]],
  ["/cashier", ["pos.sell"]],
  ["/delivery", ["delivery.perform"]],
];

/**
 * Where this user should land: their role's page if they may open it, otherwise the first staff
 * page their permissions allow (so a staff member whose permissions changed never hits a dead end).
 */
export function homeFor(user) {
  if (!user) return "/login";
  if (user.role === "customer") return "/customer";
  if (user.role === "super_admin") return "/admin";
  const has = (p) => user.permissions?.includes(p);
  const preferred = HOME_BY_ROLE[user.role];
  const own = STAFF_PAGES.find(([path]) => path === preferred);
  if (!own || own[1].some(has)) return preferred;
  return STAFF_PAGES.find(([, perms]) => perms.some(has))?.[0] ?? preferred;
}
