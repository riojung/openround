import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "@openround/contracts";
import { getHostPhaseView } from "./host-phase";

function snapshot(patch: Partial<SessionSnapshot>): SessionSnapshot {
  return {
    mode: "live",
    stateSchemaVersion: 4,
    sessionId: "00000000-0000-4000-8000-000000000001",
    code: "1234567",
    version: 1,
    seq: 1,
    phase: "lobby",
    roundId: null,
    roundKind: "main",
    sourceRoundId: null,
    questionIndex: null,
    questionPosition: null,
    questionCount: 2,
    question: null,
    deadline: null,
    participants: [],
    answerCount: 0,
    lobbyLocked: false,
    settings: {
      audienceLimit: 20,
      scoringMode: "accuracy",
      resultVisibility: "private",
      allowLateJoin: true,
      nicknamePolicy: "friendly_only",
    },
    brandTheme: null,
    experienceTheme: {
      category: "general",
      preset: { id: "focus", version: 1 },
      tokens: {
        background: "#000000",
        surface: "#ffffff",
        surfaceStrong: "#eeeeee",
        text: "#111111",
        muted: "#444444",
        accent: "#0000ff",
        accentText: "#ffffff",
        success: "#008000",
        warning: "#a05a00",
        danger: "#cc0000",
        answerPalette: ["#0000ff", "#008000", "#a05a00", "#cc0000"],
        typography: "system",
        corners: "soft",
        pattern: "none",
      },
      motion: "calm",
      sound: { enabled: false, pack: "none" },
    },
    pausedRemainingMs: null,
    intervention: null,
    ...patch,
  } as SessionSnapshot;
}

describe("host phase view", () => {
  it.each([
    ["lobby", "start"],
    ["question_open", "lock"],
    ["paused", "resume"],
    ["question_locked", "reveal"],
    ["intervention", "intervention.finish"],
    ["leaderboard", "next"],
  ] as const)("selects the legal primary command for %s", (phase, action) => {
    expect(getHostPhaseView(snapshot({ phase })).primary?.action).toBe(action);
  });

  it("promotes a strong, legal peer-discussion recommendation before reveal", () => {
    const view = getHostPhaseView(
      snapshot({
        phase: "question_locked",
        insight: {
          sampleSize: 10,
          activeParticipantCount: 10,
          participationPercent: 100,
          correctnessPercent: 50,
          highConfidenceWrongPercent: 0,
          correctLowConfidencePercent: 0,
          dominantMisconception: null,
          recommendation: {
            code: "split_understanding",
            action: "peer_discussion",
            title: "Try peer discussion",
            reason: "The room is split.",
            strong: true,
          },
        },
      }),
    );
    expect(view.primary).toMatchObject({
      action: "intervention.start",
      interventionType: "peer_discussion",
    });
    expect(view.secondary[0]?.action).toBe("reveal");
  });

  it("reveals after a completed pre-reveal discussion instead of suggesting it again", () => {
    const view = getHostPhaseView(
      snapshot({
        phase: "question_locked",
        intervention: {
          id: "00000000-0000-4000-8000-000000000004",
          type: "peer_discussion",
          sourceRoundId: "00000000-0000-4000-8000-000000000005",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:01:00.000Z",
        },
        insight: {
          sampleSize: 10,
          activeParticipantCount: 10,
          participationPercent: 100,
          correctnessPercent: 50,
          highConfidenceWrongPercent: 0,
          correctLowConfidencePercent: 0,
          dominantMisconception: null,
          recommendation: {
            code: "split_understanding",
            action: "peer_discussion",
            title: "Try peer discussion",
            reason: "The room is split.",
            strong: true,
          },
        },
      }),
    );
    expect(view.primary?.action).toBe("reveal");
    expect(view.secondary).not.toContainEqual(
      expect.objectContaining({ interventionType: "peer_discussion" }),
    );
  });

  it("never offers standings for private sessions", () => {
    const view = getHostPhaseView(snapshot({ phase: "question_reveal" }));
    expect(view.secondary).not.toContainEqual(
      expect.objectContaining({ action: "show_leaderboard" }),
    );
  });

  it("offers only post-reveal interventions before a recheck is legal", () => {
    const view = getHostPhaseView(snapshot({ phase: "question_reveal" }));
    expect(view.secondary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "intervention.start", interventionType: "explain" }),
        expect.objectContaining({ action: "intervention.start", interventionType: "example" }),
      ]),
    );
    expect(view.secondary).not.toContainEqual(expect.objectContaining({ action: "recheck.open" }));
  });

  it("prefers an authored linked recheck after a finished intervention", () => {
    const view = getHostPhaseView(
      snapshot({
        phase: "question_reveal",
        question: { linkedRecheckAvailable: true } as SessionSnapshot["question"],
        intervention: {
          id: "00000000-0000-4000-8000-000000000002",
          type: "example",
          sourceRoundId: "00000000-0000-4000-8000-000000000003",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:01:00.000Z",
        },
      }),
    );
    expect(view.primary).toMatchObject({ action: "recheck.open", recheckMode: "linked" });
    expect(view.suggestionKind).toBe("none");
  });
});
