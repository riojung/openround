import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import {
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  type RecoveryPackDraft,
} from "@openround/contracts";
import { createRecoveryPackRepository, type Repository } from "../../src/index.js";
import { recoveryPackDraft, recoveryPackRecord } from "./recovery-pack-conformance.js";

/** A bounded catalogue reads immutable published metadata, never authoring drafts or media Packs. */
export async function expectRecoveryPackLiveMetadataConformance(input: {
  repository: Repository;
  workspaceId: string;
  otherWorkspaceId: string;
  editorId: string;
  otherEditorId: string;
}) {
  const { repository, workspaceId, editorId, otherWorkspaceId, otherEditorId } = input;
  const packs = createRecoveryPackRepository(repository);
  async function publish(draft: RecoveryPackDraft, workspace = workspaceId, editor = editorId) {
    const pack = await packs.createRecoveryPack(recoveryPackRecord(workspace, editor, draft));
    const content = RecoveryPackContentSchema.parse(draft);
    const version = await packs.publishRecoveryPack(
      {
        id: randomUUID(),
        workspaceId: workspace,
        packId: pack.id,
        version: 1,
        content,
        contentHash: recoveryPackContentHash(content),
        sourceDraftRevision: 0,
        publishedAt: new Date(),
      },
      0,
    );
    return { pack, version };
  }
  const first = await publish(recoveryPackDraft("Immutable published title"));
  await packs.updateRecoveryPackDraft({
    workspaceId,
    packId: first.pack.id,
    draft: { ...first.pack.draft, title: "Private draft title" },
    editorId,
    expectedRevision: 0,
    mutationId: randomUUID(),
    draftHash: "new draft",
  });
  await packs.createRecoveryPack(
    recoveryPackRecord(workspaceId, editorId, recoveryPackDraft("Unpublished")),
  );
  await publish(recoveryPackDraft("Other workspace"), otherWorkspaceId, otherEditorId);
  const mediaId = randomUUID();
  await repository.createMediaAsset({
    id: mediaId,
    workspaceId,
    objectKey: `media/${workspaceId}/${mediaId}.png`,
    mimeType: "image/png",
    sizeBytes: 10,
    scanStatus: "clean",
    altText: "Private diagram",
    createdAt: new Date(),
  });
  for (const role of ["diagnostic", "recheck", "delayedProbe"] as const) {
    const draft = recoveryPackDraft(`Media ${role}`);
    const source =
      role === "delayedProbe"
        ? {
            ...draft.diagnostic!,
            id: randomUUID(),
            prompt: "Which result transfers to this delayed scenario?",
            linkedRecheckQuestionId: null,
          }
        : draft[role]!;
    await publish({ ...draft, [role]: { ...source, mediaId, mediaAlt: "Private diagram" } });
  }
  expect(await packs.listPublishedRecoveryPackMetadata(workspaceId)).toEqual([
    {
      packId: first.pack.id,
      packVersionId: first.version.id,
      packVersion: 1,
      title: "Immutable published title",
    },
  ]);
  const second = await publish(recoveryPackDraft("Second published title"));
  const catalog = await packs.listPublishedRecoveryPackMetadata(workspaceId, 1);
  expect(catalog).toHaveLength(1);
  expect(catalog[0]).toEqual({
    packId: second.pack.id,
    packVersionId: second.version.id,
    packVersion: 1,
    title: "Second published title",
  });
  expect(await packs.listPublishedRecoveryPackMetadata(workspaceId, 0)).toEqual([]);
  expect(await packs.listPublishedRecoveryPackMetadata(randomUUID())).toEqual([]);
  expect((await packs.listPublishedRecoveryPackMetadata(workspaceId, 1_000)).length).toBe(2);
}
