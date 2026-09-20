import { describe, expect, it } from "vitest";
import nextConfig from "../next.config.js";

describe("web build provenance", () => {
  it("publishes the build-time candidate marker on every route", async () => {
    expect(nextConfig.headers).toBeTypeOf("function");
    const rules = await nextConfig.headers!();
    const globalRule = rules.find((rule) => rule.source === "/(.*)");
    const buildHeader = globalRule?.headers.find(
      (header) => header.key.toLowerCase() === "x-openround-build-id",
    );

    expect(buildHeader?.value).toBe(process.env.OPENROUND_BUILD_ID?.trim() || "unversioned");
  });
});
