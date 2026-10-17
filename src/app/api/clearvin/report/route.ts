import { NextRequest, NextResponse } from "next/server";
import { clearVinReport, type ReportFormat } from "@/lib/clearvin/client";
import { jsonClearVinRouteError } from "@/lib/clearvin/route-response";
import { fulfillCheckoutSession } from "@/lib/fulfill-checkout-session";
import { getVinValidationError } from "@/lib/vin-validation";

function parseFormat(raw: string | null): ReportFormat | null {
  if (raw === "html" || raw === "pdf") return raw;
  return null;
}

/** Public site origin (ngrok / production), not the internal localhost behind a tunnel. */
function publicOrigin(req: NextRequest): string {
  const fromEnv = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (fromEnv) return fromEnv;

  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;

  return req.nextUrl.origin;
}

function siteRedirect(
  req: NextRequest,
  path: string,
  params?: Record<string, string>,
) {
  const url = new URL(path, `${publicOrigin(req)}/`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return NextResponse.redirect(url);
}

/**
 * GET /api/clearvin/report
 *
 * Payment Link fulfillment (Stripe After payment redirect):
 *   ?session_id={CHECKOUT_SESSION_ID}
 *
 * Legacy ClearVin proxy (account-activity re-fetch):
 *   ?vin=…&format=html|pdf  OR  ?reportId=…&format=html|pdf
 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id")?.trim();

  if (sessionId) {
    const result = await fulfillCheckoutSession(sessionId);
    if (!result.ok) {
      return siteRedirect(req, "/error", { message: result.message });
    }
    return siteRedirect(req, "/report-preview", {
      token: result.token,
      vin: result.vin,
    });
  }

  const vin = req.nextUrl.searchParams.get("vin");
  const reportId = req.nextUrl.searchParams.get("reportId");
  const formatRaw = req.nextUrl.searchParams.get("format");
  const locale = req.nextUrl.searchParams.get("locale") ?? undefined;

  const format = parseFormat(formatRaw);
  if (!format) {
    return NextResponse.json(
      { message: "Query parameter format must be html or pdf." },
      { status: 400 },
    );
  }

  const hasVin = Boolean(vin?.trim());
  const hasReportId = Boolean(reportId?.trim());
  if (hasVin === hasReportId) {
    return NextResponse.json(
      {
        message:
          "Provide exactly one of: vin (full purchase) or reportId (copy by id).",
      },
      { status: 400 },
    );
  }

  if (vin) {
    const vinError = getVinValidationError(vin);
    if (vinError) {
      return NextResponse.json({ message: vinError }, { status: 400 });
    }
  }

  try {
    const result = hasReportId
      ? await clearVinReport({
          reportId: reportId!.trim(),
          format,
          locale,
        })
      : await clearVinReport({
          vin: vin!.trim().toUpperCase(),
          format,
          locale,
        });

    if (format === "pdf") {
      return new NextResponse(result.body, {
        status: 200,
        headers: {
          "Content-Type": result.contentType ?? "application/pdf",
          ...(result.reportId ? { "X-Clearvin-Report-Id": result.reportId } : {}),
        },
      });
    }

    return new NextResponse(result.text, {
      status: 200,
      headers: {
        "Content-Type": result.contentType ?? "text/html; charset=utf-8",
        ...(result.reportId ? { "X-Clearvin-Report-Id": result.reportId } : {}),
      },
    });
  } catch (e) {
    return jsonClearVinRouteError(e);
  }
}
