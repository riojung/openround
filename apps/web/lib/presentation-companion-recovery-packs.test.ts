import { afterEach, describe, expect, it, vi } from "vitest";
import {
  companionCommandRetryMessageKey,
  fetchPresentationCompanionRecoveryPacks,
} from "./presentation-companion-recovery-packs";

const pack = {
  packId: "62fcedb6-43b3-4c05-8035-eebafc12084b",
  packVersionId: "90d8f3e3-0f39-49cf-ae42-eb2a353f927e",
  packVersion: 2,
  title: "Contrast supported explanations",
};
afterEach(() => vi.unstubAllGlobals());

describe("Companion published Pack catalog", () => {
  it("requests scoped published metadata without creator cookies", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ packs: [pack] }) });
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchPresentationCompanionRecoveryPacks("session", "scoped-pass"),
    ).resolves.toEqual({ packs: [pack] });
    expect(fetch.mock.calls[0]?.[0]).toContain(
      "/v1/presentation-sessions/session/companion-recovery-packs",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      headers: { authorization: "Bearer scoped-pass" },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a catalog that includes unpublished bodies or answer material", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          packs: [{ ...pack, body: "Hidden card", correctChoiceId: "answer" }],
        }),
      }),
    );
    await expect(
      fetchPresentationCompanionRecoveryPacks("session", "scoped-pass"),
    ).rejects.toThrow();
  });

  it("keeps credential rejection explicit and never falls back to creator APIs", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "UNAUTHORIZED", message: "Pass revoked" } }),
    });
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchPresentationCompanionRecoveryPacks("session", "scoped-pass"),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("labels each pending action while preserving the existing advance retry", () => {
    const credential = {
      sessionId: "session",
      companionToken: "pass",
      commandId: "command",
      expectedRevision: 2,
    };
    expect(companionCommandRetryMessageKey({ ...credential, action: "advance" })).toBe(
      "live.companion.retryAck",
    );
    expect(
      companionCommandRetryMessageKey({
        ...credential,
        action: "insert_recovery_pack",
        packVersionId: pack.packVersionId,
      }),
    ).toBe("live.companion.packs.retryInsertion");
    expect(
      companionCommandRetryMessageKey({
        ...credential,
        action: "start_recovery_card",
        recoveryPackCard: { insertionId: "insertion", cardId: "card" },
        interventionType: "example",
      }),
    ).toBe("live.companion.packs.retryCard");
  });
});
