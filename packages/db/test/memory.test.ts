import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository, PublishedQuizLimitError } from "../src/index.js";

describe("memory repository", () => {
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
      content: { ...draft, title },
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
