// Client-side mirror of the server's Cameroon number checks, so customers get instant feedback.
// The server repeats every check; this only saves a round trip.

export function localNumber(input) {
  let d = String(input || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("237") && d.length === 12) d = d.slice(3);
  return /^6[0-9]{8}$/.test(d) ? d : null;
}

export function operatorOf(local) {
  if (!local) return null;
  const p2 = local.slice(0, 2);
  const p3 = Number(local.slice(0, 3));
  if (p2 === "67" || (p3 >= 650 && p3 <= 654) || (p3 >= 680 && p3 <= 683)) return "mtn";
  if (p2 === "69" || (p3 >= 655 && p3 <= 659) || (p3 >= 686 && p3 <= 689)) return "orange";
  return null;
}

/** Error message for a payer number, or "" when it can be used with this method. */
export function momoNumberError(method, phone) {
  const local = localNumber(phone);
  if (!local) return "Enter a valid Cameroon mobile number (9 digits starting with 6).";
  const op = operatorOf(local);
  if (method === "mtn_momo" && op === "orange") return "This is an Orange number. Choose Orange Money or enter an MTN number.";
  if (method === "orange_money" && op === "mtn") return "This is an MTN number. Choose MTN Mobile Money or enter an Orange number.";
  return "";
}

/** Where to send the customer after starting a payment. */
export function afterInitiate(navigate, data) {
  if (data.checkoutUrl) window.location.assign(data.checkoutUrl);
  else navigate(`/payment/return?reference=${encodeURIComponent(data.reference)}`);
}
