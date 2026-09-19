import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "@openround/contracts";
import { getHostPhaseView } from "../lib/host-phase";
import { HostCommandBar, RecoveryCompass } from "./host-command-center";

function snapshot(phase: SessionSnapshot["phase"]): SessionSnapshot {
  return {
    mode: "live",
    stateSchemaVersion: 4,
    sessionId: "00000000-0000-4000-8000-000000000001",
    code: "1234567",
    version: 1,
    seq: 1,
    phase,
    roundId: "00000000-0000-4000-8000-000000000002",
    roundKind: "main",
    sourceRoundId: "00000000-0000-4000-8000-000000000002",
    questionIndex: 0,
    questionPosition: 0,
    questionCount: 1,
    question: null,
    deadline: null,
    participants: [],
    answerCount: 10,
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
      preset: { id: "focus", version: 1 },
      name: "Focus",
      category: "general",
      motion: "calm",
      soundCue: "none",
      soundEnabled: false,
      tokens: {
        canvas: "#F7F4EC",
        surface: "#FFFFFF",
        surfaceStrong: "#DCEEEE",
        text: "#0B2239",
        mutedText: "#425B72",
        primary: "#075E63",
        accent: "#8A3D22",
        choiceColors: ["#075E63", "#7B3657", "#6D4B0C", "#345594", "#553D8A", "#23613F"],
        pattern: "dots",
        typography: "humanist",
        corners: "soft",
      },
    },
    pausedRemainingMs: null,
    intervention: null,
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
  } as SessionSnapshot;
}

describe("host command center", () => {
  it("hides recommendations that are illegal in the current phase", () => {
    const revealed = snapshot("question_reveal");
    const revealedView = getHostPhaseView(revealed);
    const revealedMarkup = renderToStaticMarkup(
      <RecoveryCompass phaseView={revealedView} snapshot={revealed} />,
    );

    expect(revealedView.suggestionKind).toBe("none");
    expect(revealedMarkup).not.toContain("Try peer discussion");

    const locked = snapshot("question_locked");
    const lockedMarkup = renderToStaticMarkup(
      <RecoveryCompass phaseView={getHostPhaseView(locked)} snapshot={locked} />,
    );
    expect(lockedMarkup).toContain("Try peer discussion");

    const afterIntervention = snapshot("question_reveal");
    afterIntervention.intervention = {
      id: "00000000-0000-4000-8000-000000000003",
      type: "peer_discussion",
      sourceRoundId: "00000000-0000-4000-8000-000000000002",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
    };
    const afterInterventionView = getHostPhaseView(afterIntervention);
    const afterInterventionMarkup = renderToStaticMarkup(
      <RecoveryCompass phaseView={afterInterventionView} snapshot={afterIntervention} />,
    );
    expect(afterInterventionView.primary?.action).toBe("recheck.open");
    expect(afterInterventionView.suggestionKind).toBe("none");
    expect(afterInterventionMarkup).not.toContain("Try peer discussion");

    const guidanceOnly = snapshot("question_locked");
    guidanceOnly.insight!.recommendation = {
      code: "low_participation",
      action: "wait_or_check_access",
      title: "Wait or check access",
      reason: "More responses are needed.",
      strong: false,
    };
    const guidanceOnlyView = getHostPhaseView(guidanceOnly);
    const guidanceOnlyMarkup = renderToStaticMarkup(
      <RecoveryCompass phaseView={guidanceOnlyView} snapshot={guidanceOnly} />,
    );
    expect(guidanceOnlyView.suggestionKind).toBe("guidance");
    expect(guidanceOnlyMarkup).toContain("Wait or check access");
  });

  it("places the primary command before overflow controls in DOM order", () => {
    const markup = renderToStaticMarkup(
      <HostCommandBar
        busy={false}
        leading={<button type="button">Audience</button>}
        onCommand={() => undefined}
        phaseView={{
          phaseLabel: "Question open",
          primary: { action: "lock", label: "Lock answers" },
          secondary: [{ action: "pause", label: "Pause" }],
          suggestionKind: "none",
        }}
        trailing={<button type="button">End</button>}
      />,
    );

    expect(markup.indexOf("Lock answers")).toBeLessThan(markup.indexOf("Audience"));
    expect(markup.indexOf("Lock answers")).toBeLessThan(markup.indexOf("Pause"));
    expect(markup.indexOf("Lock answers")).toBeLessThan(markup.indexOf("End"));
  });
});
