import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PresentationDraft, QuizDraft } from "@openround/contracts";
import { createPresentationRepository, MemoryRepository } from "../src/index.js";

function roundDraft(title: string): QuizDraft {
  return { title, description: "", questions: [] };
}

function presentationDraft(title: string): PresentationDraft {
  return {
    title,
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 1,
    blocks: [
      {
        id: randomUUID(),
        kind: "content",
        layout: "title_body",
        title: "Opening",
        body: "",
        mediaId: null,
        mediaAlt: null,
        speakerNotes: "",
      },
    ],
  };
}

describe("draft mutation replay", () => {
  it("replays the acknowledged Round save and restore after an intervening editor", async () => {
    const repository = new MemoryRepository();
    const workspaceId = randomUUID();
    const quizId = randomUUID();
    const firstEditorId = randomUUID();
    const secondEditorId = randomUUID();
    const original = roundDraft("Original");
    const now = new Date("2026-09-20T12:00:00.000Z");
    await repository.createQuiz({
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

    const firstMutationId = randomUUID();
    const firstMutation = {
      workspaceId,
      quizId,
      draft: roundDraft("First editor save"),
      expectedRevision: 0,
      mutationId: firstMutationId,
      editorId: firstEditorId,
      schemaVersion: 1,
      draftHash: "first-editor-save",
    };
    await repository.updateQuizDraft(firstMutation);
    await repository.updateQuizDraft({
      ...firstMutation,
      draft: roundDraft("Intervening editor save"),
      expectedRevision: 1,
      mutationId: randomUUID(),
      editorId: secondEditorId,
      draftHash: "intervening-editor-save",
    });

    await expect(repository.updateQuizDraft(firstMutation)).resolves.toMatchObject({
      draftRevision: 1,
      draft: { title: "First editor save" },
      lastEditedBy: firstEditorId,
    });
    await expect(repository.getQuiz(workspaceId, quizId)).resolves.toMatchObject({
      draftRevision: 2,
      draft: { title: "Intervening editor save" },
    });

    const restoreMutationId = randomUUID();
    const restoreInput = {
      workspaceId,
      quizId,
      historyRevision: 1,
      expectedRevision: 2,
      mutationId: restoreMutationId,
      editorId: firstEditorId,
    };
    await repository.restoreQuizDraftHistory(restoreInput);
    await repository.updateQuizDraft({
      ...firstMutation,
      draft: roundDraft("After restore"),
      expectedRevision: 3,
      mutationId: randomUUID(),
      editorId: secondEditorId,
      draftHash: "after-restore",
    });

    await expect(repository.restoreQuizDraftHistory(restoreInput)).resolves.toMatchObject({
      draftRevision: 3,
      draft: { title: "First editor save" },
      lastEditedBy: firstEditorId,
    });
    await expect(repository.getQuiz(workspaceId, quizId)).resolves.toMatchObject({
      draftRevision: 4,
      draft: { title: "After restore" },
    });
  });

  it("replays the acknowledged Presentation save and restore after an intervening editor", async () => {
    const repository = new MemoryRepository();
    const presentations = createPresentationRepository(repository);
    const workspaceId = randomUUID();
    const presentationId = randomUUID();
    const firstEditorId = randomUUID();
    const secondEditorId = randomUUID();
    const original = presentationDraft("Original");
    const now = new Date("2026-09-20T12:00:00.000Z");
    await presentations.createPresentation({
      id: presentationId,
      workspaceId,
      title: original.title,
      description: original.description,
      status: "draft",
      draft: original,
      draftRevision: 0,
      draftSchemaVersion: 1,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: firstEditorId,
      createdAt: now,
      updatedAt: now,
    });

    const noOpMutation = {
      workspaceId,
      presentationId,
      draft: original,
      expectedRevision: 0,
      mutationId: randomUUID(),
      editorId: firstEditorId,
      draftHash: "unchanged-draft",
    };
    await expect(presentations.updatePresentationDraft(noOpMutation)).resolves.toMatchObject({
      draftRevision: 0,
      draft: { title: "Original" },
    });
    await expect(presentations.updatePresentationDraft(noOpMutation)).resolves.toMatchObject({
      draftRevision: 0,
    });
    await expect(
      presentations.listPresentationHistory(workspaceId, presentationId, 20),
    ).resolves.toHaveLength(1);

    const firstMutationId = randomUUID();
    const firstDraft = { ...original, title: "First editor save" };
    const firstMutation = {
      workspaceId,
      presentationId,
      draft: firstDraft,
      expectedRevision: 0,
      mutationId: firstMutationId,
      editorId: firstEditorId,
      draftHash: "first-editor-save",
    };
    await presentations.updatePresentationDraft(firstMutation);
    await presentations.updatePresentationDraft({
      ...firstMutation,
      draft: { ...original, title: "Intervening editor save" },
      expectedRevision: 1,
      mutationId: randomUUID(),
      editorId: secondEditorId,
      draftHash: "intervening-editor-save",
    });

    await expect(presentations.updatePresentationDraft(firstMutation)).resolves.toMatchObject({
      draftRevision: 1,
      draft: { title: "First editor save" },
      lastEditedBy: firstEditorId,
    });
    await expect(presentations.getPresentation(workspaceId, presentationId)).resolves.toMatchObject(
      {
        draftRevision: 2,
        draft: { title: "Intervening editor save" },
      },
    );

    const restoreMutationId = randomUUID();
    const restoreInput = {
      workspaceId,
      presentationId,
      historyRevision: 1,
      expectedRevision: 2,
      mutationId: restoreMutationId,
      editorId: firstEditorId,
    };
    await presentations.restorePresentationHistory(restoreInput);
    await presentations.updatePresentationDraft({
      ...firstMutation,
      draft: { ...original, title: "After restore" },
      expectedRevision: 3,
      mutationId: randomUUID(),
      editorId: secondEditorId,
      draftHash: "after-restore",
    });

    await expect(presentations.restorePresentationHistory(restoreInput)).resolves.toMatchObject({
      draftRevision: 3,
      draft: { title: "First editor save" },
      lastEditedBy: firstEditorId,
    });
    await expect(presentations.getPresentation(workspaceId, presentationId)).resolves.toMatchObject(
      {
        draftRevision: 4,
        draft: { title: "After restore" },
      },
    );
  });
});
