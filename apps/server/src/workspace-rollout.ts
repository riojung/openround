import type { FastifyReply } from "fastify";
import type { AppConfig } from "./config.js";

export type ProfessionalWorkspaceFeature =
  "workspaceShell" | "builderV2" | "presentations" | "groups" | "discover";

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
