import { describe, expect, it, vi } from "vitest";
import {
  createdPackPractice,
  packPracticeIds,
  publishedPracticePack,
} from "../test-utils/recovery-pack-practice";
import {
  createPackPracticeCreation,
  packPracticeAccessSeed,
  packPracticeAssignmentHref,
  packPracticeDates,
  packPracticeUnavailableReason,
  type PackPracticeAssignmentInput,
} from "./recovery-pack-practice";

function input(): PackPracticeAssignmentInput {
  return {
    sourcePackVersionId: packPracticeIds.version,
    mutationId: "10000000-0000-4000-8000-000000000012",
    accessSeed: "a".repeat(43),
    title: "Frozen delayed practice",
    timeMode: "flex",
    opensAt: "2026-10-08T12:00:00.000Z",
    closesAt: "2026-10-14T12:00:00.000Z",
    personalLabels: ["Learner A"],
  };
}

describe("Pack delayed-probe assignment foundations", () => {
  it("requires a published delayed probe, both rollout gates, editor access, and followups", () => {
    const options = {
      version: publishedPracticePack(),
      recoveryPacksEnabled: true,
      practiceAssignmentsEnabled: true,
      canEdit: true,
      followups: true,
    };
    expect(packPracticeUnavailableReason(options)).toBeNull();
    expect(
      packPracticeUnavailableReason({
        ...options,
        version: publishedPracticePack(false),
        mode: "full_sequence",
      }),
    ).toBeNull();
    expect(
      packPracticeUnavailableReason({ ...options, version: publishedPracticePack(false) }),
    ).toContain("diagnostic and recheck are not substitutes");
    expect(packPracticeUnavailableReason({ ...options, version: null })).toContain("Publish");
    for (const field of [
      "recoveryPacksEnabled",
      "practiceAssignmentsEnabled",
      "canEdit",
      "followups",
    ] as const) {
      expect(packPracticeUnavailableReason({ ...options, [field]: false })).toBeTypeOf("string");
    }
  });

  it("generates a 256-bit base64url seed only when invoked and keeps source links seed-free", () => {
    const seed = packPracticeAccessSeed();
    expect(seed).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(seed, "base64url")).toHaveLength(32);
    const href = packPracticeAssignmentHref(packPracticeIds.pack, packPracticeIds.version);
    expect(href).toContain(`version=${packPracticeIds.version}`);
    expect(href).not.toContain(seed);
    expect(href).not.toContain("accessSeed");
  });

  it("bounds the scheduled dates and preserves flex opening omission", () => {
    const dates = {
      opensLater: false,
      opensAt: "2026-10-08T12:00:00.000Z",
      closesAt: "2026-10-14T12:00:00.000Z",
      maxClosesAt: "2026-11-07T12:00:00.000Z",
      now: new Date("2026-10-07T12:00:00.000Z"),
    };
    expect(packPracticeDates(dates)).toEqual({ closesAt: dates.closesAt });
    expect(packPracticeDates({ ...dates, opensLater: true })).toEqual({
      opensAt: dates.opensAt,
      closesAt: dates.closesAt,
    });
    expect(() => packPracticeDates({ ...dates, closesAt: "2026-11-08T12:00:00.000Z" })).toThrow(
      "retention window",
    );
    expect(() =>
      packPracticeDates({ ...dates, opensLater: true, opensAt: "2026-10-06T12:00:00.000Z" }),
    ).toThrow("retention window");
    expect(() => packPracticeDates({ ...dates, closesAt: "" })).toThrow("retention window");
  });

  it("retains the exact private payload through lost ACK, gate pause, and rate limits", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Lost acknowledgement"))
      .mockRejectedValueOnce({ status: 403, code: "FEATURE_UNAVAILABLE" })
      .mockRejectedValueOnce({ status: 503, code: "DEPENDENCY_UNAVAILABLE" })
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce(createdPackPractice());
    const onState = vi.fn();
    const recovery = createPackPracticeCreation({ execute, onState });
    const original = input();
    const factory = vi.fn(() => original);
    await expect(recovery.run(factory)).rejects.toThrow("Lost acknowledgement");
    original.sourcePackVersionId = "replacement";
    original.accessSeed = "replacement-secret";
    original.personalLabels.push("New label");
    original.closesAt = "2026-11-01T12:00:00.000Z";
    await recovery.run(factory);
    expect(factory).toHaveBeenCalledTimes(1);
    await expect(recovery.retry()).rejects.toMatchObject({ status: 403 });
    await expect(recovery.retry()).rejects.toMatchObject({ status: 503 });
    await expect(recovery.retry()).rejects.toMatchObject({ status: 429 });
    expect(recovery.state()).toEqual({ busy: false, pending: true, created: null });
    expect(JSON.stringify(onState.mock.calls)).not.toContain("accessSeed");
    expect(JSON.stringify(onState.mock.calls)).not.toContain("a".repeat(43));
    expect(await recovery.retry()).toEqual(createdPackPractice());
    expect(execute.mock.calls.every(([body]) => body === execute.mock.calls[0]![0])).toBe(true);
    expect(JSON.parse(execute.mock.calls.at(-1)![0] as string)).toEqual(input());
    expect(recovery.state().pending).toBe(false);
  });

  it("fences parallel submits synchronously without claiming a receipt before ACK", async () => {
    let resolve!: (created: ReturnType<typeof createdPackPractice>) => void;
    const execute = vi.fn(
      () =>
        new Promise<ReturnType<typeof createdPackPractice>>((done) => {
          resolve = done;
        }),
    );
    const recovery = createPackPracticeCreation({ execute, onState: () => undefined });
    const factory = vi.fn(input);
    const pending = recovery.run(factory);
    await recovery.run(factory);
    await recovery.retry();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(recovery.state()).toEqual({ busy: true, pending: true, created: null });
    resolve(createdPackPractice());
    await pending;
    await recovery.run(factory);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(recovery.state().created?.followup.checkpointCount).toBe(1);
  });

  it("requires a new explicit review after a definitive source conflict", async () => {
    const recovery = createPackPracticeCreation({
      execute: async () => {
        throw { status: 409, code: "CONFLICT" };
      },
      onState: () => undefined,
    });
    await expect(recovery.run(input)).rejects.toMatchObject({ status: 409 });
    expect(recovery.state()).toEqual({ busy: false, pending: false, created: null });
    expect(await recovery.retry()).toBeUndefined();
  });
  it("unlocks rejected 422 settings and creates a new mutation only on explicit submit", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce({ status: 422, code: "ANSWER_INVALID" })
      .mockResolvedValueOnce(createdPackPractice());
    const recovery = createPackPracticeCreation({ execute, onState: () => undefined });
    const factory = vi.fn(input);
    await expect(recovery.run(factory)).rejects.toMatchObject({ status: 422 });
    expect(recovery.state()).toEqual({ busy: false, pending: false, created: null });
    expect(await recovery.retry()).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledTimes(1);

    const corrected = {
      ...input(),
      mutationId: "10000000-0000-4000-8000-000000000013",
      closesAt: "2026-10-15T12:00:00.000Z",
    };
    expect(await recovery.run(() => corrected)).toEqual(createdPackPractice());
    expect(JSON.parse(execute.mock.calls[1]![0] as string)).toEqual(corrected);
    expect(recovery.state().pending).toBe(false);
  });
});
