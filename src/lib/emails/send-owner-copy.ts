import type { Resend } from "resend";
import { getOwnerEmails } from "./owner-inbox";
import { getResendFrom } from "./resend-config";

type OwnerCopyPayload = {
  subject: string;
  html: string;
  /** Customer email — used for reply-to. */
  customerEmail: string;
  logContext: string;
};

/**
 * Sends an internal copy to every OWNER_EMAIL address after a customer-facing email.
 * Supports comma-separated OWNER_EMAIL values (owner + admin).
 */
export async function sendOwnerCopy(
  resend: Resend,
  payload: OwnerCopyPayload,
): Promise<void> {
  const owners = getOwnerEmails();
  if (owners.length === 0) {
    console.warn(
      `[${payload.logContext}] OWNER_EMAIL not set; skipping owner copy`,
    );
    return;
  }

  const customerEmail = payload.customerEmail.trim();
  const from = getResendFrom();

  for (const owner of owners) {
    try {
      await resend.emails.send({
        from,
        to: owner,
        replyTo: customerEmail || undefined,
        subject: payload.subject,
        html: payload.html,
      });
      console.info(
        `[${payload.logContext}] owner copy sent to ${owner}`,
      );
    } catch (e) {
      console.error(
        `[${payload.logContext}] owner notification email failed (${owner})`,
        e,
      );
    }
  }
}
