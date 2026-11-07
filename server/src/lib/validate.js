import { z } from "zod";
import { badRequest } from "./errors.js";

/** Parse `data` with a zod schema or throw a 400 listing each invalid field. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join("."), message: i.message }));
    throw badRequest("Invalid input", details);
  }
  return result.data;
}

export const id = z.coerce.number().int().positive();
export const money = z.coerce.number().int().min(0).max(1_000_000_000);
export const phone = z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "Invalid phone number");
export const email = z.string().trim().toLowerCase().email().max(160);
export const password = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

/** Customers: easier to remember (8+ characters, a letter and a number). Staff keep the stricter rule above. */
export const customerPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

export const passwordFor = (role) => (role === "customer" ? customerPassword : password);

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const dateRange = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
