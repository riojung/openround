import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("locale redirect bridge", () => {
  it("sets a validated locale on the web origin before redirecting locally", () => {
    const response = GET(
      new NextRequest(
        "https://app.openround.example/auth/locale?locale=ja-JP&returnTo=%2Fhome%3Fwelcome%3D1",
      ),
    );

    expect(response.headers.get("location")).toBe("https://app.openround.example/home?welcome=1");
    expect(response.cookies.get("openround-locale")?.value).toBe("ja-JP");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("does not set unsupported locales or allow external redirects", () => {
    const response = GET(
      new NextRequest(
        "https://app.openround.example/auth/locale?locale=not-real&returnTo=https%3A%2F%2Fevil.example",
      ),
    );

    expect(response.headers.get("location")).toBe("https://app.openround.example/dashboard");
    expect(response.cookies.get("openround-locale")).toBeUndefined();
  });

  it("rejects control-character paths that URL parsing could reinterpret as a host", () => {
    const response = GET(
      new NextRequest(
        "https://app.openround.example/auth/locale?locale=de-DE&returnTo=%2F%09%2Fevil.example",
      ),
    );

    expect(response.headers.get("location")).toBe("https://app.openround.example/dashboard");
  });
});
