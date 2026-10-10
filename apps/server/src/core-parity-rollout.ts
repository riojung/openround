import type { AppConfig } from "./config.js";

export type CoreParityFeature = "audienceScopes" | "feedbackRooms" | "surveys" | "feedbackExports";

/** Writer gates only. Previously accepted scope data remains readable during a rollout pause. */
export function coreParityCreationEnabled(
  config: Pick<
    AppConfig,
    | "CORE_PARITY_WORKSPACE_ALLOWLIST"
    | "FEATURE_AUDIENCE_SCOPES"
    | "FEATURE_FEEDBACK_ROOMS"
    | "FEATURE_SURVEYS"
    | "FEATURE_FEEDBACK_EXPORTS"
  >,
  workspaceId: string,
  feature: CoreParityFeature,
) {
  if (!config.CORE_PARITY_WORKSPACE_ALLOWLIST.includes(workspaceId)) return false;
  if (!config.FEATURE_AUDIENCE_SCOPES) return false;
  switch (feature) {
    case "audienceScopes":
      return true;
    case "feedbackRooms":
      return config.FEATURE_FEEDBACK_ROOMS;
    case "surveys":
      return config.FEATURE_FEEDBACK_ROOMS && config.FEATURE_SURVEYS;
    case "feedbackExports":
      return config.FEATURE_FEEDBACK_ROOMS && config.FEATURE_FEEDBACK_EXPORTS;
  }
}
