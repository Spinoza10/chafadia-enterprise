import { config } from "../config.js";
import { mockProvider } from "./mock.js";
import { notchpayProvider } from "./notchpay.js";

/**
 * Payment provider interface:
 *   initiate({ payment, order })        -> { providerReference, checkoutUrl, mode: "push" | "redirect" }
 *                                          push = prompt sent to the customer's phone (they confirm with their PIN there)
 *   verifyWebhook(rawBody, headers)     -> { eventId, reference } | null when the signature is invalid
 *   fetchStatus(reference)              -> { status, amount, providerReference }
 *   refund({ payment, amount, reason }) -> { status: completed|pending|manual, providerReference }
 */
const providers = { mock: mockProvider, notchpay: notchpayProvider };

export const getProvider = (name = config.PAYMENT_PROVIDER) => {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown payment provider ${name}`);
  return provider;
};

export { mockProvider };
