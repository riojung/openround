import { describe, expect, it } from "vitest";
import {
  createPresentationRepository,
  MemoryRepository,
  UnsupportedArtifactSchemaVersionError,
  upcastPresentationContent,
  upcastPresentationDraft,
  upcastRoundContent,
  upcastRoundDraft,
} from "../src/index.js";

const questionId = "00000000-0000-4000-8000-000000000001";
const choiceAId = "00000000-0000-4000-8000-000000000002";
const choiceBId = "00000000-0000-4000-8000-000000000003";
const blockId = "00000000-0000-4000-8000-000000000004";

function validQuestion() {
  return {
    id: questionId,
    type: "single_select" as const,
    prompt: "Which response is correct?",
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "The first response is correct.",
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: choiceAId, label: "First", isCorrect: true },
      { id: choiceBId, label: "Second", isCorrect: false },
    ],
  };
}

describe("persisted artifact schema upcasters", () => {
  it("normalizes v1 Round and Presentation draft defaults", () => {
    expect(upcastRoundDraft({ title: "Round", questions: [] }, 1)).toEqual({
      title: "Round",
      description: "",
      category: "general",
      experiencePreset: { id: "focus", version: 1 },
      questions: [],
    });

    expect(upcastPresentationDraft({ title: "Deck", blocks: [] }, 1)).toEqual({
      title: "Deck",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 1,
      blocks: [],
    });
  });

  it("strictly parses v1 immutable published content", () => {
    const question = validQuestion();
    expect(
      upcastRoundContent({ title: "Published Round", questions: [question] }, 1),
    ).toMatchObject({
      title: "Published Round",
      category: "general",
      questions: [{ id: questionId }],
    });
    expect(
      upcastPresentationContent(
        {
          title: "Published deck",
          blocks: [{ id: blockId, kind: "question", question }],
        },
        1,
      ),
    ).toMatchObject({
      title: "Published deck",
      schemaVersion: 1,
      blocks: [{ id: blockId, kind: "question" }],
    });
    expect(() => upcastRoundContent({ title: "Incomplete", questions: [] }, 1)).toThrow();
  });

  it.each([
    ["Round draft", () => upcastRoundDraft({}, 2)],
    ["Round content", () => upcastRoundContent({}, 2)],
    ["Presentation draft", () => upcastPresentationDraft({}, 2)],
    ["Presentation content", () => upcastPresentationContent({}, 2)],
  ])("rejects an unknown schema version for %s", (_label, parse) => {
    expect(parse).toThrow(UnsupportedArtifactSchemaVersionError);
    try {
      parse();
    } catch (error) {
      expect(error).toMatchObject({
        code: "UNSUPPORTED_ARTIFACT_SCHEMA_VERSION",
        schemaVersion: 2,
        supportedVersions: [1],
      });
    }
  });

  it("enforces schema versions at Memory repository write and recovery boundaries", async () => {
    const repository = new MemoryRepository();
    const workspaceId = "00000000-0000-4000-8000-000000000010";
    const quizId = "00000000-0000-4000-8000-000000000011";
    const now = new Date("2026-09-20T12:00:00.000Z");
    const draft = { title: "Round", description: "", questions: [] };

    await expect(
      repository.createQuiz({
        id: quizId,
        workspaceId,
        title: draft.title,
        description: "",
        status: "draft",
        draft,
        draftSchemaVersion: 2,
        currentVersionId: null,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toBeInstanceOf(UnsupportedArtifactSchemaVersionError);

    await repository.createQuiz({
      id: quizId,
      workspaceId,
      title: draft.title,
      description: "",
      status: "draft",
      draft,
      currentVersionId: null,
      createdAt: now,
      updatedAt: now,
    });
    repository.quizDraftHistory.set(`${quizId}:99`, {
      id: "00000000-0000-4000-8000-000000000012",
      workspaceId,
      quizId,
      revision: 99,
      draft,
      draftSchemaVersion: 2,
      savedBy: null,
      mutationId: null,
      createdAt: now,
    });
    await expect(repository.listQuizDraftHistory(workspaceId, quizId)).rejects.toBeInstanceOf(
      UnsupportedArtifactSchemaVersionError,
    );

    const presentations = createPresentationRepository(repository);
    const presentationId = "00000000-0000-4000-8000-000000000013";
    const presentationDraft = upcastPresentationDraft({ title: "Deck", blocks: [] }, 1);
    await presentations.createPresentation({
      id: presentationId,
      workspaceId,
      title: presentationDraft.title,
      description: presentationDraft.description,
      status: "draft",
      draft: presentationDraft,
      draftRevision: 0,
      draftSchemaVersion: 1,
      currentVersionId: null,
      folderId: null,
      publishedDraftRevision: null,
      lastEditedBy: null,
      createdAt: now,
      updatedAt: now,
    });
    const question = validQuestion();
    await expect(
      presentations.publishPresentation(
        {
          id: "00000000-0000-4000-8000-000000000014",
          workspaceId,
          presentationId,
          version: 1,
          content: upcastPresentationContent(
            {
              title: "Deck",
              blocks: [{ id: blockId, kind: "question", question }],
            },
            1,
          ),
          contentSchemaVersion: 2,
          contentHash: "unknown-version",
          sourceDraftRevision: 0,
          publishedAt: now,
        },
        0,
      ),
    ).rejects.toBeInstanceOf(UnsupportedArtifactSchemaVersionError);
  });
});
