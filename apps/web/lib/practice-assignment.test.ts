import { describe, expect, it } from "vitest";
import {
  defaultPracticeWindow,
  parsePersonalLabels,
  personalLabelsError,
  practiceLinksCsv,
  practicePurposeLabel,
  practiceStatus,
  type CreatedPractice,
  type PracticeRecord,
} from "./practice-assignment";

function practice(overrides: Partial<PracticeRecord> = {}): PracticeRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    purpose: "assignment",
    sourceSessionId: null,
    sourceReportId: null,
    sourceQuizVersionId: "00000000-0000-4000-8000-000000000002",
    title: "Practice: Energy isolation",
    conceptKeys: [],
    checkpointCount: 4,
    timeMode: "flex",
    opensAt: "2026-09-19T12:00:00.000Z",
    closesAt: "2026-09-26T12:00:00.000Z",
    expiresAt: "2026-10-19T12:00:00.000Z",
    closedAt: null,
    createdAt: "2026-09-19T12:00:00.000Z",
    ...overrides,
  };
}

describe("standalone practice helpers", () => {
  it("normalizes newline labels without merging different participants", () => {
    expect(parsePersonalLabels(" Ada \nLin\nada\n\n Sam Lee ")).toEqual(["Ada", "Lin", "Sam Lee"]);
    expect(personalLabelsError(Array.from({ length: 251 }, (_, index) => `Learner ${index}`))).toBe(
      "Add no more than 250 personal link labels.",
    );
    expect(personalLabelsError(["Ada", "Lin", "Sam"], 2)).toBe(
      "Add no more than 2 personal link labels.",
    );
    expect(personalLabelsError(["x".repeat(81)])).toBe(
      "Keep every personal link label to 80 characters or fewer.",
    );
  });

  it("caps the suggested close time to the retention window", () => {
    const now = new Date("2026-09-19T12:00:00.000Z");
    expect(new Date(defaultPracticeWindow(now, 30).closesAt).getTime()).toBe(
      now.getTime() + 7 * 24 * 60 * 60_000,
    );
    const shortWindow = defaultPracticeWindow(now, 2);
    expect(new Date(shortWindow.closesAt).getTime()).toBe(
      now.getTime() + 2 * 24 * 60 * 60_000 - 60_000,
    );
    expect(shortWindow.closesAt).toBe(shortWindow.maxClosesAt);
  });

  it("derives purpose and lifecycle labels without implying recovery", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    expect(practicePurposeLabel("assignment")).toBe("Practice assignment");
    expect(practicePurposeLabel("recovery")).toBe("Recovery follow-up");
    expect(practiceStatus(practice(), now)).toBe("open");
    expect(practiceStatus(practice({ opensAt: "2026-09-21T12:00:00.000Z" }), now)).toBe(
      "scheduled",
    );
    expect(practiceStatus(practice({ closedAt: now.toISOString() }), now)).toBe("closed");
    expect(practiceStatus(practice({ expiresAt: now.toISOString() }), now)).toBe("expired");
  });

  it("protects spreadsheet cells in the one-time link export", () => {
    const created: CreatedPractice = {
      followup: practice(),
      genericUrl: "https://example.test/followup/1#token=generic",
      personalAccess: [
        {
          id: "00000000-0000-4000-8000-000000000003",
          kind: "assignment_personal",
          participantId: null,
          nickname: null,
          label: '=HYPERLINK("bad")',
          timeMultiplier: 1,
          expiresAt: "2026-09-26T12:00:00.000Z",
          revokedAt: null,
          url: "https://example.test/followup/1#token=personal",
        },
      ],
    };
    expect(practiceLinksCsv(created)).toContain('"\'=HYPERLINK(""bad"")"');
  });
});
