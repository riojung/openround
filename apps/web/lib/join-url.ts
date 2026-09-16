const loopbackNames = new Set(["localhost", "::1", "[::1]", "0.0.0.0"]);

export function normalizeJoinBase(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isLoopbackJoinBase(value: string) {
  const base = normalizeJoinBase(value);
  if (!base) return true;
  const hostname = new URL(base).hostname.toLocaleLowerCase("en-CA");
  return (
    loopbackNames.has(hostname) || hostname.endsWith(".localhost") || hostname.startsWith("127.")
  );
}

export function selectJoinBase(input: {
  configured?: string;
  current?: string;
  saved?: string | null;
}) {
  const saved = input.saved ? normalizeJoinBase(input.saved) : null;
  if (saved) return saved;

  const configured = input.configured ? normalizeJoinBase(input.configured) : null;
  const current = input.current ? normalizeJoinBase(input.current) : null;
  if (configured && !isLoopbackJoinBase(configured)) return configured;
  if (current && !isLoopbackJoinBase(current)) return current;
  return configured ?? current ?? "";
}

export function buildJoinUrl(base: string, code: string) {
  const normalized = normalizeJoinBase(base);
  return normalized ? `${normalized}/join?code=${encodeURIComponent(code)}` : "";
}
