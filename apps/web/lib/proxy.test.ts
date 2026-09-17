import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "../proxy";

describe("browser security policy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("cannot be downgraded by a forwarded HTTP header on an HTTPS request", async () => {
    const request = new NextRequest("https://quiz.example.ca/", {
      headers: { "x-forwarded-proto": "http" },
    });

    const policy = (await proxy(request)).headers.get("content-security-policy");

    expect(policy).toContain("connect-src 'self' https: wss:");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("keeps explicitly allowed private-network HTTP resources usable", async () => {
    const request = new NextRequest("http://192.168.1.10:8080/");

    const policy = (await proxy(request)).headers.get("content-security-policy");

    expect(policy).toContain("connect-src 'self' http: https: ws: wss:");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("uses the trusted proxy protocol when the internal request URL is HTTP", async () => {
    const request = new NextRequest("http://web:3000/", {
      headers: { "x-forwarded-proto": "https" },
    });

    const policy = (await proxy(request)).headers.get("content-security-policy");

    expect(policy).toContain("connect-src 'self' https: wss:");
    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("allows only validated workspace origins on the dedicated embed route", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        allowedOrigins: [
          "https://lms.example.edu",
          "http://insecure.example.edu",
          "https://slides.example.org/path",
        ],
      }),
    );
    const request = new NextRequest(
      "https://quiz.example.ca/embed/present/4cb2ba20-2a64-4c68-a4f9-375acf8b9a4a/policy-key-that-is-long-enough",
    );

    const policy = (await proxy(request)).headers.get("content-security-policy");

    expect(policy).toContain("frame-ancestors https://lms.example.edu");
    expect(policy).not.toContain("insecure.example.edu");
    expect(policy).not.toContain("slides.example.org/path");
  });

  it("fails closed when an embed policy cannot be loaded", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const request = new NextRequest(
      "https://quiz.example.ca/embed/present/4cb2ba20-2a64-4c68-a4f9-375acf8b9a4a/policy-key-that-is-long-enough",
    );

    const policy = (await proxy(request)).headers.get("content-security-policy");

    expect(policy).toContain("frame-ancestors 'none'");
  });
});
