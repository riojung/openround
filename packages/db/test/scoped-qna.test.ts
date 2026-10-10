import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createScopedQnaRepository,
  createAudienceScopeRepository,
  createPresentationSessionRepository,
  MemoryRepository,
} from "../src/index.js";
import { expectScopedQnaConformance } from "./support/scoped-qna-conformance.js";

describe("scoped Q&A", () => {
  it("shares durable rules for moderation, privacy, receipts, votes, lifecycle and deletion", async () => {
    const repository = new MemoryRepository();
    const qna = createScopedQnaRepository(repository);
    expect(createScopedQnaRepository(repository)).toBe(qna);
    const token = randomUUID();
    await repository.createMagicToken({
      id: randomUUID(),
      email: "scoped@example.com",
      segment: "education",
      tokenHash: token,
      policyVersion: "test",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    const creator = (await repository.consumeMagicToken(token, new Date()))!;
    await expectScopedQnaConformance({
      repository,
      qna,
      scopes: createAudienceScopeRepository(repository),
      sessions: createPresentationSessionRepository(repository),
      workspaceId: creator.workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: creator.userId,
    });
  });
});
