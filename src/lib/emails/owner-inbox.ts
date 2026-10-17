/** Default ops inbox when OWNER_EMAIL is not set in env. */
export const DEFAULT_OWNER_EMAIL = "truekinspection@gmail.com";

function parseOwnerList(raw: string | undefined): string[] {
  const source = raw?.trim() ? raw : DEFAULT_OWNER_EMAIL;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of source.split(",")) {
    const email = part.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/**
 * Owner / ops inboxes from env (comma-separated), falling back to TrueK Gmail.
 * Example: OWNER_EMAIL=truekinspection@gmail.com,admin@example.com
 */
export function getOwnerEmails(): string[] {
  return parseOwnerList(process.env.OWNER_EMAIL);
}

/** Primary owner inbox (first entry). */
export function getOwnerEmail(): string {
  return getOwnerEmails()[0] ?? DEFAULT_OWNER_EMAIL;
}

/** @deprecated Prefer always sending owner copies via getOwnerEmails(). */
export function shouldSendOwnerCopy(_customerEmail: string): boolean {
  return getOwnerEmails().length > 0;
}
