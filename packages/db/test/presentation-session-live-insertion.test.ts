import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";
import { MemoryRepository, createPresentationSessionRepository } from "../src/index.js";
import { presentationSessionConformanceContent } from "./support/presentation-session-conformance.js";
import { expectPresentationLiveInsertionConformance } from "./support/presentation-live-insertion-conformance.js";

describe("Presentation live insertion persistence", () => {
  it("keeps memory on the shared live insertion CAS, timer and receipt contract", async () => {
    const memory = new MemoryRepository();
    const workspaceId = randomUUID();
    await expectPresentationLiveInsertionConformance({
      repository: createPresentationSessionRepository(memory),
      workspaceId,
      presentationId: randomUUID(),
      presentationVersionId: randomUUID(),
      createdBy: randomUUID(),
      content: presentationSessionConformanceContent(),
      beginWorkspaceDeletion: async () => {
        await memory.claimWorkspaceMediaDeletion(workspaceId);
      },
    });
  });
});
