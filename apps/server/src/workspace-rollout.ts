import type { FastifyReply } from "fastify";
import type { AppConfig } from "./config.js";

export type ProfessionalWorkspaceFeature =
  "workspaceShell" | "builderV2" | "presentations" | "groups" | "discover";

export type EvidenceWorkspaceFeature =
  | "presentationRealtime"
  | "recoveryPacks"
  | "questionHealth"
  | "decisionReplay"
  | "recoveryTrails"
  | "conceptHealth"
  | "extendedQuestionTypes"
  | "verifiedInstitution";

/**
 * The professional workspace is an allowlisted beta. A deployment-level flag makes a feature
 * available to the rollout, but it never grants access to every workspace by itself.
 */
export function professionalWorkspaceEligible(
  config: Pick<AppConfig, "FEATURE_UX_BETA" | "UX_BETA_WORKSPACE_ALLOWLIST">,
  workspaceId: string,
) {
  return config.FEATURE_UX_BETA && config.UX_BETA_WORKSPACE_ALLOWLIST.includes(workspaceId);
}

export function professionalWorkspaceFeatureEnabled(
  config: Pick<
    AppConfig,
    | "FEATURE_UX_BETA"
    | "UX_BETA_WORKSPACE_ALLOWLIST"
    | "FEATURE_WORKSPACE_SHELL"
    | "FEATURE_BUILDER_V2"
    | "FEATURE_PRESENTATIONS"
    | "FEATURE_GROUPS"
    | "FEATURE_DISCOVER"
  >,
  workspaceId: string,
  feature: ProfessionalWorkspaceFeature,
) {
  if (!professionalWorkspaceEligible(config, workspaceId)) return false;
  switch (feature) {
    case "workspaceShell":
      return config.FEATURE_WORKSPACE_SHELL;
    case "builderV2":
      return config.FEATURE_BUILDER_V2;
    case "presentations":
      return config.FEATURE_PRESENTATIONS;
    case "groups":
      return config.FEATURE_GROUPS;
    case "discover":
      return config.FEATURE_DISCOVER;
  }
}

export function professionalFeatureUnavailable(
  reply: FastifyReply,
  requestId: string,
  message = "Workspace feature not found",
) {
  return reply.code(404).send({
    error: {
      code: "NOT_FOUND",
      message,
      requestId,
    },
  });
}

/**
 * Evidence-gated capabilities remain unavailable unless both the deployment switch and the
 * dedicated pilot allowlist opt a workspace in. Read paths for already-created resources should
 * not use this helper; callers use it only for creation, publication, import, or new live use.
 */
export function evidenceWorkspaceFeatureEnabled(
  config: Pick<
    AppConfig,
    | "EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST"
    | "FEATURE_PRESENTATION_REALTIME"
    | "FEATURE_RECOVERY_PACKS"
    | "FEATURE_QUESTION_HEALTH"
    | "FEATURE_DECISION_REPLAY"
    | "FEATURE_RECOVERY_TRAILS"
    | "FEATURE_CONCEPT_HEALTH"
    | "FEATURE_EXTENDED_QUESTION_TYPES"
    | "FEATURE_VERIFIED_INSTITUTION"
  >,
  workspaceId: string,
  feature: EvidenceWorkspaceFeature,
) {
  if (!config.EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST.includes(workspaceId)) return false;
  switch (feature) {
    case "presentationRealtime":
      return config.FEATURE_PRESENTATION_REALTIME;
    case "recoveryPacks":
      return config.FEATURE_RECOVERY_PACKS;
    case "questionHealth":
      return config.FEATURE_QUESTION_HEALTH;
    case "decisionReplay":
      return config.FEATURE_DECISION_REPLAY;
    case "recoveryTrails":
      return config.FEATURE_RECOVERY_TRAILS;
    case "conceptHealth":
      return config.FEATURE_CONCEPT_HEALTH;
    case "extendedQuestionTypes":
      return config.FEATURE_EXTENDED_QUESTION_TYPES;
    case "verifiedInstitution":
      return config.FEATURE_VERIFIED_INSTITUTION;
  }
}
