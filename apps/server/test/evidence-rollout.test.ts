import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { evidenceWorkspaceFeatureEnabled } from "../src/workspace-rollout.js";

describe("evidence-gated workspace rollout", () => {
  it("requires both a deployment flag and explicit workspace membership", () => {
    const workspaceId = randomUUID();
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      FEATURE_QUESTION_HEALTH: "true",
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
    });

    expect(evidenceWorkspaceFeatureEnabled(config, workspaceId, "questionHealth")).toBe(true);
    expect(evidenceWorkspaceFeatureEnabled(config, randomUUID(), "questionHealth")).toBe(false);
    expect(evidenceWorkspaceFeatureEnabled(config, workspaceId, "recoveryPacks")).toBe(false);
  });

  it("fails closed when no pilot allowlist is configured", () => {
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      FEATURE_PRESENTATION_REALTIME: "true",
      FEATURE_DECISION_REPLAY: "true",
    });

    expect(evidenceWorkspaceFeatureEnabled(config, randomUUID(), "presentationRealtime")).toBe(
      false,
    );
    expect(evidenceWorkspaceFeatureEnabled(config, randomUUID(), "decisionReplay")).toBe(false);
  });
});
