import type { WorkspaceProductFeatures } from "@openround/contracts";

/**
 * The current videos demonstrate the complete professional authoring workflow. Keep them hidden
 * when any covered capability is rolled back so the help centre never teaches a route that the
 * viewer cannot use.
 */
export function professionalBuilderGuidesAvailable(
  features: WorkspaceProductFeatures | null | undefined,
) {
  return Boolean(
    features?.uxBeta &&
    features.workspaceShell &&
    features.builderV2 &&
    features.presentations &&
    features.groups &&
    features.discover &&
    features.practiceAssignments,
  );
}

export function professionalRoundBuilderAvailable(
  features: WorkspaceProductFeatures | null | undefined,
) {
  return Boolean(features?.uxBeta && features.workspaceShell && features.builderV2);
}
