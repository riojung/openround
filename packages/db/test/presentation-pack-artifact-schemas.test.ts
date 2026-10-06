import { randomUUID } from "node:crypto";
import {
  PresentationDraftSchema,
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  type PresentationDraft,
} from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { MemoryPresentationRepository } from "../src/presentations.js";
import {
  PRESENTATION_CONTENT_SCHEMA_VERSION,
  PRESENTATION_DRAFT_SCHEMA_VERSION,
  PRESENTATION_RECOVERY_PACK_SCHEMA_VERSION,
  upcastPresentationContent,
  upcastPresentationDraft,
  upcastRoundContent,
  upcastRoundDraft,
} from "../src/artifact-schemas.js";

function question(prompt: string) {
  return {
    id: randomUUID(),
    type: "single_select" as const,
    prompt,
    purpose: "practice" as const,
    confidence: "optional" as const,
    delivery: "main" as const,
    conceptKeys: ["energy-isolation"],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "Physical isolation prevents the energy release.",
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: randomUUID(), label: "Physically isolate the source", isCorrect: true },
      { id: randomUUID(), label: "Post a warning sign", isCorrect: false },
    ],
  };
}

function presentation(): PresentationDraft {
  const recheck = { ...question("How would you make this repair safe?"), delivery: "recheck" };
  const originalContent = RecoveryPackContentSchema.parse({
    schemaVersion: 1,
    title: "Energy isolation",
    description: "",
    diagnostic: {
      ...question("Which action prevents an energy release?"),
      purpose: "diagnostic",
      linkedRecheckQuestionId: recheck.id,
    },
    recheck,
    delayedProbe: question("What must happen before a machine is serviced?"),
    interventions: [
      {
        id: randomUUID(),
        title: "Physical isolation",
        body: "Warning is not isolation.",
        citations: [],
      },
    ],
    conceptKeys: ["energy-isolation"],
    misconceptionKeys: ["warning-is-isolation"],
    citations: [],
  });
  const insertion = {
    id: randomUUID(),
    packId: randomUUID(),
    packVersionId: randomUUID(),
    packVersion: 1,
    contentHash: recoveryPackContentHash(originalContent),
    diagnosticQuestionId: randomUUID(),
    recheckQuestionId: randomUUID(),
    originalContent,
  };
  const blocks = (["diagnostic", "recheck"] as const).map((role) => {
    const source = originalContent[role];
    const copy = structuredClone(source);
    copy.id = role === "diagnostic" ? insertion.diagnosticQuestionId : insertion.recheckQuestionId;
    copy.linkedRecheckQuestionId = role === "diagnostic" ? insertion.recheckQuestionId : null;
    if ("choices" in copy)
      copy.choices = copy.choices.map((choice) => ({ ...choice, id: randomUUID() }));
    copy.recoveryPackSource = {
      artifactType: "recovery_pack",
      packId: insertion.packId,
      packVersionId: insertion.packVersionId,
      packVersion: insertion.packVersion,
      contentHash: insertion.contentHash,
      sourceItemId: source.id,
      role,
    };
    return { id: randomUUID(), kind: "question" as const, question: copy };
  });
  return PresentationDraftSchema.parse({
    title: "Recovery deck",
    schemaVersion: 3,
    blocks,
    recoveryPackInsertions: [insertion],
  });
}

