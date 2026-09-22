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
  let destination = new URL(
    safeReturnPath(request.nextUrl.searchParams.get("returnTo")),
    request.nextUrl.origin,
  );
  if (destination.origin !== request.nextUrl.origin) {
    destination = new URL("/dashboard", request.nextUrl.origin);
  }
  const response = NextResponse.redirect(destination);
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
