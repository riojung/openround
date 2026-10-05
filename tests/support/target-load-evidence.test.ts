import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSoakSummary,
  createTargetRegionEvidenceBundle,
  evaluateTargetLoadThresholds,
  targetLoadSchemaVersion,
  targetLoadThresholds,
  validateEvidenceReference,
  validateTargetLoadArtifact,
} from "../../scripts/ops/target-load-evidence.mjs";

const buildId = "a".repeat(40);
const runnerRegion = "ca-central-target";

function artifact(artifactType: "round" | "presentation", profile: 50 | 250) {
  const expectedResponses = profile * (artifactType === "presentation" ? 2 : 1);
  const value = {
    schemaVersion: targetLoadSchemaVersion,
    runId: `${artifactType}-${profile}`,
    artifactType,
    profile,
    target: "https://api.staging.openround.ca",
    runnerRegion,
    workflow: { runId: "12345", runAttempt: 2 },
    startedAt: "2026-09-27T00:00:00.000Z",
    finishedAt: "2026-09-27T00:01:00.000Z",
    build: { expectedBuildId: buildId, observedBuildId: buildId, matched: true },
    counts: {
      requestedParticipants: profile,
      joinedParticipants: profile,
      acceptedResponses: expectedResponses,
      expectedResponses,
      reportParticipants: profile,
      reportResponses: expectedResponses,
    },
    correctness: {
      lostAcceptedResponses: 0,
      duplicateAcceptedResponses: 0,
      leakageDetected: false,
      reportReconciled: true,
    },
    receipts: {
      expected: expectedResponses,
      received: expectedResponses,
      timeoutCount: 0,
      timeoutRate: 0,
    },
    recovery: {
      reconnectCompleted: true,
      reconnectMs: 100,
      processRestart: "not_run",
      coordinationReset: "not_run",
    },
    report: { reconciled: true, availableMs: 1_000 },
    latencyMs: {
      join: { p50: 50, p95: 100 },
      answerAcknowledgement: { p50: 50, p95: 100, p99: 200 },
      clientReceipt: { p50: 50, p95: 100, max: 200 },
    },
    thresholds: { ...targetLoadThresholds },
    thresholdsPassed: false,
    diagnostics:
      artifactType === "round"
        ? {
            socketConnection: { p50: 25, p95: 50 },
            joinAcknowledgement: { p50: 25, p95: 50 },
            restartRecoveryMs: null,
          }
        : {
            commandReplayStable: true,
            responseReplayStable: true,
            reconnectReceiptRecovered: true,
            participantProjectionChecks: profile,
            recoveredParticipants: profile,
            restartRecoveryMs: null,
            coordinationResetMs: null,
          },
  };
  value.thresholdsPassed = evaluateTargetLoadThresholds(value);
  return value;
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("target-region load evidence", () => {
  it("requires stable provider-neutral evidence references", () => {
    expect(
      validateEvidenceReference("https://ops.openround.ca/evidence/saturation-123", "saturation"),
    ).toBe("https://ops.openround.ca/evidence/saturation-123");
    expect(() => validateEvidenceReference("https://example.com/evidence", "saturation")).toThrow(
      /non-placeholder HTTPS URL/,
    );
    expect(() =>
      validateEvidenceReference("https://ops.openround.ca/evidence?token=secret", "saturation"),
    ).toThrow(/without credentials, query, or fragment/);
    expect(() =>
      validateEvidenceReference("https://127.0.0.1/evidence/saturation", "saturation"),
    ).toThrow(/non-placeholder HTTPS URL/);
    expect(() =>
      validateEvidenceReference("https://evidence.internal/archive/123", "saturation"),
    ).toThrow(/non-placeholder HTTPS URL/);
    for (const reference of [
      "https://100.64.0.1/evidence/run",
      "https://192.0.2.1/evidence/run",
      "https://198.18.0.1/evidence/run",
      "https://198.51.100.1/evidence/run",
      "https://203.0.113.1/evidence/run",
      "https://[2001:db8::1]/evidence/run",
      "https://[ff02::1]/evidence/run",
      "https://[::ffff:127.0.0.1]/evidence/run",
      "https://ops.openround.ca./evidence/run",
    ]) {
      expect(() => validateEvidenceReference(reference, "saturation"), reference).toThrow(
        /non-placeholder HTTPS URL/,
      );
    }
  });

  it("rejects relaxed thresholds and correctness mismatches", () => {
    const valid = artifact("round", 50);
    expect(() =>
      validateTargetLoadArtifact(valid, {
        artifactType: "round",
        profile: 50,
        expectedBuildId: buildId,
        runnerRegion,
        enforceThresholds: true,
        requireTargetProvenance: true,
      }),
    ).not.toThrow();

    expect(() =>
      validateTargetLoadArtifact(
        { ...valid, correctness: { ...valid.correctness, duplicateAcceptedResponses: 1 } },
        { enforceThresholds: true },
      ),
    ).toThrow(/duplicateAcceptedResponses must be zero/);
    expect(() =>
      validateTargetLoadArtifact(
        { ...valid, thresholds: { ...valid.thresholds, joinP95Ms: 5_000 } },
        { enforceThresholds: true },
      ),
    ).toThrow(/thresholds does not match policy/);
    expect(() =>
      validateTargetLoadArtifact(
        {
          ...valid,
          build: { ...valid.build, observedBuildId: "b".repeat(40), matched: false },
        },
        { expectedBuildId: buildId, requireTargetProvenance: true },
      ),
    ).toThrow(/build identity does not match/);
    expect(() =>
      validateTargetLoadArtifact(
        {
          ...valid,
          receipts: { ...valid.receipts, received: 49, timeoutCount: 1, timeoutRate: 0.02 },
          thresholdsPassed: false,
        },
        { enforceThresholds: true },
      ),
    ).toThrow(/receipt timeouts must be zero/);

    expect(() =>
      validateTargetLoadArtifact(
        { ...valid, secret: "must-not-enter-evidence" },
        { enforceThresholds: true },
      ),
    ).toThrow(/unsupported field/);
    expect(() =>
      validateTargetLoadArtifact(
        {
          ...valid,
          latencyMs: {
            ...valid.latencyMs,
            answerAcknowledgement: { p50: 200, p95: 100, p99: 250 },
          },
        },
        { enforceThresholds: true },
      ),
    ).toThrow(/monotonically ordered/);
    expect(() =>
      validateTargetLoadArtifact(
        { ...valid, target: "https://10.0.0.4" },
        { requireTargetProvenance: true },
      ),
    ).toThrow(/public HTTPS origin/);
    expect(() =>
      validateTargetLoadArtifact({ ...valid, target: "https://api.staging.openround.ca." }),
    ).toThrow(/HTTP\(S\) origin/);

    const presentation = artifact("presentation", 50);
    presentation.diagnostics.participantProjectionChecks = 0;
    presentation.diagnostics.recoveredParticipants = 0;
    expect(() => validateTargetLoadArtifact(presentation)).toThrow(
      /participantProjectionChecks must prove/,
    );

    const futureDated = artifact("round", 50);
    futureDated.startedAt = "2099-09-27T00:00:00.000Z";
    futureDated.finishedAt = "2099-09-27T00:01:00.000Z";
    expect(() =>
      validateTargetLoadArtifact(futureDated, {
        now: new Date("2026-09-27T02:00:00.000Z"),
      }),
    ).toThrow(/finishedAt cannot be in the future/);
  });

  it("hashes one exact build-matched matrix, provenance record, and soak summary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openround-target-evidence-"));
    const soakDirectory = join(directory, "soak");
    await mkdir(soakDirectory);
    const provenancePath = join(directory, "load-runner-provenance.json");
    const provenance = {
      schemaVersion: 3,
      artifactType: "target-load-runner-provenance",
      candidateBuildId: buildId,
      workflowCommit: buildId,
      declaredRegion: runnerRegion,
      capturedAt: "2026-09-27T00:00:00.000Z",
      workflowRunId: "12345",
      workflowRunAttempt: 2,
      runner: {
        nameSha256: `sha256:${"1".repeat(64)}`,
        os: "Linux",
        architecture: "X64",
        minimumRequiredVersion: "2.327.1",
        versionAttestationLabel: "actions-runner-2-327-1-plus",
        requiredLabels: ["self-hosted", "single-vm-staging", "actions-runner-2-327-1-plus"],
      },
    };
    await writeJson(provenancePath, provenance);

    const matrixPaths: Record<string, string> = {};
    for (const [role, artifactType, profile] of [
      ["round-50", "round", 50],
      ["presentation-50", "presentation", 50],
      ["round-250", "round", 250],
      ["presentation-250", "presentation", 250],
    ] as const) {
      const path = join(directory, `${role}.json`);
      await writeJson(path, artifact(artifactType, profile));
      matrixPaths[role] = path;
    }
    const soakSummaryPath = join(directory, "soak-summary.json");
    await writeJson(
      soakSummaryPath,
      await createSoakSummary({
        directory: soakDirectory,
        expectedBuildId: buildId,
        runnerRegion,
        requestedMinutes: 0,
        startedAt: "2026-09-27T00:00:00.000Z",
        finishedAt: "2026-09-27T00:00:00.000Z",
      }),
    );

    const bundleInput = {
      provenancePath,
      matrixPaths,
      soakSummaryPath,
      soakDirectory,
      expectedBuildId: buildId,
      runnerRegion,
      saturationEvidenceReference: "https://ops.openround.ca/evidence/saturation-123",
      durableArchiveReference: "https://archive.openround.ca/evidence/target-load-123",
    };
    const bundle = await createTargetRegionEvidenceBundle({
      ...bundleInput,
      now: new Date("2026-09-27T02:00:00.000Z"),
    });

    expect(bundle.sources).toHaveLength(6);
    expect(bundle.sources.every(({ sha256 }) => /^sha256:[0-9a-f]{64}$/.test(sha256))).toBe(true);
    expect(Object.keys(bundle.matrix).sort()).toEqual([
      "presentation-250",
      "presentation-50",
      "round-250",
      "round-50",
    ]);
    expect(bundle.saturationEvidence.requiredSignals).toEqual([
      "cpu",
      "memory",
      "disk",
      "network",
      "postgresql",
      "valkey",
    ]);
    expect(bundle.saturationEvidence.source).toMatch(/never load-generator runner metrics/);
    expect(bundle.validation).toMatchObject({
      exactMatrix: true,
      buildMatched: true,
      zeroLossDuplicateLeakage: true,
      thresholdsPassed: true,
      soakValidated: false,
      externalEvidenceContentVerified: false,
      acceptanceComplete: false,
    });
    expect(bundle.soak.status).toBe("not_run");
    expect(bundle.createdAt).toBe("2026-09-27T02:00:00.000Z");

    await expect(
      createTargetRegionEvidenceBundle({
        ...bundleInput,
        now: new Date("2026-09-27T00:00:30.000Z"),
      }),
    ).rejects.toThrow(/createdAt must follow every source completion timestamp/);

    await writeJson(provenancePath, {
      ...provenance,
      capturedAt: "2099-09-27T00:00:00.000Z",
    });
    await expect(
      createTargetRegionEvidenceBundle({
        ...bundleInput,
        now: new Date("2026-09-27T02:00:00.000Z"),
      }),
    ).rejects.toThrow(/runner provenance capturedAt cannot be in the future/);
    await writeJson(provenancePath, provenance);

    const mismatchedTarget = artifact("round", 50);
    mismatchedTarget.target = "https://other-staging.openround.ca";
    await writeJson(matrixPaths["round-50"]!, mismatchedTarget);
    await expect(createTargetRegionEvidenceBundle(bundleInput)).rejects.toThrow(
      /one exact target origin/,
    );

    const mismatchedAttempt = artifact("round", 50);
    mismatchedAttempt.workflow.runAttempt = 3;
    await writeJson(matrixPaths["round-50"]!, mismatchedAttempt);
    await expect(createTargetRegionEvidenceBundle(bundleInput)).rejects.toThrow(
      /workflow run attempt does not match/,
    );
  });

  it("rejects a soak whose timestamps do not cover its requested duration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openround-short-soak-"));
    await writeJson(join(directory, "run-1.json"), artifact("round", 50));

    await expect(
      createSoakSummary({
        directory,
        expectedBuildId: buildId,
        runnerRegion,
        requestedMinutes: 60,
        startedAt: "2026-09-27T00:00:00Z",
        finishedAt: "2026-09-27T00:05:00Z",
      }),
    ).rejects.toThrow(/shorter than the requested soak duration/);
  });

  it("permits only the reviewed not-run, 15-minute, or 60-minute soak policies", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openround-unsupported-soak-"));
    const run = artifact("round", 50);
    run.runId = "soak-policy-1";
    await writeJson(join(directory, "run-1.json"), run);

    await expect(
      createSoakSummary({
        directory,
        expectedBuildId: buildId,
        runnerRegion,
        requestedMinutes: 1,
        startedAt: "2026-09-27T00:00:00Z",
        finishedAt: "2026-09-27T00:01:00Z",
      }),
    ).rejects.toThrow(/must be 0 \(not run\), 15, or 60/);
  });

  it("binds completed soak evidence to every run file and the full wall-clock window", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openround-soak-bundle-"));
    const soakDirectory = join(directory, "soak");
    await mkdir(soakDirectory);
    const provenancePath = join(directory, "load-runner-provenance.json");
    await writeJson(provenancePath, {
      schemaVersion: 3,
      artifactType: "target-load-runner-provenance",
      candidateBuildId: buildId,
      workflowCommit: buildId,
      declaredRegion: runnerRegion,
      capturedAt: "2026-09-27T00:00:00.000Z",
      workflowRunId: "12345",
      workflowRunAttempt: 2,
      runner: {
        nameSha256: `sha256:${"1".repeat(64)}`,
        os: "Linux",
        architecture: "X64",
        minimumRequiredVersion: "2.327.1",
        versionAttestationLabel: "actions-runner-2-327-1-plus",
        requiredLabels: ["self-hosted", "single-vm-staging", "actions-runner-2-327-1-plus"],
      },
    });
    const matrixPaths: Record<string, string> = {};
    for (const [role, artifactType, profile] of [
      ["round-50", "round", 50],
      ["presentation-50", "presentation", 50],
      ["round-250", "round", 250],
      ["presentation-250", "presentation", 250],
    ] as const) {
      const path = join(directory, `${role}.json`);
      await writeJson(path, artifact(artifactType, profile));
      matrixPaths[role] = path;
    }
    const shortRun = artifact("round", 50);
    shortRun.runId = "soak-1";
    await writeJson(join(soakDirectory, "run-1.json"), shortRun);
    const soakSummaryPath = join(directory, "soak-summary.json");
    await writeJson(
      soakSummaryPath,
      await createSoakSummary({
        directory: soakDirectory,
        expectedBuildId: buildId,
        runnerRegion,
        requestedMinutes: 60,
        startedAt: "2026-09-27T00:00:00.000Z",
        finishedAt: "2026-09-27T01:00:00.000Z",
      }),
    );
    const bundleInput = {
      provenancePath,
      matrixPaths,
      soakSummaryPath,
      soakDirectory,
      expectedBuildId: buildId,
      runnerRegion,
      saturationEvidenceReference: "https://ops.openround.ca/evidence/saturation-123",
      durableArchiveReference: "https://archive.openround.ca/evidence/target-load-123",
    };
    await expect(createTargetRegionEvidenceBundle(bundleInput)).rejects.toThrow(
      /last soak run does not cover the end/,
    );

    const fullRun = artifact("round", 50);
    fullRun.runId = "soak-1";
    fullRun.finishedAt = "2026-09-27T01:00:00.000Z";
    await writeJson(join(soakDirectory, "run-1.json"), fullRun);
    await writeJson(
      soakSummaryPath,
      await createSoakSummary({
        directory: soakDirectory,
        expectedBuildId: buildId,
        runnerRegion,
        requestedMinutes: 60,
        startedAt: "2026-09-27T00:00:00.000Z",
        finishedAt: "2026-09-27T01:00:00.000Z",
      }),
    );
    const omittedRun = artifact("round", 50);
    omittedRun.runId = "soak-2";
    omittedRun.startedAt = "2026-09-27T01:00:00.000Z";
    omittedRun.finishedAt = "2026-09-27T01:00:01.000Z";
    await writeJson(join(soakDirectory, "run-2.json"), omittedRun);
    await expect(createTargetRegionEvidenceBundle(bundleInput)).rejects.toThrow(
      /soak run file inventory does not match policy/,
    );
  });
});
