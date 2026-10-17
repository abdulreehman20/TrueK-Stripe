import { NextRequest, NextResponse } from "next/server";
import { clearVinReport, type ReportFormat } from "@/lib/clearvin/client";
import { jsonClearVinRouteError } from "@/lib/clearvin/route-response";
import { fulfillCheckoutSession } from "@/lib/fulfill-checkout-session";
import { getVinValidationError } from "@/lib/vin-validation";

function parseFormat(raw: string | null): ReportFormat | null {
  if (raw === "html" || raw === "pdf") return raw;
  return null;
}

function errorRedirect(req: NextRequest, message: string) {
  const url = new URL("/error", req.url);
  url.searchParams.set("message", message);
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
      return errorRedirect(req, result.message);
    }
    const preview = new URL("/report-preview", req.url);
    preview.searchParams.set("token", result.token);
    preview.searchParams.set("vin", result.vin);
    return NextResponse.redirect(preview);
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
