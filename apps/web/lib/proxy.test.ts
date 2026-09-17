import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "../proxy";

describe("browser security policy", () => {
  it("cannot be downgraded by a forwarded HTTP header on an HTTPS request", () => {
    const request = new NextRequest("https://quiz.example.ca/", {
      headers: { "x-forwarded-proto": "http" },
    });

    const policy = proxy(request).headers.get("content-security-policy");

    expect(policy).toContain("connect-src 'self' https: wss:");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("keeps explicitly allowed private-network HTTP resources usable", () => {
    const request = new NextRequest("http://192.168.1.10:8080/");

    const policy = proxy(request).headers.get("content-security-policy");

    expect(policy).toContain("connect-src 'self' http: https: ws: wss:");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("uses the trusted proxy protocol when the internal request URL is HTTP", () => {
    const request = new NextRequest("http://web:3000/", {
      headers: { "x-forwarded-proto": "https" },
    });

    const policy = proxy(request).headers.get("content-security-policy");

    expect(policy).toContain("connect-src 'self' https: wss:");
    expect(policy).toContain("upgrade-insecure-requests");
  });
});
