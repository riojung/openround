import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config.js";
import { evidenceWorkspaceFeatureEnabled } from "../src/workspace-rollout.js";

describe("evidence-gated workspace rollout", () => {
  it("requires both live synchronization and the dedicated Companion switch and membership", () => {
    const workspaceId = randomUUID();
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      FEATURE_PRESENTATION_COMPANION: "true",
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
    });
    expect(evidenceWorkspaceFeatureEnabled(config, workspaceId, "presentationCompanion")).toBe(
      false,
    );
    const enabled = { ...config, FEATURE_PRESENTATION_REALTIME: true };
    expect(evidenceWorkspaceFeatureEnabled(enabled, workspaceId, "presentationCompanion")).toBe(
      true,
    );
    expect(evidenceWorkspaceFeatureEnabled(enabled, randomUUID(), "presentationCompanion")).toBe(
      false,
    );
    expect(
      evidenceWorkspaceFeatureEnabled(
        { ...enabled, FEATURE_PRESENTATION_COMPANION: false },
        workspaceId,
        "presentationCompanion",
      ),
    ).toBe(false);
  });

  it("keeps live Pack rollout separate from authoring and requires both switches and membership", () => {
    const workspaceId = randomUUID();
    const authoringOnly = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      FEATURE_RECOVERY_PACKS: "true",
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
    });
    expect(evidenceWorkspaceFeatureEnabled(authoringOnly, workspaceId, "recoveryPacks")).toBe(true);
    expect(
      evidenceWorkspaceFeatureEnabled(authoringOnly, workspaceId, "recoveryPackLiveCards"),
    ).toBe(false);
    const live = { ...authoringOnly, FEATURE_RECOVERY_PACK_LIVE_CARDS: true };
    expect(evidenceWorkspaceFeatureEnabled(live, workspaceId, "recoveryPackLiveCards")).toBe(true);
    expect(evidenceWorkspaceFeatureEnabled(live, randomUUID(), "recoveryPackLiveCards")).toBe(
      false,
    );
    expect(
      evidenceWorkspaceFeatureEnabled(
        { ...live, FEATURE_RECOVERY_PACKS: false },
        workspaceId,
        "recoveryPackLiveCards",
      ),
    ).toBe(false);
  });

  it("requires both a deployment flag and explicit workspace membership", () => {
    const workspaceId = randomUUID();
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      FEATURE_QUESTION_HEALTH: "true",
      FEATURE_LIVE_FLEX_MODE: "true",
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: workspaceId,
    });

    expect(evidenceWorkspaceFeatureEnabled(config, workspaceId, "questionHealth")).toBe(true);
    expect(evidenceWorkspaceFeatureEnabled(config, workspaceId, "liveFlexMode")).toBe(true);
    expect(evidenceWorkspaceFeatureEnabled(config, randomUUID(), "questionHealth")).toBe(false);
    expect(evidenceWorkspaceFeatureEnabled(config, randomUUID(), "liveFlexMode")).toBe(false);
    expect(evidenceWorkspaceFeatureEnabled(config, workspaceId, "recoveryPacks")).toBe(false);
  });

  it("fails closed when no pilot allowlist is configured", () => {
    const config = ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      FEATURE_PRESENTATION_REALTIME: "true",
      FEATURE_LIVE_FLEX_MODE: "true",
      FEATURE_DECISION_REPLAY: "true",
    });

    expect(evidenceWorkspaceFeatureEnabled(config, randomUUID(), "presentationRealtime")).toBe(
      false,
    );
    expect(evidenceWorkspaceFeatureEnabled(config, randomUUID(), "decisionReplay")).toBe(false);
    expect(evidenceWorkspaceFeatureEnabled(config, randomUUID(), "liveFlexMode")).toBe(false);
  });
});
