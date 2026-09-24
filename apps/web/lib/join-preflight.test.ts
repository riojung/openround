import { describe, expect, it } from "vitest";
import {
  beginJoinPreflight,
  completeJoinPreflight,
  failJoinPreflight,
  idleJoinPreflightState,
  joinArtifactFor,
  nicknameForJoin,
  shouldCollectJoinNickname,
} from "./join-preflight";

describe("join preflight state", () => {
  it("uses only the latest request result", () => {
    const first = beginJoinPreflight("1234567", 1);
    const latest = beginJoinPreflight("7654321", 2);

    expect(
      completeJoinPreflight(latest, first.requestId, { nicknamePolicy: "friendly_only" }),
    ).toBe(latest);
    expect(
      completeJoinPreflight(latest, latest.requestId, {
        nicknamePolicy: "custom",
        artifactType: "presentation",
        destination: "/join",
      }),
    ).toMatchObject({
      code: "7654321",
      status: "ready",
      nicknamePolicy: "custom",
      artifactType: "presentation",
      destination: "/join",
    });
  });

  it("omits a nickname for a confirmed friendly-alias room", () => {
    const ready = completeJoinPreflight(beginJoinPreflight("1234567", 1), 1, {
      nicknamePolicy: "friendly_only",
    });

    expect(shouldCollectJoinNickname(ready, "1234567")).toBe(false);
    expect(nicknameForJoin(ready, "1234567", "Must not be sent")).toBeUndefined();
    expect(shouldCollectJoinNickname(ready, "7654321")).toBe(true);
  });

  it("keeps nickname submission available when preflight fails", () => {
    const failed = failJoinPreflight(
      beginJoinPreflight("1234567", 3),
      3,
      "Could not check this code",
    );

    expect(failed).toMatchObject({ status: "failed", nicknamePolicy: null });
    expect(shouldCollectJoinNickname(failed, "1234567")).toBe(true);
    expect(nicknameForJoin(failed, "1234567", "  Learner  ")).toBe("Learner");
    expect(nicknameForJoin(idleJoinPreflightState, "1234567", "   ")).toBeUndefined();
  });

  it("selects the Presentation flow only for the matching resolved code", () => {
    const ready = completeJoinPreflight(beginJoinPreflight("1234567", 4), 4, {
      nicknamePolicy: "custom",
      artifactType: "presentation",
      destination: "/join",
    });

    expect(joinArtifactFor(ready, "1234567")).toBe("presentation");
    expect(joinArtifactFor(ready, "7654321")).toBe("round");
    expect(shouldCollectJoinNickname(ready, "1234567")).toBe(true);
  });
});
