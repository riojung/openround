import { LocalReturnPathSchema, SupportedLocaleSchema } from "@openround/contracts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { LOCALE_COOKIE_MAX_AGE_SECONDS, LOCALE_COOKIE_NAME } from "../../../lib/i18n/config";

function safeReturnPath(value: string | null) {
  const parsed = LocalReturnPathSchema.safeParse(value);
  return parsed.success ? parsed.data : "/dashboard";
}

export function GET(request: NextRequest) {
  const locale = SupportedLocaleSchema.safeParse(request.nextUrl.searchParams.get("locale"));
  // Keep this redirect relative so the browser preserves the exact public host that received
  // the bridge request. Next's development server can canonicalize `nextUrl.origin` to
  // `localhost`, which otherwise drops host-bound auth cookies when the app was opened through
  // `127.0.0.1` or a LAN address. `safeReturnPath` only returns a validated local path.
  const response = new NextResponse(null, {
    status: 307,
    headers: { location: safeReturnPath(request.nextUrl.searchParams.get("returnTo")) },
  });
  if (locale.success) {
    response.cookies.set(LOCALE_COOKIE_NAME, locale.data, {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}
