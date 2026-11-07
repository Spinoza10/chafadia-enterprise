import nodemailer from "nodemailer";
import { config } from "../config.js";

// Without SMTP settings, mail is rendered to JSON and logged instead of sent (dev/test).
const transport = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : nodemailer.createTransport({ jsonTransport: true });

export const sentMail = []; // inspected by tests

export async function sendMail({ to, subject, text, html, attachments }) {
  if (!to) return null;
  const info = await transport.sendMail({ from: config.MAIL_FROM, to, subject, text, html, attachments });
  if (!config.SMTP_HOST) {
    sentMail.push({ to, subject, text });
    if (!config.isTest) console.log(`[mail:dev] to=${to} subject="${subject}"\n${text ?? ""}`);
  }
  return info;
}

/** Fire-and-forget wrapper: email failures must never break a request or a payment. */
export function sendMailLater(message) {
  sendMail(message).catch((err) => console.error(`Email to ${message.to} failed: ${err.message}`));
}
