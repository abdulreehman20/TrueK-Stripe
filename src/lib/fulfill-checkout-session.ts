import { randomBytes } from "crypto";
import type Stripe from "stripe";

import { clearVinReport } from "@/lib/clearvin/client";
import db from "@/lib/db";
import { createResendClient, getResendFrom } from "@/lib/emails/resend-config";
import { sendOwnerCopy } from "@/lib/emails/send-owner-copy";
import { buildReportDeliveryEmailHtml } from "@/lib/emails/templates";
import { computeReportPreviewExpiry } from "@/lib/report-preview-access";
import { getStripeServer } from "@/lib/stripe-server";
import { getVinValidationError, normalizeVin } from "@/lib/vin-validation";

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

function appOrigin(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_URL ||
    "https://www.truekinspection.com";
  return raw.replace(/\/+$/, "");
}

function splitCustomerName(displayName: string): {
  firstName: string;
  lastName: string;
} {
  const t = displayName.trim();
  if (!t) return { firstName: "Customer", lastName: "" };
  const parts = t.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
  };
}

function extractPaymentIntentId(
  paymentIntent: Stripe.Checkout.Session["payment_intent"],
): string | null {
  if (!paymentIntent) return null;
  if (typeof paymentIntent === "string") return paymentIntent;
  if (typeof paymentIntent === "object" && "id" in paymentIntent) {
    return paymentIntent.id;
  }
  return null;
}

function extractVinFromSession(session: Stripe.Checkout.Session): string | null {
  const field = session.custom_fields?.find((f) => f.key === "vin_number");
  const raw = field?.text?.value?.trim();
  return raw ? normalizeVin(raw) : null;
}

export type FulfillCheckoutResult =
  | { ok: true; token: string; vin: string }
  | {
      ok: false;
      reason:
        | "missing_session"
        | "unpaid"
        | "missing_data"
        | "invalid_vin"
        | "clearvin"
        | "store";
      message: string;
    };

/**
 * Shared Payment Link fulfillment: retrieve Checkout Session, fetch ClearVin
 * report, persist token + payment, send emails. Idempotent on Stripe session id.
 */
export async function fulfillCheckoutSession(
  sessionId: string,
): Promise<FulfillCheckoutResult> {
  const id = sessionId.trim();
  if (!id) {
    return {
      ok: false,
      reason: "missing_session",
      message: "Missing checkout session id.",
    };
  }

  const existing = await db.reportPreviewToken.findUnique({
    where: { stripeSessionId: id },
    select: { token: true, vin: true, expiresAt: true },
  });
  if (existing) {
    if (existing.expiresAt < new Date()) {
      return {
        ok: false,
        reason: "missing_data",
        message:
          "This report link has expired (valid for 30 days from purchase).",
      };
    }
    return { ok: true, token: existing.token, vin: existing.vin };
  }

  let session: Stripe.Checkout.Session;
  try {
    const stripe = getStripeServer();
    session = await stripe.checkout.sessions.retrieve(id, {
      expand: ["payment_intent"],
    });
  } catch (e) {
    console.error("[fulfillCheckoutSession] retrieve session", e);
    return {
      ok: false,
      reason: "missing_session",
      message: "Could not retrieve checkout session from Stripe.",
    };
  }

  if (session.payment_status !== "paid") {
    return {
      ok: false,
      reason: "unpaid",
      message: `Payment is not complete (status: ${session.payment_status}).`,
    };
  }

  const name = session.customer_details?.name?.trim() || "";
  const email = session.customer_details?.email?.trim() || "";
  const vin = extractVinFromSession(session);
  const transactionId = extractPaymentIntentId(session.payment_intent);
  const amountCents = session.amount_total;

  if (!name || !email || !vin || !transactionId || amountCents == null) {
    return {
      ok: false,
      reason: "missing_data",
      message:
        "Checkout session is missing name, email, VIN, transaction id, or amount.",
    };
  }

  const amountPaid = amountCents / 100;

  const vinError = getVinValidationError(vin);
  if (vinError) {
    return { ok: false, reason: "invalid_vin", message: vinError };
  }

  let reportHtml: string;
  let reportIdStr: string | null;
  try {
    const report = await clearVinReport({ vin, format: "html" });
    reportHtml = report.text?.trim() ?? "";
    reportIdStr = report.reportId?.trim() || null;
    if (!reportHtml) {
      return {
        ok: false,
        reason: "clearvin",
        message: "Empty report received from ClearVin.",
      };
    }
  } catch (e) {
    console.error("[fulfillCheckoutSession] ClearVin:", e);
    return {
      ok: false,
      reason: "clearvin",
      message: "Could not fetch the ClearVin report. Please contact support.",
    };
  }

  const { firstName, lastName } = splitCustomerName(name);
  const token = generateToken();
  const expiresAt = computeReportPreviewExpiry();

  try {
    await db.$transaction(
      async (tx) => {
        await tx.reportPreviewToken.create({
          data: {
            token,
            html: reportHtml,
            vin,
            clearvinReportId: reportIdStr,
            stripeSessionId: id,
            expiresAt,
          },
        });
        await tx.payment.upsert({
          where: { orderID: transactionId },
          create: {
            firstName,
            lastName,
            email,
            plan: `Vehicle History Report — $${amountPaid.toFixed(2)}`,
            orderID: transactionId,
            status: "COMPLETED",
          },
          update: {
            firstName,
            lastName,
            email,
            plan: `Vehicle History Report — $${amountPaid.toFixed(2)}`,
            status: "COMPLETED",
          },
        });
      },
      { maxWait: 20_000, timeout: 30_000 },
    );
  } catch (e) {
    // Concurrent fulfillment: unique stripeSessionId — return the winner.
    const raced = await db.reportPreviewToken.findUnique({
      where: { stripeSessionId: id },
      select: { token: true, vin: true, expiresAt: true },
    });
    if (raced && raced.expiresAt >= new Date()) {
      return { ok: true, token: raced.token, vin: raced.vin };
    }
    console.error("[fulfillCheckoutSession] DB transaction failed", e);
    return {
      ok: false,
      reason: "store",
      message: "We could not save your order. Please contact support.",
    };
  }

  const origin = appOrigin();
  const reportUrl = `${origin}/report-preview?token=${encodeURIComponent(token)}&vin=${encodeURIComponent(vin)}`;
  const resend = createResendClient();
  const from = getResendFrom();
  const customerLabel =
    [firstName, lastName].filter(Boolean).join(" ").trim() || "Customer";

  if (resend) {
    const emailHtml = buildReportDeliveryEmailHtml({
      customerName: customerLabel,
      reportUrl,
      vin,
      reportId: reportIdStr,
      transactionId,
      customerEmail: email,
    });

    try {
      await resend.emails.send({
        from,
        to: email,
        subject: "Your vehicle history report — TrueK Inspection",
        html: emailHtml,
      });
    } catch (e) {
      console.error("[fulfillCheckoutSession] customer report email", e);
    }

    await sendOwnerCopy(resend, {
      customerEmail: email,
      subject: `[TrueK] Purchase complete — ${vin}`,
      html: buildReportDeliveryEmailHtml({
        customerName: customerLabel,
        reportUrl,
        vin,
        reportId: reportIdStr,
        transactionId,
        customerEmail: email,
        forOwner: true,
      }),
      logContext: "fulfillCheckoutSession",
    });
  } else {
    console.warn(
      "[fulfillCheckoutSession] RESEND_API_KEY not set; skipping emails.",
    );
  }

  void db.reportPreviewToken
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});

  return { ok: true, token, vin };
}
