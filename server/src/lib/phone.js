// Cameroon phone helpers. Numbers are 9 digits starting with 6 (mobile) or 2 (fixed), country code 237.

/** "+237 6 52 43 33 38", "00237652433338", "652433338" -> "237652433338". Other countries are kept as digits. */
export function toE164Digits(input) {
  if (!input) return null;
  let d = String(input).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 9 && /^[62]/.test(d)) d = `237${d}`;
  return /^[0-9]{8,15}$/.test(d) ? d : null;
}

/** How phone numbers are stored on accounts: "+237652433338". */
export function normalizePhone(input) {
  const d = toE164Digits(input);
  return d ? `+${d}` : null;
}

/** wa.me click-to-chat link (opens WhatsApp on the admin's phone or WhatsApp Web). */
export const waLink = (input, text = "") => {
  const d = toE164Digits(input);
  return d ? `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}` : null;
};

/** The 9-digit local part of a Cameroonian number, or null when it is not Cameroonian. */
export function localCameroon(input) {
  const d = toE164Digits(input);
  return d && d.startsWith("237") && d.length === 12 ? d.slice(3) : null;
}

/**
 * Which mobile network a Cameroonian number belongs to, from its prefix.
 * MTN: 67x, 650-654, 680-683. Orange: 69x, 655-659, 686-689. Unknown/ported ranges return null
 * (we then let the operator decide rather than block a valid customer).
 */
export function operatorOf(input) {
  const n = localCameroon(input);
  if (!n) return null;
  const p2 = n.slice(0, 2);
  const p3 = Number(n.slice(0, 3));
  if (p2 === "67" || (p3 >= 650 && p3 <= 654) || (p3 >= 680 && p3 <= 683)) return "mtn";
  if (p2 === "69" || (p3 >= 655 && p3 <= 659) || (p3 >= 686 && p3 <= 689)) return "orange";
  return null;
}

/** "237652433338" -> "6** ** **38" for display in logs, notifications and the payment screen. */
export function maskPhone(input) {
  const n = localCameroon(input) ?? toE164Digits(input);
  if (!n) return "";
  return `${n.slice(0, 1)}** ** **${n.slice(-2)}`;
}
