import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import {
  createPresentationRepository,
  type MemoryPresentationRepository,
  MemoryRepository,
} from "../src/index.js";
import {
  expectPresentationPackUndoConformance,
  expectPresentationPackUndoRetentionConformance,
} from "./support/presentation-pack-undo-conformance.js";

describe("Presentation Pack update undo", () => {
  it("retains old sources and accepted baseline media with scoped, idempotent, fenced Undo", async () => {
    await expectPresentationPackUndoConformance({
      repository: new MemoryRepository(),
      workspaceId: randomUUID(),
      otherWorkspaceId: randomUUID(),
      editorId: randomUUID(),
    });
  });

  it("protects only the current source outside retention bounds and preserves its aged receipt", async () => {
    const repository = new MemoryRepository();
    const presentations = createPresentationRepository(repository) as MemoryPresentationRepository;
    const workspaceId = randomUUID();
    const internals = presentations as unknown as {
      mutations: Map<string, { createdAt: Date; recoveryPackUpdateSourceRevision: number | null }>;
      pruneHistory(presentationId: string, now: Date): Promise<void>;
    };
    await expectPresentationPackUndoRetentionConformance({
      presentations,
      workspaceId,
      editorId: randomUUID(),
      harness: {
        async ageReceiptAndOverflowHistory(current, mutationIds) {
          const oldDate = new Date(Date.now() - 31 * 86_400_000);
          for (const mutationId of mutationIds) {
            internals.mutations.get(`${workspaceId}:${mutationId}`)!.createdAt = oldDate;
          }
          for (let revision = 100; revision < 125; revision++) {
            presentations.history.set(`${current.id}:${revision}`, {
              id: randomUUID(),
              workspaceId,
              presentationId: current.id,
              revision,
              draft: structuredClone(current.draft),
              draftSchemaVersion: current.draftSchemaVersion,
              savedBy: current.lastEditedBy,
              mutationId: null,
              createdAt: new Date(),
            });
          }
        },
        prune: (presentationId) => internals.pruneHistory(presentationId, new Date()),
        async historyRevisions(presentationId) {
          return [...presentations.history.values()]
            .filter((snapshot) => snapshot.presentationId === presentationId)
            .map(({ revision }) => revision);
        },
        async receiptSource(mutationId) {
          return internals.mutations.get(`${workspaceId}:${mutationId}`)
            ?.recoveryPackUpdateSourceRevision;
        },
      },
    });
  });
});
