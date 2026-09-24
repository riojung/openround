import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Report } from "@openround/contracts";
import { createGameState } from "@openround/game-engine";
import {
  FollowupAccessLimitError,
  MemoryRepository,
  PublishedQuizLimitError,
  QuizDraftRevisionConflictError,
  SessionNotActiveError,
} from "../src/index.js";

function publishableRound(title: string) {
  return {
    title,
    description: "",
    questions: [
      {
        id: randomUUID(),
        type: "numeric" as const,
        prompt: "What is one plus one?",
        correctValue: "2",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "One plus one is two.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
}

describe("memory repository", () => {
  it("fences stale draft saves and publishes the acknowledged revision idempotently", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const quizId = randomUUID();
    const now = new Date("2026-09-19T12:00:00.000Z");
    const original = { title: "Original", description: "", questions: [] };
    const created = await repository.createQuiz({
      id: quizId,
      workspaceId,
      title: original.title,
      description: original.description,
      status: "draft",
      draft: original,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(created).toMatchObject({ draftRevision: 0, publishedDraftRevision: null });

    const savedDraft = { ...original, title: "Saved revision" };
    const saved = await repository.updateQuiz(workspaceId, quizId, savedDraft, 0);
    expect(saved).toMatchObject({ draftRevision: 1, draft: { title: "Saved revision" } });
    await expect(repository.updateQuiz(workspaceId, quizId, original, 0)).rejects.toEqual(
      expect.objectContaining<Partial<QuizDraftRevisionConflictError>>({
        expectedRevision: 0,
        currentRevision: 1,
      }),
    );

    const versionInput = {
      id: randomUUID(),
      workspaceId,
      quizId,
      version: 1,
      content: publishableRound(savedDraft.title),
      contentHash: "same-content",
      publishedAt: now,
    };
    await expect(repository.publishQuiz(versionInput, null, 0)).rejects.toBeInstanceOf(
      QuizDraftRevisionConflictError,
    );
    const version = await repository.publishQuiz(versionInput, null, 1);
    expect(version).toMatchObject({ sourceDraftRevision: 1 });
    expect(await repository.getQuiz(workspaceId, quizId)).toMatchObject({
      currentVersionId: version.id,
      draftRevision: 1,
      publishedDraftRevision: 1,
    });

    const duplicate = await repository.publishQuiz(
      { ...versionInput, id: randomUUID(), version: 2 },
      null,
      1,
    );
    expect(duplicate.id).toBe(version.id);
  });

  it("deduplicates Round draft mutations and bounds recovery history", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const editorId = randomUUID();
    const quizId = randomUUID();
    const original = { title: "Original", description: "", questions: [] };
    await repository.createQuiz({
      id: quizId,
      workspaceId,
      title: original.title,
      description: original.description,
      status: "draft",
      draft: original,
      currentVersionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mutationId = randomUUID();
    const mutation = {
      workspaceId,
      quizId,
      draft: { ...original, title: "Revision 1" },
      expectedRevision: 0,
      mutationId,
      editorId,
      schemaVersion: 1,
      draftHash: "revision-1",
    };
    await expect(repository.updateQuizDraft(mutation)).resolves.toMatchObject({
      draftRevision: 1,
      lastEditedBy: editorId,
    });
    await expect(repository.updateQuizDraft(mutation)).resolves.toMatchObject({
      draftRevision: 1,
    });

    for (let expectedRevision = 1; expectedRevision < 25; expectedRevision += 1) {
      await repository.updateQuizDraft({
        ...mutation,
        draft: { ...original, title: `Revision ${expectedRevision + 1}` },
        expectedRevision,
        mutationId: randomUUID(),
        draftHash: `revision-${expectedRevision + 1}`,
      });
    }
    const history = await repository.listQuizDraftHistory(workspaceId, quizId);
    expect(history).toHaveLength(20);
    expect(history[0]?.revision).toBe(25);
    expect(history.at(-1)?.revision).toBe(6);

    const restored = await repository.restoreQuizDraftHistory({
      workspaceId,
      quizId,
      historyRevision: 10,
      expectedRevision: 25,
      mutationId: randomUUID(),
      editorId,
    });
    expect(restored).toMatchObject({ draftRevision: 26, draft: { title: "Revision 10" } });
  });

  it("applies an initial plan only to the deterministic in-memory workspace", async () => {
    const workspaceId = randomUUID();
    const repository = new MemoryRepository({
      initialWorkspaceId: workspaceId,
      initialPlan: "pro",
    });
    const now = new Date("2026-09-19T12:00:00.000Z");

    const consume = async (email: string) => {
      const tokenHash = randomUUID();
      await repository.createMagicToken({
        id: randomUUID(),
        email,
        segment: "education",
        tokenHash,
        policyVersion: "test-v1",
        expiresAt: new Date(now.getTime() + 60_000),
        consumedAt: null,
      });
      return repository.consumeMagicToken(tokenHash, now);
    };

    await expect(consume("initial-plan@example.com")).resolves.toMatchObject({
      workspaceId,
      plan: "pro",
    });
    await expect(consume("next-workspace@example.com")).resolves.toMatchObject({ plan: "free" });
  });

  it("stores standalone practice assignments by immutable source version and purges their tree", async () => {
    const repository = new MemoryRepository();
    const now = new Date("2026-09-18T12:00:00.000Z");
    const magicTokenHash = randomUUID();
    await repository.createMagicToken({
      id: randomUUID(),
      email: "assignment-owner@example.com",
      segment: "education",
      tokenHash: magicTokenHash,
      policyVersion: "test-v1",
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
    });
    const owner = (await repository.consumeMagicToken(magicTokenHash, now))!;
    const quizId = randomUUID();
    const content = {
      title: "Independent practice",
      description: "",
      questions: [],
    };
    await repository.createQuiz({
      id: quizId,
      workspaceId: owner.workspaceId,
      title: content.title,
      description: content.description,
      status: "draft",
      draft: content,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      quizId,
      version: 1,
      content: publishableRound(content.title),
      contentHash: randomUUID(),
      publishedAt: now,
    });
    const assignment = (expiresAt: Date) => ({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      purpose: "assignment" as const,
      sourceQuizVersionId: version.id,
      sourceSessionId: null,
      sourceReportId: null,
      title: "Independent practice",
      content,
      conceptKeys: [],
      timeMode: "flex" as const,
      genericTokenHash: randomUUID(),
      opensAt: now,
      closesAt: new Date(expiresAt.getTime() - 60_000),
      expiresAt,
      closedAt: null,
      createdBy: owner.userId,
      createdAt: now,
    });
    const expired = assignment(new Date(now.getTime() + 60 * 60_000));
    const retained = assignment(new Date(now.getTime() + 30 * 24 * 60 * 60_000));
    const personalTokenHash = randomUUID();
    await expect(
      repository.createPracticeAssignment(quizId, expired, [
        {
          id: randomUUID(),
          workspaceId: owner.workspaceId,
          followupId: expired.id,
          sourceParticipantId: null,
          kind: "assignment_personal",
          label: "Learner 1",
          tokenHash: personalTokenHash,
          timeMultiplier: 1,
          expiresAt: expired.closesAt,
          revokedAt: null,
          createdAt: now,
        },
      ]),
    ).resolves.toBe(true);
    await expect(repository.createPracticeAssignment(quizId, retained, [])).resolves.toBe(true);
    await repository.createOrGetFollowupAttempt({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      followupId: expired.id,
      accessTokenId: null,
      sourceParticipantId: null,
      attemptTokenHash: randomUUID(),
      status: "completed",
      phase: "completed",
      currentIndex: 0,
      version: 1,
      timeMultiplier: 1,
      questionOpenedAt: now,
      deadlineAt: null,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const history = await repository.listFollowupHistory(owner.workspaceId, {
      limit: 10,
      quizId,
      now,
    });
    expect(history.items).toHaveLength(2);
    expect(history.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expired.id,
          purpose: "assignment",
          sourceQuizVersionId: version.id,
          sourceSessionId: null,
          sourceReportId: null,
        }),
        expect.objectContaining({ id: retained.id, purpose: "assignment" }),
      ]),
    );
    expect(
      await repository.getFollowupAccessByToken(expired.id, personalTokenHash, now),
    ).toMatchObject({ kind: "assignment_personal" });
    expect(await repository.getFollowupProgress(owner.workspaceId, expired.id)).toEqual({
      attemptCount: 1,
      completedAttemptCount: 1,
    });
    expect(await repository.getFollowupProgress(randomUUID(), expired.id)).toBeNull();
    const retainedAccess = {
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      followupId: retained.id,
      sourceParticipantId: null,
      kind: "assignment_personal" as const,
      label: "Learner 2",
      tokenHash: randomUUID(),
      timeMultiplier: 1 as const,
      expiresAt: retained.closesAt,
      revokedAt: null,
      createdAt: now,
    };
    await expect(
      repository.createAssignmentPersonalAccess(
        { ...retainedAccess, kind: "accommodation", timeMultiplier: 1.5 },
        1,
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      repository.createAssignmentPersonalAccess(retainedAccess, 1),
    ).resolves.toMatchObject({ id: retainedAccess.id });
    expect(
      await repository.revokeFollowupAccess(owner.workspaceId, retained.id, retainedAccess.id, now),
    ).toBe(true);
    await expect(
      repository.createAssignmentPersonalAccess(
        { ...retainedAccess, id: randomUUID(), tokenHash: randomUUID(), revokedAt: null },
        1,
      ),
    ).rejects.toBeInstanceOf(FollowupAccessLimitError);
    await expect(
      repository.createAssignmentPersonalAccess(
        { ...retainedAccess, workspaceId: randomUUID(), id: randomUUID(), tokenHash: randomUUID() },
        1,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.createAssignmentPersonalAccess(
        {
          ...retainedAccess,
          followupId: expired.id,
          id: randomUUID(),
          tokenHash: randomUUID(),
          createdAt: expired.closesAt,
        },
        100,
      ),
    ).resolves.toBeNull();
    await repository.closeFollowup(owner.workspaceId, retained.id, now);
    await expect(
      repository.createAssignmentPersonalAccess(
        { ...retainedAccess, id: randomUUID(), tokenHash: randomUUID() },
        100,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.createPracticeAssignment(
        quizId,
        { ...assignment(retained.expiresAt), conceptKeys: ["invalid"] },
        [],
      ),
    ).rejects.toThrow("cannot store recovery concepts");
    await expect(repository.createFollowup(assignment(retained.expiresAt), [])).rejects.toThrow(
      "require atomic source validation",
    );
    const nextVersion = await repository.publishQuiz({
      ...version,
      id: randomUUID(),
      version: 2,
      contentHash: randomUUID(),
      publishedAt: new Date(now.getTime() + 1),
    });
    const staleSourceAssignment = assignment(retained.expiresAt);
    await expect(
      repository.createPracticeAssignment(quizId, staleSourceAssignment, []),
    ).resolves.toBe(false);
    expect(await repository.getFollowup(owner.workspaceId, staleSourceAssignment.id)).toBeNull();
    const archivedSourceAssignment = {
      ...assignment(retained.expiresAt),
      sourceQuizVersionId: nextVersion.id,
    };
    await repository.archiveQuiz(owner.workspaceId, quizId, true);
    await expect(
      repository.createPracticeAssignment(quizId, archivedSourceAssignment, []),
    ).resolves.toBe(false);
    expect(await repository.getFollowup(owner.workspaceId, archivedSourceAssignment.id)).toBeNull();

    expect(
      await repository.purgeExpiredPracticeAssignments(new Date(expired.expiresAt.getTime() + 1)),
    ).toBe(1);
    expect(await repository.getFollowup(owner.workspaceId, expired.id)).toBeNull();
    expect(repository.followupAccess.size).toBe(1);
    expect(await repository.getFollowup(owner.workspaceId, retained.id)).not.toBeNull();

    await repository.deleteAccount(owner.userId);
    expect(repository.followups.size).toBe(0);
    expect(repository.followupAccess.size).toBe(0);
  });

  it("filters follow-up purpose before applying history pagination", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const quizId = randomUUID();
    const versionId = randomUUID();
    const assignmentId = randomUUID();
    const now = new Date("2026-09-18T12:00:00.000Z");
    const content = publishableRound("Purpose-filtered history");
    repository.versions.set(versionId, {
      id: versionId,
      workspaceId,
      quizId,
      version: 1,
      content,
      contentHash: randomUUID(),
      publishedAt: new Date(now.getTime() - 120_000),
    });
    repository.followups.set(assignmentId, {
      id: assignmentId,
      workspaceId,
      purpose: "assignment",
      sourceQuizVersionId: versionId,
      sourceSessionId: null,
      sourceReportId: null,
      title: "Older assignment",
      content,
      conceptKeys: [],
      timeMode: "flex",
      genericTokenHash: randomUUID(),
      opensAt: new Date(now.getTime() - 60_000),
      closesAt: new Date(now.getTime() + 60_000),
      expiresAt: new Date(now.getTime() + 120_000),
      closedAt: null,
      createdBy: null,
      createdAt: new Date(now.getTime() - 60_000),
    });
    for (let index = 0; index < 51; index += 1) {
      const recoveryId = randomUUID();
      repository.followups.set(recoveryId, {
        id: recoveryId,
        workspaceId,
        purpose: "recovery",
        sourceQuizVersionId: versionId,
        sourceSessionId: randomUUID(),
        sourceReportId: randomUUID(),
        title: `Newer recovery ${index + 1}`,
        content,
        conceptKeys: ["purpose-filter"],
        timeMode: "flex",
        genericTokenHash: randomUUID(),
        opensAt: new Date(now.getTime() - 60_000),
        closesAt: new Date(now.getTime() + 60_000),
        expiresAt: new Date(now.getTime() + 120_000),
        closedAt: null,
        createdBy: null,
        createdAt: new Date(now.getTime() - index),
      });
    }

    const mixedPage = await repository.listFollowupHistory(workspaceId, { limit: 50, now });
    expect(mixedPage.hasMore).toBe(true);
    expect(mixedPage.items.map(({ id }) => id)).not.toContain(assignmentId);

    const assignmentPage = await repository.listFollowupHistory(workspaceId, {
      limit: 50,
      purpose: "assignment",
      now,
    });
    expect(assignmentPage).toMatchObject({
      hasMore: false,
      items: [expect.objectContaining({ id: assignmentId, purpose: "assignment" })],
    });
  });

  it("retains only allowlisted product event fields until their expiry", async () => {
    const repository = new MemoryRepository();
    const now = new Date("2026-09-18T12:00:00.000Z");
    await repository.recordProductEvents([
      {
        id: randomUUID(),
        workspaceId: randomUUID(),
        name: "rehearsal_completed",
        occurredAt: now.toISOString(),
        dimensions: {
          scenario: "split_room",
          segment: "education",
          betaVersion: "p0-2026",
          durationBucket: "1_to_5m",
        },
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      },
    ]);
    expect(
      await repository.purgeProductEvents(new Date(now.getTime() + 29 * 24 * 60 * 60_000)),
    ).toBe(0);
    expect(repository.productEvents).toHaveLength(1);
    expect(
      await repository.purgeProductEvents(new Date(now.getTime() + 30 * 24 * 60 * 60_000)),
    ).toBe(1);
    expect(repository.productEvents).toHaveLength(0);
  });

  it("deletes product events with an owner workspace while preserving other workspaces", async () => {
    const repository = new MemoryRepository();
    const now = new Date("2026-09-18T12:00:00.000Z");
    const createOwner = async (label: string) => {
      const tokenHash = `${label}-${randomUUID()}`;
      await repository.createMagicToken({
        id: randomUUID(),
        email: `${label}@example.com`,
        segment: "workplace",
        tokenHash,
        policyVersion: "test-v1",
        expiresAt: new Date(now.getTime() + 60_000),
        consumedAt: null,
      });
      return (await repository.consumeMagicToken(tokenHash, now))!;
    };
    const deletedOwner = await createOwner("deleted-product-events");
    const retainedOwner = await createOwner("retained-product-events");
    const event = (workspaceId: string) => ({
      id: randomUUID(),
      workspaceId,
      name: "creation_completed" as const,
      occurredAt: now.toISOString(),
      dimensions: { creationPath: "blank" as const },
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    });
    await repository.recordProductEvents([event(deletedOwner.workspaceId)]);
    await repository.recordProductEvents([event(retainedOwner.workspaceId)]);

    await repository.deleteAccount(deletedOwner.userId);

    expect(repository.productEvents).toEqual([
      expect.objectContaining({ workspaceId: retainedOwner.workspaceId }),
    ]);
  });

  it("exposes failed report jobs consistently in detail and filtered history", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const quizId = randomUUID();
    const now = new Date("2026-09-18T12:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    const content = { title: "Failed report fixture", description: "", questions: [] };
    await repository.createQuiz({
      id: quizId,
      workspaceId,
      title: content.title,
      description: content.description,
      status: "draft",
      draft: content,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz(
      {
        id: randomUUID(),
        workspaceId,
        quizId,
        version: 1,
        content: publishableRound(content.title),
        contentHash: randomUUID(),
        publishedAt: now,
      },
      null,
    );
    const sessionId = randomUUID();
    await repository.createSession({
      id: sessionId,
      workspaceId,
      quizVersionId: version.id,
      hostId: randomUUID(),
      hostTokenHash: randomUUID(),
      state: createGameState({
        sessionId,
        code: "1234567",
        quiz: content,
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "friendly_only",
        },
      }),
      expiresAt,
      retentionExpiresAt: expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    const report: Report = {
      id: randomUUID(),
      sessionId,
      status: "pending",
      generatedAt: null,
      expiresAt: expiresAt.toISOString(),
      metrics: { participantCount: 0, completedCount: 0, answerCount: 0, accuracyPercent: 0 },
      questions: [],
      participants: [],
    };
    await repository.saveReport(workspaceId, report);
    const job = await repository.claimReportJob(now, new Date(now.getTime() + 60_000));
    expect(job).not.toBeNull();
    await repository.retryReportJob(job!, "terminal failure", now, true);

    expect(await repository.getReport(workspaceId, report.id)).toMatchObject({
      status: "failed",
      generatedAt: null,
    });
    expect(
      await repository.listReportHistory(workspaceId, { limit: 10, status: "failed", now }),
    ).toMatchObject({
      items: [expect.objectContaining({ id: report.id, status: "failed", generatedAt: null })],
    });
    expect(
      await repository.listReportHistory(workspaceId, { limit: 10, status: "pending", now }),
    ).toMatchObject({ items: [] });

    const firstResume = await repository.replaceCreatorResumeCredential({
      id: randomUUID(),
      workspaceId,
      sessionId,
      role: "cohost",
      purpose: "creator_resume",
      label: "Creator resume",
      tokenHash: randomUUID(),
      embedPolicyKeyHash: null,
      embedAllowedOrigins: [],
      createdBy: randomUUID(),
      expiresAt,
      revokedAt: null,
      createdAt: now,
    });
    expect(firstResume.revokedCredentialIds).toEqual([]);
    const secondResume = await repository.replaceCreatorResumeCredential({
      ...firstResume.credential,
      id: randomUUID(),
      tokenHash: randomUUID(),
      createdAt: new Date(now.getTime() + 1),
    });
    expect(secondResume.revokedCredentialIds).toEqual([firstResume.credential.id]);
    expect(secondResume.credential.revokedAt).toBeNull();
    const storedSession = repository.sessions.get(sessionId)!;
    const activeExpiry = storedSession.expiresAt;
    storedSession.expiresAt = new Date(0);
    await expect(
      repository.replaceCreatorResumeCredential({
        ...secondResume.credential,
        id: randomUUID(),
        tokenHash: randomUUID(),
        createdAt: new Date(now.getTime() + 2),
      }),
    ).rejects.toBeInstanceOf(SessionNotActiveError);
    storedSession.expiresAt = activeExpiry;

    const followupId = randomUUID();
    const opensAt = new Date(now.getTime() + 60 * 60_000);
    const closesAt = new Date(now.getTime() + 2 * 60 * 60_000);
    const followupExpiresAt = new Date(now.getTime() + 3 * 60 * 60_000);
    await repository.createFollowup(
      {
        id: followupId,
        workspaceId,
        purpose: "recovery",
        sourceQuizVersionId: version.id,
        sourceSessionId: sessionId,
        sourceReportId: report.id,
        title: "Lifecycle follow-up",
        content,
        conceptKeys: ["lifecycle"],
        timeMode: "flex",
        genericTokenHash: randomUUID(),
        opensAt,
        closesAt,
        expiresAt: followupExpiresAt,
        closedAt: null,
        createdBy: null,
        createdAt: now,
      },
      [],
    );
    expect(
      await repository.listFollowupHistory(workspaceId, {
        limit: 10,
        status: "scheduled",
        quizId,
        from: new Date(now.getTime() - 1),
        to: new Date(now.getTime() + 1),
        now,
      }),
    ).toMatchObject({
      items: [expect.objectContaining({ id: followupId, quizId, status: "scheduled" })],
    });
    expect(
      await repository.listFollowupHistory(workspaceId, {
        limit: 10,
        quizId: randomUUID(),
        now,
      }),
    ).toMatchObject({ items: [] });
    const reportStatusAt = async (at: Date) =>
      (await repository.listReportHistory(workspaceId, { limit: 10, now: at })).items[0];
    await expect(reportStatusAt(now)).resolves.toMatchObject({
      followupId,
      followupStatus: "scheduled",
    });
    await expect(reportStatusAt(new Date(opensAt.getTime() + 1))).resolves.toMatchObject({
      followupStatus: "open",
    });
    await expect(reportStatusAt(new Date(closesAt.getTime() + 1))).resolves.toMatchObject({
      followupStatus: "closed",
    });
    await expect(reportStatusAt(followupExpiresAt)).resolves.toMatchObject({
      followupStatus: "expired",
    });
  });

  it("orders Rounds deterministically when update timestamps match", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const updatedAt = new Date("2026-09-18T12:00:00.000Z");
    const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
    for (const [index, id] of ids.entries()) {
      await repository.createQuiz({
        id,
        workspaceId,
        title: `Round ${index + 1}`,
        description: "",
        status: "draft",
        draft: { title: `Round ${index + 1}`, description: "", questions: [] },
        currentVersionId: null,
        createdAt: updatedAt,
        updatedAt,
      });
    }

    expect((await repository.listQuizzes(workspaceId)).map(({ id }) => id)).toEqual([
      ids[1],
      ids[0],
    ]);
  });

  it("summarizes the latest retained hosting time without crossing workspaces", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const quizId = randomUUID();
    const unhostedQuizId = randomUUID();
    const otherQuizId = randomUUID();
    const draft = { title: "Hosted Round", description: "", questions: [] };
    const createdAt = new Date("2026-09-18T12:00:00.000Z");
    for (const [id, owner, title] of [
      [quizId, workspaceId, "Hosted Round"],
      [unhostedQuizId, workspaceId, "Not hosted"],
      [otherQuizId, otherWorkspaceId, "Other workspace Round"],
    ] as const) {
      await repository.createQuiz({
        id,
        workspaceId: owner,
        title,
        description: "",
        status: "draft",
        draft: { ...draft, title },
        currentVersionId: null,
        createdAt,
        updatedAt: createdAt,
      });
    }

    const firstVersion = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId,
      quizId,
      version: 1,
      content: publishableRound(draft.title),
      contentHash: randomUUID(),
      publishedAt: createdAt,
    });
    const secondVersion = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId,
      quizId,
      version: 2,
      content: publishableRound(draft.title),
      contentHash: randomUUID(),
      publishedAt: new Date(createdAt.getTime() + 1_000),
    });
    const otherVersion = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: otherWorkspaceId,
      quizId: otherQuizId,
      version: 1,
      content: publishableRound("Other workspace Round"),
      contentHash: randomUUID(),
      publishedAt: createdAt,
    });
    const expiry = new Date("2030-01-01T00:00:00.000Z");
    const host = async (owner: string, quizVersionId: string, hostedAt: Date, code: string) => {
      const sessionId = randomUUID();
      await repository.createSession({
        id: sessionId,
        workspaceId: owner,
        quizVersionId,
        hostId: randomUUID(),
        hostTokenHash: randomUUID(),
        state: createGameState({
          sessionId,
          code,
          quiz: draft,
          settings: {
            audienceLimit: 20,
            scoringMode: "accuracy",
            resultVisibility: "private",
            allowLateJoin: true,
            nicknamePolicy: "friendly_only",
          },
        }),
        expiresAt: expiry,
        retentionExpiresAt: expiry,
        createdAt: hostedAt,
        updatedAt: hostedAt,
      });
    };
    const firstHostedAt = new Date("2026-09-18T12:01:00.000Z");
    const lastHostedAt = new Date("2026-09-18T12:02:00.000Z");
    await host(workspaceId, firstVersion.id, firstHostedAt, "1234567");
    await host(workspaceId, secondVersion.id, lastHostedAt, "2345678");
    await host(otherWorkspaceId, otherVersion.id, new Date("2026-09-18T12:03:00.000Z"), "3456789");

    const listed = await repository.listQuizzes(workspaceId);
    expect(listed.find((quiz) => quiz.id === quizId)?.lastHostedAt).toEqual(lastHostedAt);
    expect(listed.find((quiz) => quiz.id === unhostedQuizId)?.lastHostedAt).toBeNull();
    expect(listed).toHaveLength(2);
  });

  it("persists partial operational feature updates with an audit record", async () => {
    const repository = new MemoryRepository();

    expect(await repository.getOperationalFeatures()).toMatchObject({
      signups: true,
      sessionCreation: true,
      mediaUploads: true,
      updatedAt: null,
    });
    expect(
      await repository.updateOperationalFeatures(
        { signups: false, mediaUploads: false },
        "request-features-1",
      ),
    ).toMatchObject({ signups: false, sessionCreation: true, mediaUploads: false });
    expect(repository.audits.at(-1)).toMatchObject({
      action: "operations.features.update",
      targetType: "operational_features",
      targetId: "global",
      requestId: "request-features-1",
      metadata: {
        before: { signups: true, sessionCreation: true, mediaUploads: true },
        after: { signups: false, sessionCreation: true, mediaUploads: false },
      },
    });
  });

  it("consumes each magic link once", async () => {
    const repository = new MemoryRepository();
    const tokenHash = "hash";
    await repository.createMagicToken({
      id: randomUUID(),
      email: "creator@example.com",
      segment: "education",
      tokenHash,
      policyVersion: "test-v1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });

    const creator = await repository.consumeMagicToken(tokenHash, new Date());
    expect(creator).not.toBeNull();
    const exported = await repository.exportAccount(creator!.userId);
    expect(exported.consentRecords).toHaveLength(2);
    expect(await repository.consumeMagicToken(tokenHash, new Date())).toBeNull();
  });

  it("defaults legacy report trust mode in account exports", async () => {
    const repository = new MemoryRepository();
    const now = new Date("2026-09-23T12:00:00.000Z");
    const tokenHash = `legacy-report-export-${randomUUID()}`;
    await repository.createMagicToken({
      id: randomUUID(),
      email: `legacy-report-${randomUUID()}@example.com`,
      segment: "education",
      tokenHash,
      policyVersion: "test-v1",
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
    });
    const owner = await repository.consumeMagicToken(tokenHash, now);
    expect(owner).not.toBeNull();

    const draft = publishableRound("Legacy report export");
    const quiz = await repository.createQuiz({
      id: randomUUID(),
      workspaceId: owner!.workspaceId,
      title: draft.title,
      description: draft.description,
      status: "draft",
      draft,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = await repository.publishQuiz({
      id: randomUUID(),
      workspaceId: owner!.workspaceId,
      quizId: quiz.id,
      version: 1,
      content: draft,
      contentHash: randomUUID(),
      publishedAt: now,
    });
    const sessionId = randomUUID();
    const retentionExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
    await repository.createSession({
      id: sessionId,
      workspaceId: owner!.workspaceId,
      quizVersionId: version.id,
      hostId: owner!.userId,
      hostTokenHash: randomUUID(),
      state: createGameState({
        sessionId,
        code: "7654321",
        quiz: draft,
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "friendly_only",
        },
      }),
      expiresAt: new Date(now.getTime() + 60_000),
      retentionExpiresAt,
      createdAt: now,
      updatedAt: now,
    });
    const legacyReport: Report = {
      id: randomUUID(),
      sessionId,
      status: "ready",
      generatedAt: now.toISOString(),
      expiresAt: retentionExpiresAt.toISOString(),
      metrics: {
        participantCount: 0,
        completedCount: 0,
        answerCount: 0,
        accuracyPercent: 0,
      },
      questions: [],
      participants: [],
    };
    await repository.saveReport(owner!.workspaceId, legacyReport);
    expect(repository.reports.get(legacyReport.id)).not.toHaveProperty("trustMode");

    const exported = await repository.exportAccount(owner!.userId);
    expect(exported.reports).toEqual([
      expect.objectContaining({ id: legacyReport.id, trustMode: "learning" }),
    ]);
  });

  it("exports shared workspace membership without exporting another owner's data", async () => {
    const repository = new MemoryRepository();
    const now = new Date();
    await repository.createMagicToken({
      id: randomUUID(),
      email: "owner@example.com",
      segment: "education",
      tokenHash: "owner-export-token",
      policyVersion: "test-v1",
      expiresAt: new Date(now.getTime() + 60_000),
      consumedAt: null,
    });
    const owner = await repository.consumeMagicToken("owner-export-token", now);
    expect(owner).not.toBeNull();
    await repository.createMediaAsset({
      id: randomUUID(),
      workspaceId: owner!.workspaceId,
      objectKey: `media/${owner!.workspaceId}/private.png`,
      mimeType: "image/png",
      sizeBytes: 128,
      scanStatus: "clean",
      altText: "Private owner asset",
      createdAt: now,
    });
    await repository.createWorkspaceInvitation({
      id: randomUUID(),
      workspaceId: owner!.workspaceId,
      email: "viewer@example.com",
      role: "viewer",
      tokenHash: "viewer-invitation-token",
      invitedBy: owner!.userId,
      expiresAt: new Date(now.getTime() + 60_000),
      acceptedAt: null,
      revokedAt: null,
      createdAt: now,
    });
    const viewer = await repository.acceptWorkspaceInvitation(
      "viewer-invitation-token",
      now,
      "test-v1",
    );
    expect(viewer).not.toBeNull();

    const exported = await repository.exportAccount(viewer!.userId);
    expect(exported.workspaceMemberships).toEqual([
      expect.objectContaining({ id: owner!.workspaceId, role: "viewer" }),
    ]);
    expect(exported.workspaces).toEqual([]);
    expect(exported.mediaAssets).toEqual([]);
    expect(exported.quizzes).toEqual([]);
    expect(exported.auditEvents).toEqual([]);
  });

  it("isolates media assets and tracks scan promotion", async () => {
    const repository = new MemoryRepository();
    const mediaId = randomUUID();
    const workspaceId = randomUUID();
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId,
      objectKey: `quarantine/${workspaceId}/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 128,
      scanStatus: "pending",
      altText: "A labelled diagram",
      createdAt: new Date(),
    });

    expect(await repository.getMediaAsset(randomUUID(), mediaId)).toBeNull();
    const promoted = await repository.updateMediaAsset(workspaceId, mediaId, {
      scanStatus: "clean",
      objectKey: `media/${workspaceId}/${mediaId}.png`,
    });
    expect(promoted).toMatchObject({
      scanStatus: "clean",
      objectKey: `media/${workspaceId}/${mediaId}.png`,
    });
    expect((await repository.listMediaAssets(workspaceId)).map(({ id }) => id)).toEqual([mediaId]);
    expect(await repository.deleteMediaAsset(randomUUID(), mediaId)).toBe(false);
    expect(await repository.deleteMediaAsset(workspaceId, mediaId)).toBe(true);
  });

  it("applies each billing event once and ignores stale entitlement changes", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const newer = new Date("2026-09-14T12:00:00.000Z");
    const event = {
      providerEventId: "evt_new",
      eventType: "checkout.session.completed",
      providerCreatedAt: newer,
      workspaceId,
      plan: "pro" as const,
      status: "active",
      customerId: "cus_test",
      subscriptionId: "sub_test",
    };

    expect(await repository.applyBillingEvent(event)).toBe(true);
    expect(await repository.applyBillingEvent(event)).toBe(false);
    expect(
      await repository.applyBillingEvent({
        providerEventId: "evt_stale",
        eventType: "customer.subscription.deleted",
        providerCreatedAt: new Date("2026-09-14T11:00:00.000Z"),
        workspaceId,
        plan: "free",
        status: "canceled",
      }),
    ).toBe(true);
    expect(await repository.getBillingProfile(workspaceId)).toMatchObject({
      plan: "pro",
      customerId: "cus_test",
      subscriptionId: "sub_test",
    });
  });

  it("enforces the published quiz limit for publishing and restoring", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const now = new Date();
    const draft = { title: "Fixture", description: "", questions: [] };
    const first = await repository.createQuiz({
      id: randomUUID(),
      workspaceId,
      title: "First",
      description: "",
      status: "draft",
      draft: { ...draft, title: "First" },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const second = await repository.createQuiz({
      id: randomUUID(),
      workspaceId,
      title: "Second",
      description: "",
      status: "draft",
      draft: { ...draft, title: "Second" },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const third = await repository.createQuiz({
      id: randomUUID(),
      workspaceId,
      title: "Third",
      description: "",
      status: "draft",
      draft: { ...draft, title: "Third" },
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    const version = (quizId: string, title: string) => ({
      id: randomUUID(),
      workspaceId,
      quizId,
      version: 1,
      content: publishableRound(title),
      contentHash: randomUUID(),
      publishedAt: now,
    });

    await repository.publishQuiz(version(first.id, first.title), 1);
    await expect(
      repository.publishQuiz(version(second.id, second.title), 1),
    ).rejects.toBeInstanceOf(PublishedQuizLimitError);
    await repository.archiveQuiz(workspaceId, first.id, true, 1);
    await repository.publishQuiz(version(second.id, second.title), 1);
    await expect(repository.archiveQuiz(workspaceId, first.id, false, 1)).rejects.toBeInstanceOf(
      PublishedQuizLimitError,
    );
    expect((await repository.getQuiz(workspaceId, first.id))?.status).toBe("archived");
    expect((await repository.getQuiz(workspaceId, third.id))?.status).toBe("draft");
  });

  it("paginates chat rows and limits reaction reads to the requested page", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const sessionId = randomUUID();
    const participantId = randomUUID();
    const timestamps = [3, 2, 1].map((offset) => new Date(`2026-09-15T12:00:0${offset}.000Z`));
    const messages = timestamps.map((createdAt) => ({
      id: randomUUID(),
      workspaceId,
      sessionId,
      participantId,
      actorId: null,
      staffCredentialId: null,
      replyToId: null,
      body: createdAt.toISOString(),
      authorAlias: "Learner",
      identityModeAtCreation: "alias_public" as const,
      status: "published" as const,
      pinned: false,
      idempotencyKey: randomUUID(),
      audienceSeq: 1,
      createdAt,
      updatedAt: createdAt,
    }));
    for (const message of messages) repository.chatMessages.set(message.id, message);
    repository.chatReactions.set(`${messages[0]!.id}:${participantId}`, {
      workspaceId,
      sessionId,
      messageId: messages[0]!.id,
      participantId,
      reaction: "insight",
      updatedAt: timestamps[0]!,
    });

    const firstPage = await repository.listChatMessages(workspaceId, sessionId, { limit: 2 });
    const secondPage = await repository.listChatMessages(workspaceId, sessionId, {
      cursor: { createdAt: firstPage[1]!.createdAt, id: firstPage[1]!.id },
      limit: 2,
    });
    const reactions = await repository.listChatReactions(
      workspaceId,
      sessionId,
      firstPage.map((message) => message.id),
    );

    expect(firstPage.map((message) => message.id)).toEqual([messages[0]!.id, messages[1]!.id]);
    expect(secondPage.map((message) => message.id)).toEqual([messages[2]!.id]);
    expect(reactions).toEqual([
      expect.objectContaining({ messageId: messages[0]!.id, reaction: "insight" }),
    ]);
  });
});
