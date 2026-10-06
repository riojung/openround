import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  RecoveryPackContentSchema,
  ReportSchema,
  recoveryPackContentHash,
  type HostCommand,
  type QuizDraft,
} from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { MetricsService } from "../src/metrics.js";
import { generateReport, reportCsv } from "../src/reporting.js";
import { snapshotSelector } from "../src/realtime.js";
import { SessionService } from "../src/session-service.js";

const services: SessionService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

function packContent() {
  const question = (prompt: string) => ({
    id: randomUUID(),
    type: "numeric" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    conceptKeys: ["ratio"],
    correctValue: "0.5",
    tolerance: "0",
    unit: null,
    timeLimitSeconds: 300,
    basePoints: 100,
    explanation: "Compare the part with the reference.",
    mediaId: null,
    mediaAlt: null,
  });
  const recheck = { ...question("Apply the ratio in a new situation."), delivery: "recheck" };
  return RecoveryPackContentSchema.parse({
    title: "Ratio recovery",
    description: "",
    diagnostic: {
      ...question("What is the ratio?"),
      delivery: "main",
      linkedRecheckQuestionId: recheck.id,
    },
    recheck,
    delayedProbe: null,
    interventions: [
      { id: randomUUID(), title: "Compare parts", body: "Use the reference part.", citations: [] },
      { id: randomUUID(), title: "Future card", body: "Unselected card secret.", citations: [] },
    ],
    conceptKeys: ["ratio"],
    citations: [],
  });
}

