import type { WorkspaceProductFeatures } from "@openround/contracts";

/**
 * The longer user guide covers themes, interaction, Presentations, and practice. Keep it hidden
 * when any covered capability is rolled back. Quick start requires only the Round Builder.
 */
export function professionalBuilderGuidesAvailable(
  features: WorkspaceProductFeatures | null | undefined,
) {
  return Boolean(
    features?.uxBeta &&
    features.workspaceShell &&
    features.builderV2 &&
    features.roundExperiences &&
    features.audiencePulse &&
    features.roomChat &&
    features.presentations &&
    features.practiceAssignments,
  );
}

export function professionalRoundBuilderAvailable(
  features: WorkspaceProductFeatures | null | undefined,
) {
  return Boolean(features?.uxBeta && features.workspaceShell && features.builderV2);
}
