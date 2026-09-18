import { describe, expect, it } from "vitest";
import type { SessionSettings } from "@openround/contracts";
import { resolveSetupRecipe, setupRecipeStorageKey } from "./setup-recipes";

const current: SessionSettings = {
  audienceLimit: 80,
  scoringMode: "speed",
  resultVisibility: "leaderboard",
  allowLateJoin: false,
  nicknamePolicy: "custom",
};

describe("setup recipes", () => {
  it("maps recovery to private, accuracy-first facilitation while preserving a capped audience", () => {
    expect(
      resolveSetupRecipe("recovery", current, {
        segment: "workplace",
        maxParticipants: 50,
        roundExperiencesAvailable: true,
      }),
    ).toEqual({
      settings: {
        audienceLimit: 50,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "friendly_only",
      },
      experiencePreset: "focus",
      presenterSoundEnabled: false,
    });
  });

  it("uses Spark only when experiences are available and never enables sound implicitly", () => {
    expect(
      resolveSetupRecipe("competition", current, {
        segment: "education",
        maxParticipants: 100,
        roundExperiencesAvailable: true,
      }),
    ).toMatchObject({ experiencePreset: "spark", presenterSoundEnabled: false });
    expect(
      resolveSetupRecipe("competition", current, {
        segment: "education",
        maxParticipants: 100,
        roundExperiencesAvailable: false,
      }),
    ).toMatchObject({ experiencePreset: "focus", presenterSoundEnabled: false });
  });

  it("keeps the segment nickname default for discussion and versions stored preferences", () => {
    expect(
      resolveSetupRecipe("discussion", current, {
        segment: "workplace",
        maxParticipants: 100,
        roundExperiencesAvailable: true,
      }).settings.nicknamePolicy,
    ).toBe("custom");
    expect(setupRecipeStorageKey("workspace-id")).toBe("openround:setup:v1:workspace-id");
  });
});
