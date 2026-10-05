import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGameState } from "@openround/game-engine";
import {
  createPresentationSessionRepository,
  MemoryRepository,
  type CreatorContext,
} from "../src/index.js";
import { createLibraryDeletionFixture } from "./support/library-deletion-fixtures.js";

async function createOwner(repository: MemoryRepository): Promise<CreatorContext> {
  const tokenHash = randomUUID();
  const now = new Date();
  await repository.createMagicToken({
    id: randomUUID(),
    email: `${randomUUID()}@example.com`,
    segment: "workplace",
    tokenHash,
    policyVersion: "test-v1",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  const owner = await repository.consumeMagicToken(tokenHash, now);
  if (!owner) throw new Error("Expected fixture owner");
  return owner;
}

function roundSession(
  owner: CreatorContext,
  fixture: Awaited<ReturnType<typeof createLibraryDeletionFixture>>,
) {
  const id = randomUUID();
  return {
    id,
    workspaceId: owner.workspaceId,
    quizVersionId: fixture.roundVersion.id,
    hostId: owner.userId,
    hostTokenHash: randomUUID(),
    state: createGameState({
      sessionId: id,
      code: "2345678",
      quiz: fixture.content,
      settings: {
        audienceLimit: 20,
        scoringMode: "accuracy",
        resultVisibility: "private",
        allowLateJoin: true,
        nicknamePolicy: "custom",
      },
    }),
    expiresAt: new Date(fixture.now.getTime() - 1),
    retentionExpiresAt: new Date(fixture.now.getTime() + 86_400_000),
    createdAt: fixture.now,
    updatedAt: fixture.now,
  };
}

describe("permanent Library deletion in memory", () => {
  it("requires archived tenant-owned artifacts and cleans their metadata without removing media assets", async () => {
    const repository = new MemoryRepository();
    const owner = await createOwner(repository);
    const secondUserId = randomUUID();
    const fixture = await createLibraryDeletionFixture(repository, owner, secondUserId);
    const foreignWorkspaceId = randomUUID();
    expect(await repository.deleteQuiz(foreignWorkspaceId, fixture.round.id)).toBe("not_found");
    expect(
      await fixture.presentations.deletePresentation(foreignWorkspaceId, fixture.presentation.id),
    ).toBe("not_found");
    expect(await repository.deleteQuiz(owner.workspaceId, fixture.round.id)).toBe("not_archived");
    expect(
      await fixture.presentations.deletePresentation(owner.workspaceId, fixture.presentation.id),
    ).toBe("not_archived");
    expect(await repository.listMediaReferences(owner.workspaceId, fixture.mediaId)).toHaveLength(
      8,
    );

    await repository.archiveQuiz(owner.workspaceId, fixture.round.id, true);
    await fixture.presentations.archivePresentation(
      owner.workspaceId,
      fixture.presentation.id,
      true,
    );
    expect(await repository.deleteQuiz(owner.workspaceId, fixture.round.id)).toBe("deleted");
    expect(
      await fixture.presentations.getPresentation(owner.workspaceId, fixture.presentation.id),
    ).not.toBeNull();
    expect(await fixture.favorites.listFavorites(owner.workspaceId, secondUserId)).toMatchObject([
      { artifactId: fixture.presentation.id },
    ]);
    expect(
      await fixture.presentations.deletePresentation(owner.workspaceId, fixture.presentation.id),
    ).toBe("deleted");
    expect(await repository.deleteQuiz(owner.workspaceId, fixture.round.id)).toBe("not_found");
    expect(
      await fixture.presentations.deletePresentation(owner.workspaceId, fixture.presentation.id),
    ).toBe("not_found");
    expect(await repository.getQuizVersion(owner.workspaceId, fixture.roundVersion.id)).toBeNull();
    expect(
      await fixture.presentations.getPresentationVersion(
        owner.workspaceId,
        fixture.presentationVersion.id,
      ),
    ).toBeNull();
    expect(await repository.listQuizDraftHistory(owner.workspaceId, fixture.round.id)).toEqual([]);
    expect(
      await fixture.presentations.listPresentationHistory(
        owner.workspaceId,
        fixture.presentation.id,
      ),
    ).toEqual([]);
    expect(repository.quizDraftMutations.size).toBe(0);
    for (const userId of [owner.userId, secondUserId]) {
      expect(await fixture.favorites.listFavorites(owner.workspaceId, userId)).toEqual([]);
    }
    expect(await fixture.groups.listArtifacts(fixture.group.id)).toEqual([]);
    expect(await fixture.groups.listSchedule(fixture.group.id)).toEqual([]);
    expect(await repository.listMediaReferences(owner.workspaceId)).toEqual([]);
    expect(await repository.getMediaAsset(owner.workspaceId, fixture.mediaId)).not.toBeNull();
    expect(
      await fixture.favorites.setFavorite({
        workspaceId: owner.workspaceId,
        userId: owner.userId,
        artifactType: "round",
        artifactId: fixture.round.id,
        favorite: true,
        now: fixture.now,
      }),
    ).toBeNull();
  });

  it("preserves expired retained sessions and closed practice assignments", async () => {
    const repository = new MemoryRepository();
    const owner = await createOwner(repository);
    const fixture = await createLibraryDeletionFixture(repository, owner, randomUUID());
    const session = roundSession(owner, fixture);
    await repository.createSession(session);
    const assignment = {
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      purpose: "assignment" as const,
      sourceQuizVersionId: fixture.roundVersion.id,
      sourceSessionId: null,
      sourceReportId: null,
      title: "Closed assignment",
      content: fixture.content,
      conceptKeys: [],
      timeMode: "flex" as const,
      genericTokenHash: randomUUID(),
      opensAt: fixture.now,
      closesAt: new Date(fixture.now.getTime() + 60_000),
      expiresAt: new Date(fixture.now.getTime() + 86_400_000),
      closedAt: fixture.now,
      createdBy: owner.userId,
      createdAt: fixture.now,
    };
    expect(await repository.createPracticeAssignment(fixture.round.id, assignment, [])).toBe(true);
    const presentationSessions = createPresentationSessionRepository(repository);
    const presentationSession = await presentationSessions.createSession({
      id: randomUUID(),
      workspaceId: owner.workspaceId,
      presentationId: fixture.presentation.id,
      presentationVersionId: fixture.presentationVersion.id,
      title: fixture.presentationContent.title,
      content: fixture.presentationContent,
      code: "3456789",
      status: "finished",
      phase: "finished",
      currentBlockIndex: 0,
      revision: 0,
      createdBy: owner.userId,
      createdAt: fixture.now,
      updatedAt: fixture.now,
      finishedAt: fixture.now,
      liveExpiresAt: new Date(fixture.now.getTime() - 1),
      retentionExpiresAt: new Date(fixture.now.getTime() + 86_400_000),
    });
    await repository.archiveQuiz(owner.workspaceId, fixture.round.id, true);
    await fixture.presentations.archivePresentation(
      owner.workspaceId,
      fixture.presentation.id,
      true,
    );
    expect(await repository.deleteQuiz(owner.workspaceId, fixture.round.id)).toBe("in_use");
    expect(
      await fixture.presentations.deletePresentation(owner.workspaceId, fixture.presentation.id),
    ).toBe("in_use");
    expect(await repository.getSessionById(session.id)).not.toBeNull();
    expect(await presentationSessions.getSessionById(presentationSession.id)).not.toBeNull();
    expect(await repository.deleteSession(owner.workspaceId, session.id)).toBe(true);
    expect(await repository.deleteQuiz(owner.workspaceId, fixture.round.id)).toBe("in_use");
    expect(await repository.getFollowup(owner.workspaceId, assignment.id)).toMatchObject({
      closedAt: fixture.now,
    });
    expect(
      await presentationSessions.deleteSession(
        owner.workspaceId,
        presentationSession.id,
        fixture.now,
      ),
    ).toEqual({ status: "deleted" });
    expect(
      await fixture.presentations.deletePresentation(owner.workspaceId, fixture.presentation.id),
    ).toBe("deleted");
    await repository.deleteAccount(owner.userId);
    expect(await repository.getFollowup(owner.workspaceId, assignment.id)).toBeNull();
    expect(await repository.getQuizVersion(owner.workspaceId, fixture.roundVersion.id)).toBeNull();
  });

  it("blocks a pending room claim and stale media synchronization after deletion", async () => {
    const repository = new MemoryRepository();
    const owner = await createOwner(repository);
    const fixture = await createLibraryDeletionFixture(repository, owner, randomUUID());
    const history = await repository.listQuizDraftHistory(owner.workspaceId, fixture.round.id);
    const session = roundSession(owner, fixture);
    await repository.archiveQuiz(owner.workspaceId, fixture.round.id, true);
    const pendingSession = repository.createSession(session);
    expect(await repository.deleteQuiz(owner.workspaceId, fixture.round.id)).toBe("deleted");
    await expect(pendingSession).rejects.toThrow("Quiz version not found");
    expect(await repository.getSessionById(session.id)).toBeNull();
    await repository.replaceMediaReferences(owner.workspaceId, "quiz_history", history[0]!.id, [
      fixture.mediaId,
    ]);
    expect(
      (await repository.listMediaReferences(owner.workspaceId)).every((reference) =>
        reference.ownerType.startsWith("presentation_"),
      ),
    ).toBe(true);
  });
});
