import { NextResponse, type NextRequest } from "next/server";

function contentSecurityPolicy(nonce: string, secureRequest: boolean, frameAncestors = "'none'") {
  const development = process.env.NODE_ENV === "development";
  const networkSchemes = secureRequest ? "https: wss:" : "http: https: ws: wss:";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: https:${secureRequest ? "" : " http:"}`,
    "font-src 'self' data:",
    `connect-src 'self' ${networkSchemes}`,
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    `frame-ancestors ${frameAncestors}`,
    "worker-src 'self' blob:",
    ...(secureRequest ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

function validHttpsOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}

async function embedFrameAncestors(request: NextRequest) {
  const match = /^\/embed\/present\/([0-9a-f-]{36})\/([A-Za-z0-9_-]{20,1000})$/.exec(
    request.nextUrl.pathname,
  );
  if (!match) return "'none'";
  const [, sessionId, policyKey] = match;
  const configuredApi = process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, "");
  const apiBase = configuredApi || request.nextUrl.origin;
  try {
    const response = await fetch(
      `${apiBase}/v1/embed/policies/${encodeURIComponent(sessionId!)}/${encodeURIComponent(policyKey!)}`,
      { cache: "no-store", headers: { accept: "application/json" } },
    );
    if (!response.ok) return "'none'";
    const body = (await response.json()) as { allowedOrigins?: unknown };
    const origins = Array.isArray(body.allowedOrigins)
      ? body.allowedOrigins.filter(validHttpsOrigin).slice(0, 10)
      : [];
    return origins.length ? origins.join(" ") : "'none'";
  } catch {
    return "'none'";
  }
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const secureRequest = forwardedProtocol === "https" || request.nextUrl.protocol === "https:";
  const frameAncestors = await embedFrameAncestors(request);
  const policy = contentSecurityPolicy(nonce, secureRequest, frameAncestors);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-openround-pathname", request.nextUrl.pathname);
  requestHeaders.set("content-security-policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
