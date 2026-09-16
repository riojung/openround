type HeaderValue = string | string[] | undefined;

function firstHeader(value: HeaderValue) {
  return Array.isArray(value) ? value[0] : value?.split(",", 1)[0]?.trim();
}

function normalizedOrigin(value: string) {
  try {
    return new URL(value).origin.toLocaleLowerCase("en-CA");
  } catch {
    return null;
  }
}

export function originAllowed(input: {
  origin: string | undefined;
  host: HeaderValue;
  forwardedProto: HeaderValue;
  encrypted?: boolean;
  configuredOrigin: string;
}) {
  if (!input.origin) return true;

  const origin = normalizedOrigin(input.origin);
  const configuredOrigin = normalizedOrigin(input.configuredOrigin);
  if (!origin) return false;
  if (configuredOrigin && origin === configuredOrigin) return true;

  const host = firstHeader(input.host)?.toLocaleLowerCase("en-CA");
  if (!host) return false;
  const protocol = firstHeader(input.forwardedProto)?.toLocaleLowerCase("en-CA");
  const requestOrigin = `${protocol ?? (input.encrypted ? "https" : "http")}://${host}`;
  return origin === requestOrigin;
}
