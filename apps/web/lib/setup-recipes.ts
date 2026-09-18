import type { ExperiencePresetId, SessionSettings } from "@openround/contracts";

export type SetupRecipe = "recovery" | "competition" | "discussion";

export interface ResolvedSetupRecipe {
  settings: SessionSettings;
  experiencePreset: ExperiencePresetId;
  presenterSoundEnabled: false;
}

export function resolveSetupRecipe(
  recipe: SetupRecipe,
  current: SessionSettings,
  options: {
    segment: "education" | "workplace";
    maxParticipants: number;
    roundExperiencesAvailable: boolean;
  },
): ResolvedSetupRecipe {
  const audienceLimit = Math.min(Math.max(1, current.audienceLimit), options.maxParticipants);
  const common = { audienceLimit, allowLateJoin: true } as const;

  if (recipe === "competition") {
    return {
      settings: {
        ...common,
        scoringMode: "speed",
        resultVisibility: "leaderboard",
        nicknamePolicy: "friendly_only",
      },
      experiencePreset: options.roundExperiencesAvailable ? "spark" : "focus",
      presenterSoundEnabled: false,
    };
  }

  if (recipe === "discussion") {
    return {
      settings: {
        ...common,
        scoringMode: "accuracy",
        resultVisibility: "private",
        nicknamePolicy: options.segment === "education" ? "friendly_only" : "custom",
      },
      experiencePreset: "focus",
      presenterSoundEnabled: false,
    };
  }

  return {
    settings: {
      ...common,
      scoringMode: "accuracy",
      resultVisibility: "private",
      nicknamePolicy: "friendly_only",
    },
    experiencePreset: "focus",
    presenterSoundEnabled: false,
  };
}

export function setupRecipeStorageKey(workspaceId: string) {
  return `openround:setup:v1:${workspaceId}`;
}
