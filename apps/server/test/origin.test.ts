import { describe, expect, it } from "vitest";
import { originAllowed } from "../src/origin.js";

describe("browser origin authorization", () => {
  it("allows the configured cross-origin web application", () => {
    expect(
      originAllowed({
        origin: "https://app.example.ca",
        host: "api.example.ca",
        forwardedProto: "https",
        configuredOrigin: "https://app.example.ca",
      }),
    ).toBe(true);
  });

  it("allows a same-origin LAN request routed through the local reverse proxy", () => {
    expect(
      originAllowed({
        origin: "http://192.168.1.20:8080",
        host: "192.168.1.20:8080",
        forwardedProto: "http",
        configuredOrigin: "http://localhost:8080",
      }),
    ).toBe(true);
  });

  it("rejects an unrelated browser origin and protocol mismatch", () => {
    expect(
      originAllowed({
        origin: "https://attacker.example",
        host: "quiz.example.ca",
        forwardedProto: "https",
        configuredOrigin: "https://app.example.ca",
      }),
    ).toBe(false);
    expect(
      originAllowed({
        origin: "http://quiz.example.ca",
        host: "quiz.example.ca",
        forwardedProto: "https",
        configuredOrigin: "https://app.example.ca",
      }),
    ).toBe(false);
  });
});
