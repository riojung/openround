import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("API request credentials", () => {
  it("retains authenticated defaults while honoring explicit credential isolation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetch);
    await apiFetch("/v1/auth/me");
    await apiFetch("/v1/presentation-sessions/session/companion", {
      credentials: "omit",
      headers: { authorization: "Bearer scoped-pass" },
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      credentials: "omit",
      headers: { authorization: "Bearer scoped-pass" },
    });
  });
});