describe("durable Presentation Recovery Pack schema version", () => {
  it("retains the ordinary v2 constants and explicitly supports Pack document v3", () => {
    expect(PRESENTATION_DRAFT_SCHEMA_VERSION).toBe(2);
    expect(PRESENTATION_CONTENT_SCHEMA_VERSION).toBe(2);
    expect(PRESENTATION_RECOVERY_PACK_SCHEMA_VERSION).toBe(3);
    for (const version of [undefined, null, 1, 2]) {
      expect(upcastPresentationDraft({ title: "Legacy", blocks: [] }, version).schemaVersion).toBe(
        2,
      );
    }
  });

  it("losslessly upcasts v3 drafts and immutable published content", () => {
    const draft = presentation();
    const insertion = draft.recoveryPackInsertions![0]!;
    const content = structuredClone(insertion.originalContent);
    content.interventions[0]!.body = "A warning sign cannot replace a locked isolator.";
    insertion.updateBaseline = {
      packVersionId: randomUUID(),
      packVersion: 2,
      contentHash: recoveryPackContentHash(content),
      content,
    };
    const stored = JSON.parse(JSON.stringify(draft));
    expect(upcastPresentationDraft(stored, 3)).toEqual(draft);
    expect(upcastPresentationContent(stored, 3)).toEqual(draft);
  });

  it.each([undefined, null, 1, 2])(
    "does not silently downgrade a Pack document in old column %s",
    (version) => {
      const draft = presentation();
      expect(() => upcastPresentationDraft(draft, version)).toThrow("schema version 3");
      expect(() => upcastPresentationContent(draft, version)).toThrow("schema version 3");
    },
  );

  it("preserves pre-existing question-level Pack provenance on legacy v2 reads", () => {
    const draft = presentation();
    const sourceOnly = {
      ...draft,
      schemaVersion: 2 as const,
      recoveryPackInsertions: undefined,
    };
    for (const version of [undefined, null, 1, 2]) {
      expect(upcastPresentationDraft(sourceOnly, version)).toEqual(sourceOnly);
      expect(upcastPresentationContent(sourceOnly, version)).toEqual(sourceOnly);
    }
    expect(sourceOnly.schemaVersion).toBe(2);
    expect(draft.schemaVersion).toBe(3);
  });

  it("reads stored v2 provenance-only drafts, history, and versions without rewriting publication", async () => {
    const draft = presentation();
    const sourceOnly = {
      ...draft,
      schemaVersion: 2 as const,
      recoveryPackInsertions: undefined,
    };
    const repository = new MemoryPresentationRepository();
    const workspaceId = randomUUID();
    const presentationId = randomUUID();
    const versionId = randomUUID();
    const now = new Date("2026-10-06T12:00:00.000Z");
    repository.presentations.set(presentationId, {
      id: presentationId,
      workspaceId,
      title: sourceOnly.title,
      description: sourceOnly.description,
      status: "published",
      draft: sourceOnly,
      draftRevision: 1,
      draftSchemaVersion: 2,
      currentVersionId: versionId,
      folderId: null,
      publishedDraftRevision: 1,
      lastEditedBy: null,
      createdAt: now,
      updatedAt: now,
    });
    repository.history.set(`${presentationId}:1`, {
      id: randomUUID(),
      workspaceId,
      presentationId,
      revision: 1,
      draft: sourceOnly,
      draftSchemaVersion: 2,
      savedBy: null,
      mutationId: null,
      createdAt: now,
    });
    const published = {
      id: versionId,
      workspaceId,
      presentationId,
      version: 1,
      content: sourceOnly,
      contentSchemaVersion: 2,
      contentHash: "historical-publication-hash",
      sourceDraftRevision: 1,
      publishedAt: now,
    };
    repository.versions.set(versionId, published);
    await expect(repository.getPresentation(workspaceId, presentationId)).resolves.toMatchObject({
      draft: sourceOnly,
      draftSchemaVersion: 2,
    });
    await expect(
      repository.listPresentationHistory(workspaceId, presentationId),
    ).resolves.toMatchObject([{ draft: sourceOnly, draftSchemaVersion: 2 }]);
    await expect(repository.getPresentationVersion(workspaceId, versionId)).resolves.toEqual(
      published,
    );
    expect(repository.versions.get(versionId)).toEqual(published);
  });

  it("preserves original references in v3 after local copies are deleted", () => {
    const draft = presentation();
    const insertion = structuredClone(draft.recoveryPackInsertions![0]!);
    draft.blocks = [];
    expect(upcastPresentationDraft(draft, 3).recoveryPackInsertions).toEqual([insertion]);
    draft.blocks = [
      { id: randomUUID(), kind: "question", question: question("What would you do next?") },
    ];
    expect(upcastPresentationContent(draft, 3).recoveryPackInsertions).toEqual([insertion]);
  });

  it("rejects altered immutable baseline hashes on durable reads", () => {
    const draft = presentation();
    draft.recoveryPackInsertions![0]!.originalContent.interventions[0]!.body = "Altered reference";
    expect(() => upcastPresentationDraft(draft, 3)).toThrow();
    expect(() => upcastPresentationContent(draft, 3)).toThrow();
  });

  it("leaves Round schema version and existing Pack provenance unchanged", () => {
    const draft = presentation();
    const round = {
      title: draft.title,
      questions: draft.blocks.flatMap((block) =>
        block.kind === "question" ? [block.question] : [],
      ),
      recoveryPackInsertions: draft.recoveryPackInsertions,
    };
    expect(upcastRoundDraft(round, 1).recoveryPackInsertions).toEqual(draft.recoveryPackInsertions);
    expect(upcastRoundContent(round, 1)).toEqual(upcastRoundDraft(round, 1));
  });
});
