<!-- Stripe Pay Link Integration Guide -->

# First Guide

Yes, this flow is fully supported. Here's the recommended approach:

**1. Set up a webhook to detect successful payments**

Listen for the `checkout.session.completed` event. For delayed payment methods (e.g. bank debits), also listen for `checkout.session.async_payment_succeeded`.

Configure your webhook endpoint in the [Stripe Dashboard](https://dashboard.stripe.com/webhooks).

**2. Redirect users back to your site**

In your Payment Link settings, go to **After payment** → select **Don't show confirmation page** → provide your redirect URL, optionally including `{CHECKOUT_SESSION_ID}`:

```
https://yoursite.com/success?session_id={CHECKOUT_SESSION_ID}
```

Stripe replaces `{CHECKOUT_SESSION_ID}` with the actual session ID on redirect.

**3. Retrieve payment and customer data on your server**

When your webhook fires or the user lands on your success page, retrieve the Checkout Session to access all data:

```bash
stripe checkout sessions retrieve cs_test_xxx --expand line_items
```

The session object contains:
- `customer_details.name` and `customer_details.email`
- `custom_fields` (if you configured them on the Payment Link)
- `payment_status` — check this is `paid` before fulfilling
- `metadata` — any metadata you set on the Payment Link (see the "Set metadata indirectly" section on this page for how to propagate metadata to the underlying PaymentIntent or Subscription)

**4. Verify payment on your server (don't trust the redirect alone)**

Always confirm payment via the webhook, not just the redirect — a user could lose internet connection before returning to your site. Your fulfillment logic should be triggered by the webhook event.

See [Fulfill orders after a customer pays](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted) and [After a payment link payment](https://docs.stripe.com/payment-links/post-payment) for full implementation details.

---

# Second Guide

Here's a complete step-by-step guide for integrating your Payment Link with Next.js.

## 1. Configure your Payment Link

In the Stripe Dashboard on your Payment Link:

- Add a **custom field** for the VIN number (Text type, label "VIN Number", key `vin_number`)
- Under **After payment**, set the redirect URL to:
  ```
  https://yoursite.com/success?session_id={CHECKOUT_SESSION_ID}
  ```
- Enable **Collect customers' billing/shipping details** so name and email are always captured

---

## 2. Project setup

Install dependencies:

```bash
npm install stripe
```

Add to your `.env.local`:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

---

## 3. Success page — `/app/success/page.tsx`

This is where Stripe redirects the user after payment. It fetches the session and displays confirmation:

```tsx
// app/success/page.tsx
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: { session_id?: string };
}) {
  const sessionId = searchParams.session_id;

  if (!sessionId) return <p>Invalid session.</p>;

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent', 'customer'],
  });

  if (session.payment_status !== 'paid') {
    return <p>Payment not completed.</p>;
  }

  const name = session.customer_details?.name;
  const email = session.customer_details?.email;
  const vin = session.custom_fields?.find(f => f.key === 'vin_number')?.text?.value;
  const transactionId =
    typeof session.payment_intent === 'object'
      ? session.payment_intent?.id
      : session.payment_intent;
  const amountPaid = session.amount_total; // in cents

  return (
    <div>
      <h1>Payment successful!</h1>
      <p>Name: {name}</p>
      <p>Email: {email}</p>
      <p>VIN: {vin}</p>
      <p>Transaction ID: {transactionId}</p>
      <p>Amount paid: ${(amountPaid! / 100).toFixed(2)}</p>
    </div>
  );
}
```

> ⚠️ **Do not trigger fulfillment (report generation, email sending) here.** The user might close the browser before reaching this page. Use the webhook for fulfillment.

---

## 4. Webhook route — `/app/api/webhook/route.ts`

This is your server-side fulfillment handler. Stripe calls this endpoint directly, independent of the user's browser.

```ts
// app/api/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  const body = await req.text(); // Must be raw text, not parsed JSON
  const sig = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.payment_status !== 'paid') {
      // For async methods (e.g. bank debits), payment_status may still
      // be 'unpaid' on checkout.session.completed — wait for
      // checkout.session.async_payment_succeeded instead
      return NextResponse.json({ received: true });
    }

    // Extract all the data you need
    const name = session.customer_details?.name;
    const email = session.customer_details?.email;
    const vin = session.custom_fields?.find(f => f.key === 'vin_number')?.text?.value;
    const transactionId = session.payment_intent as string;
    const amountPaid = session.amount_total; // in cents

    console.log({ name, email, vin, transactionId, amountPaid });

    // TODO: generate report, send confirmation email, save to DB, etc.
  }

  return NextResponse.json({ received: true });
}

// IMPORTANT: disable body parsing so Stripe signature verification works
export const config = {
  api: { bodyParser: false },
};
```

---

## 5. Register your webhook endpoint

**For local development**, use the Stripe CLI:

```bash
stripe listen --forward-to localhost:3000/api/webhook
```

This prints your local `STRIPE_WEBHOOK_SECRET` — copy it to `.env.local`.

**For production**, go to the [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks) and add:
- Endpoint URL: `https://yoursite.com/api/webhook`
- Events to listen for:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`

Copy the signing secret and add it to your production environment variables.

---

## Summary of data extraction

| Data | Where to find it |
|---|---|
| Name | `session.customer_details.name` |
| Email | `session.customer_details.email` |
| VIN | `session.custom_fields` (key: `vin_number`) |
| Transaction ID | `session.payment_intent` |
| Amount paid | `session.amount_total` (cents) |

Both the success page and the webhook receive the same Checkout Session object, so extraction is identical in both places. Use the **success page** for displaying confirmation to the user, and the **webhook** for all server-side fulfillment logic.

---

# Third Guide
The good news is that Payment Links support this flow almost identically to Checkout Sessions — the session object you receive is the same. Here's what changes and what stays the same:

---

## What changes with Payment Links

- You no longer create a Checkout Session server-side — Stripe creates it automatically when the user clicks the Payment Link
- You can't pre-fill fields from your form (e.g. the VIN) — the user fills them in on the Stripe page itself
- You configure the redirect URL in the Dashboard instead of in code

Everything else — the webhook, session retrieval, data extraction — stays identical.

---

## Step-by-step implementation

**1. Configure your Payment Link in the Dashboard**

- Add custom fields for any data you need (e.g. VIN Number, key: `vin_number`)
- Set the **After payment** redirect URL to:
  ```
  https://yoursite.com/api/post-payment?session_id={CHECKOUT_SESSION_ID}
  ```

**2. Redirect the user to the Payment Link from your pricing page**

```tsx
// app/pricing/page.tsx
export default function PricingPage() {
  return (
    <a href="https://buy.stripe.com/test_14AaEZeOAdwp92I6A263K00">
      Pay now
    </a>
  );
}
```

If you need to pass data from your form (e.g. a pre-filled VIN) into the Payment Link URL, you can use [client reference ID](https://docs.stripe.com/payment-links/url-parameters) via URL parameter `?client_reference_id=your_value`, and retrieve it from `session.client_reference_id` later. However, for arbitrary fields the user must fill them in as custom fields on the Stripe page.

**3. API route that runs after payment — `/app/api/post-payment/route.ts`**

This replaces your current redirect target. It retrieves the session, fetches the report, stores it, and redirects the user to the preview page:

```ts
// app/api/post-payment/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.redirect(new URL('/error', req.url));
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent'],
  });

  // Only proceed if payment is confirmed
  if (session.payment_status !== 'paid') {
    return NextResponse.redirect(new URL('/error', req.url));
  }

  // Extract user data
  const name = session.customer_details?.name;
  const email = session.customer_details?.email;
  const vin = session.custom_fields?.find(f => f.key === 'vin_number')?.text?.value;
  const transactionId = session.payment_intent as string;
  const amountPaid = session.amount_total; // in cents

  if (!vin) {
    return NextResponse.redirect(new URL('/error', req.url));
  }

  // Fetch the car report using the VIN
  const report = await fetchCarReport(vin); // your existing logic

  // Save the report so the preview page can retrieve it
  const reportId = await saveReport({ report, name, email, vin, transactionId });

  // Send confirmation email with payment details + report link
  await sendConfirmationEmail({
    email,
    name,
    vin,
    transactionId,
    amountPaid,
    reportUrl: `https://yoursite.com/report/${reportId}`,
  });

  // Redirect to the report preview page
  return NextResponse.redirect(new URL(`/report/${reportId}`, req.url));
}
```

**4. Keep your webhook for reliability**

The redirect-based flow above works for users who complete the browser journey. But if the user closes the browser before the redirect fires, you'll miss the fulfillment. Your webhook handles that case:

```ts
// app/api/webhook/route.ts
if (
  event.type === 'checkout.session.completed' ||
  event.type === 'checkout.session.async_payment_succeeded'
) {
  const session = event.data.object as Stripe.Checkout.Session;

  if (session.payment_status !== 'paid') return NextResponse.json({ received: true });

  const vin = session.custom_fields?.find(f => f.key === 'vin_number')?.text?.value;

  // Use idempotency check to avoid double-fulfillment
  // e.g. check your DB whether this session was already fulfilled
  const alreadyFulfilled = await checkFulfilled(session.id);
  if (alreadyFulfilled) return NextResponse.json({ received: true });

  // Run the same fulfillment logic as the redirect route
  await fulfillOrder(session);
}
```

> The key point: both the redirect route and the webhook can trigger fulfillment. Use an idempotency check (e.g. storing `session.id` in your DB after first fulfillment) to ensure the report is only generated and the email only sent once.

---

## Summary of the full flow

```
Form → Pricing page → Payment Link (Stripe-hosted)
  → Stripe redirects to /api/post-payment?session_id=...
    → Retrieve session → Extract VIN/name/email
    → Fetch report → Save → Send email
    → Redirect to /report/[reportId]

  (in parallel, as a safety net)
  → Webhook: checkout.session.completed
    → Same fulfillment logic with idempotency guard
```