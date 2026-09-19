import { describe, expect, it } from "vitest";
import type { FollowupSnapshot } from "@openround/contracts";
import { followupStatusAnnouncement } from "./followup-announcement";

function snapshot(patch: Partial<FollowupSnapshot>): FollowupSnapshot {
  return {
    purpose: "recovery",
    status: "in_progress",
    phase: "question_open",
    questionIndex: 0,
    questionCount: 3,
    ...patch,
  } as FollowupSnapshot;
}

describe("follow-up status announcement", () => {
  it("announces only the meaningful loading and phase state", () => {
    expect(followupStatusAnnouncement(null)).toBe("Opening your private practice.");
    expect(followupStatusAnnouncement(snapshot({ questionIndex: 1 }))).toBe(
      "Question 2 of 3: ready for your response.",
    );
    expect(followupStatusAnnouncement(snapshot({ phase: "answer_reveal", questionIndex: 1 }))).toBe(
      "Question 2 of 3: feedback available.",
    );
    expect(followupStatusAnnouncement(snapshot({ status: "completed", phase: "completed" }))).toBe(
      "Follow-up complete.",
    );
    expect(
      followupStatusAnnouncement(
        snapshot({ purpose: "assignment", status: "completed", phase: "completed" }),
      ),
    ).toBe("Practice complete.");
  });
});
