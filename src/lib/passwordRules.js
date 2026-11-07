// Password rules shown live under password fields. The server enforces the same rules.
export const CUSTOMER_RULES = [
  { test: (v) => v.length >= 8, label: "At least 8 characters" },
  { test: (v) => /[A-Za-z]/.test(v), label: "A letter" },
  { test: (v) => /[0-9]/.test(v), label: "A number" },
];

export const STAFF_RULES = [{ test: (v) => v.length >= 10, label: "At least 10 characters" }, ...CUSTOMER_RULES.slice(1)];

export const passwordOk = (value, rules = CUSTOMER_RULES) => rules.every((r) => r.test(value));
