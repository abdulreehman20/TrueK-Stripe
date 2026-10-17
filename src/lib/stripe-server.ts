import Stripe from "stripe";

let stripeSingleton: Stripe | null = null;

/** Server-only Stripe SDK. Do not import from client components. */
export function getStripeServer(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(key);
  }
  return stripeSingleton;
}