async function fixture(enabled = true, allowlisted = true, replay = true) {
  const repository = new MemoryRepository();
  const now = new Date();
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `${tokenHash}@example.com`,
    segment: "workplace",
    tokenHash,
    policyVersion: "test-v1",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const creator = (await repository.consumeMagicToken(tokenHash, now))!;
  const content = packContent();
  const diagnosticId = randomUUID();
  const recheckId = randomUUID();
  const insertion = {
    id: randomUUID(),
    packId: randomUUID(),
    packVersionId: randomUUID(),
    packVersion: 1,
    contentHash: recoveryPackContentHash(content),
    diagnosticQuestionId: diagnosticId,
    recheckQuestionId: recheckId,
    originalContent: content,
  };
  // This copied snapshot deliberately has no live source Pack. Playback must not depend on it.
  const quiz: QuizDraft = {
    title: "Copied recovery Round",
    description: "",
    questions: [
      { ...content.diagnostic, id: diagnosticId, linkedRecheckQuestionId: recheckId },
      { ...content.recheck, id: recheckId },
    ],
    recoveryPackInsertions: [insertion],
  };
  const record = await repository.createQuiz({
    id: randomUUID(),
    workspaceId: creator.workspaceId,
    title: quiz.title,
    description: quiz.description,
    draft: quiz,
    status: "draft",
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  await repository.publishQuiz({
    id: randomUUID(),
    workspaceId: creator.workspaceId,
    quizId: record.id,
    version: 1,
    content: quiz,
    contentHash: randomUUID(),
    publishedAt: now,
  });
  const config = ConfigSchema.parse({
    NODE_ENV: "test",
    ALLOW_IN_MEMORY: "true",
    LOG_LEVEL: "silent",
    FEATURE_RECOVERY_PACKS: String(enabled),
    FEATURE_DECISION_REPLAY: String(replay),
    EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: allowlisted ? creator.workspaceId : "",
  });
  function service(disabled = false) {
    const result = new SessionService(
      repository,
      new MemorySessionCache(),
      disabled ? { ...config, FEATURE_RECOVERY_PACKS: false } : config,
      new MetricsService(),
    );
    services.push(result);
    return result;
  }
  const current = service();
  const session = await current.createSession(creator, record.id, {
    audienceLimit: 20,
    scoringMode: "accuracy",
    resultVisibility: "private",
    allowLateJoin: true,
    nicknamePolicy: "custom",
  });
  const learner = await current.join({ code: session.code, nickname: "Learner" });
  const selection = { insertionId: insertion.id, cardId: content.interventions[0]!.id };
  const reference = {
    insertionId: insertion.id,
    packId: insertion.packId,
    packVersionId: insertion.packVersionId,
    packVersion: 1,
    contentHash: insertion.contentHash,
    cardId: selection.cardId,
  };
  async function command(
    target: SessionService,
    action: HostCommand["action"],
    options: Partial<HostCommand> = {},
  ) {
    const snapshot = await target.snapshot({
      sessionId: session.sessionId,
      hostToken: session.hostToken,
    });
    const result = await target.hostCommand({
      sessionId: session.sessionId,
      hostToken: session.hostToken,
      commandId: randomUUID(),
      expectedVersion: snapshot.version,
      action,
      ...options,
    });
    return { snapshot: result };
  }
  return { repository, creator, session, learner, selection, reference, current, service, command };
}

describe("Round Recovery Pack playback", () => {
  it("recovers the selected card after a cold restart and reconciles its linked-recheck evidence", async () => {
    const f = await fixture();
    await f.command(f.current, "start");
    await f.command(f.current, "lock");
    await expect(
      f.command(f.current, "intervention.start", {
        interventionType: "explain",
        recoveryPackCard: f.selection,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.command(f.current, "reveal");
    const selected = await f.command(f.current, "intervention.start", {
      interventionType: "explain",
      recoveryPackCard: f.selection,
      commandId: "selected-card-command",
    });
    expect(selected.snapshot.recoveryPackCard).toMatchObject({
      reference: f.reference,
      body: "Use the reference part.",
    });
    const activeState = (await f.repository.getSessionById(f.session.sessionId))!.state;
    const select = snapshotSelector(activeState);
    // Exercise the optimized realtime projection when the current round has no answers.
    for (const role of ["participant", "presenter"] as const) {
      const projected = select(role, role === "participant" ? f.learner.participantId : undefined);
      expect(projected.recoveryPackCard?.reference).toEqual(f.reference);
      expect(projected.recoveryPackCards).toBeUndefined();
      expect(JSON.stringify(projected)).not.toContain("Unselected card secret");
    }
    f.current.close();
    // Empty cache + fresh service + disabled deployment flag: existing rooms retain capability.
    const restarted = f.service(true);
    const synchronized = await restarted.sync({
      sessionId: f.session.sessionId,
      participantToken: f.learner.participantToken,
      role: "participant",
      lastSeq: 0,
    });
    expect(synchronized.snapshot.recoveryPackCard).toMatchObject({ reference: f.reference });
    expect(synchronized.snapshot.recoveryPackCards).toBeUndefined();
    expect(JSON.stringify(synchronized)).not.toContain("Unselected card secret");
    expect(JSON.stringify(synchronized)).not.toContain("correctValue");
    const version = selected.snapshot.version;
    const duplicate = await f.command(restarted, "intervention.start", {
      interventionType: "explain",
      recoveryPackCard: f.selection,
      commandId: "selected-card-command",
      expectedVersion: 0,
    });
    expect(duplicate.snapshot.version).toBeGreaterThanOrEqual(version);
    const finished = await f.command(restarted, "intervention.finish");
    expect(finished.snapshot.recoveryPackCard).toBeUndefined();
    const recheck = await f.command(restarted, "recheck.open", { recheckMode: "linked" });
    expect(recheck.snapshot.roundKind).toBe("linked_recheck");
    expect(recheck.snapshot.recoveryPackCards).toBeUndefined();
    await f.command(restarted, "end");
    const stored = (await f.repository.getSessionById(f.session.sessionId))!;
    const evidence = await f.repository.getSessionEvidence(f.creator.workspaceId, stored.id);
    expect(evidence.interventions).toHaveLength(1);
    expect(evidence.interventions[0]?.recoveryPackCard).toEqual(f.reference);
    expect(
      evidence.decisionEvents.filter((event) => event.type === "intervention_started"),
    ).toHaveLength(1);
    expect(evidence.decisionEvents).toContainEqual(
      expect.objectContaining({ type: "intervention_finished", recoveryPackCard: f.reference }),
    );
    const report = ReportSchema.parse(
      generateReport(stored.state, stored.retentionExpiresAt, { evidence }),
    );
    expect(report).toMatchObject({
      schemaVersion: 4,
      interventions: [
        { recoveryPackCard: f.reference, linkedRecheckRoundId: recheck.snapshot.roundId },
      ],
    });
    expect(reportCsv(report)).toContain(f.reference.contentHash);
    expect(reportCsv(report)).toContain(f.selection.cardId);
    expect(JSON.stringify(report)).not.toContain("Use the reference part.");
  });

  it.each([
    [false, true],
    [true, false],
  ])(
    "blocks new Pack playback without deployment AND allowlist (%s, %s)",
    async (enabled, allowlisted) => {
      const f = await fixture(enabled, allowlisted);
      await f.command(f.current, "start");
      await f.command(f.current, "lock");
      const revealed = await f.command(f.current, "reveal");
      expect(revealed.snapshot.recoveryPackCards).toBeUndefined();
      await expect(
        f.command(f.current, "intervention.start", {
          interventionType: "explain",
          recoveryPackCard: f.selection,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      // Feature disable does not make the copied diagnostic/recheck or generic recovery unreadable.
      await f.command(f.current, "intervention.start", { interventionType: "explain" });
      await f.command(f.current, "intervention.finish");
      expect(
        (await f.command(f.current, "recheck.open", { recheckMode: "linked" })).snapshot.roundKind,
      ).toBe("linked_recheck");
    },
  );

  it("retains Pack attribution in reports/CSV even when Decision Replay is disabled", async () => {
    const f = await fixture(true, true, false);
    for (const action of ["start", "lock", "reveal"] as const) await f.command(f.current, action);
    await f.command(f.current, "intervention.start", {
      interventionType: "example",
      recoveryPackCard: f.selection,
    });
    await f.command(f.current, "end");
    const stored = (await f.repository.getSessionById(f.session.sessionId))!;
    const evidence = await f.repository.getSessionEvidence(f.creator.workspaceId, stored.id);
    expect(evidence.decisionEvents).toEqual([]);
    const report = generateReport(stored.state, stored.retentionExpiresAt, { evidence });
    expect(report).toMatchObject({
      schemaVersion: 3,
      interventions: [{ recoveryPackCard: f.reference }],
    });
    expect(reportCsv(report)).toContain(f.reference.packVersionId);
  });
});
