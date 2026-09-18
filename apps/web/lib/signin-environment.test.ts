import { describe, expect, it } from "vitest";
import { resolveSignInEnvironment } from "./signin-environment";

describe("sign-in environment", () => {
  it("detects when the browser and configured cookie origin differ", () => {
    expect(
      resolveSignInEnvironment(
        "http://192.168.1.142:8080",
        "http://localhost:8080/signin?returnTo=%2Faccount",
      ),
    ).toEqual({
      configuredOrigin: "http://192.168.1.142:8080",
      configuredSignInUrl: "http://192.168.1.142:8080/signin?returnTo=%2Faccount",
      currentOrigin: "http://localhost:8080",
      originMismatch: true,
    });
  });

  it("does not warn when the browser already uses the configured origin", () => {
    expect(
      resolveSignInEnvironment(
        "https://rounds.example.ca",
        "https://rounds.example.ca/signin?workspaceId=workspace-1",
      ),
    ).toMatchObject({
      configuredSignInUrl: "https://rounds.example.ca/signin?workspaceId=workspace-1",
      originMismatch: false,
    });
  });

  it("rejects unusable configured schemes and malformed locations", () => {
    expect(resolveSignInEnvironment("ftp://example.ca", "http://localhost:8080/signin")).toBeNull();
    expect(resolveSignInEnvironment("not a URL", "http://localhost:8080/signin")).toBeNull();
  });
});
