import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { WorkspaceDeletionInProgressError, type Repository } from "./types.js";
import {
  RECOVERY_PACK_CONTENT_SCHEMA_VERSION,
  RECOVERY_PACK_DRAFT_SCHEMA_VERSION,
  upcastRecoveryPackContent,
  upcastRecoveryPackDraft,
} from "./artifact-schemas.js";
import { recoveryPackMediaIds } from "./media-references.js";
import { RecoveryPackContentSchema } from "@openround/contracts";
import {
  recoveryPackTextOnlyLiveEligible,
  RECOVERY_PACK_TEXT_ONLY_LIVE_SQL,
} from "./recovery-pack-live-metadata.js";
import {
  assertSourceApproval,
  assertSourceCitations,
  assertSourceProvenance,
  assertSourcePublish,
  sourceApprovalRequestHash,
  withRecoveryPackSourceReview,
  type RecoveryPackSourceRecord,
  type RecoveryPackSourceApprovalReceipt,
} from "./recovery-pack-source.js";
import {
  RecoveryPackDraftConflictError,
  RecoveryPackMutationConflictError,
  RecoveryPackNotFoundError,
  RecoveryPackMediaValidationError,
  type RecoveryPackDraftUpdate,
  type RecoveryPackHistoryRecord,
  type RecoveryPackMutationReplay,
  type RecoveryPackRecord,
  type RecoveryPackRepository,
  type RecoveryPackSourceApproval,
  type RecoveryPackSourceProvenance,
  type RecoveryPackVersionRecord,
  type PublishedRecoveryPackMetadata,
} from "./recovery-pack-types.js";

interface MutationReceipt {
  workspaceId: string;
  packId: string;
  expectedRevision: number;
  resultingRevision: number;
  draftHash: string;
  draft: RecoveryPackRecord["draft"];
  draftSchemaVersion: number;
  lastEditedBy: string | null;
  resultingAt: Date;
  createdAt: Date;
}

function normalizeRecord(input: RecoveryPackRecord): RecoveryPackRecord {
  const draftSchemaVersion = input.draftSchemaVersion ?? RECOVERY_PACK_DRAFT_SCHEMA_VERSION;
  const draft = upcastRecoveryPackDraft(input.draft, draftSchemaVersion);
  return {
    ...input,
    title: draft.title,
    description: draft.description,
    draft,
    draftSchemaVersion,
  };
}

function normalizeVersion(input: RecoveryPackVersionRecord): RecoveryPackVersionRecord {
  const contentSchemaVersion = input.contentSchemaVersion ?? RECOVERY_PACK_CONTENT_SCHEMA_VERSION;
  return {
    ...input,
    content: upcastRecoveryPackContent(input.content, contentSchemaVersion),
    contentSchemaVersion,
  };
}

function date(value: unknown) {
  return value instanceof Date ? value : new Date(String(value));
}

function mapRecord(row: QueryResultRow): RecoveryPackRecord {
  return normalizeRecord({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    title: String(row.title),
    description: String(row.description),
    draft: row.draft,
    draftRevision: Number(row.draft_revision),
    draftSchemaVersion: Number(row.draft_schema_version),
    currentVersionId: row.current_version_id ? String(row.current_version_id) : null,
    publishedDraftRevision:
      row.published_draft_revision == null ? null : Number(row.published_draft_revision),
    lastEditedBy: row.last_edited_by ? String(row.last_edited_by) : null,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  });
}

function mapVersion(row: QueryResultRow): RecoveryPackVersionRecord {
  return normalizeVersion({
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    packId: String(row.pack_id),
    version: Number(row.version),
    content: row.content,
    contentSchemaVersion: Number(row.content_schema_version),
    contentHash: String(row.content_hash),
    sourceDraftRevision: Number(row.source_draft_revision),
    publishedAt: date(row.published_at),
  });
}

function mapHistory(row: QueryResultRow): RecoveryPackHistoryRecord {
  const draftSchemaVersion = Number(row.draft_schema_version);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    packId: String(row.pack_id),
    revision: Number(row.revision),
    draft: upcastRecoveryPackDraft(row.draft, draftSchemaVersion),
    draftSchemaVersion,
    savedBy: row.saved_by ? String(row.saved_by) : null,
    mutationId: row.mutation_id ? String(row.mutation_id) : null,
    createdAt: date(row.created_at),
  };
}

function mapReceipt(row: QueryResultRow): MutationReceipt {
  const draftSchemaVersion = Number(row.draft_schema_version);
  return {
    workspaceId: String(row.workspace_id),
    packId: String(row.pack_id),
    expectedRevision: Number(row.expected_revision),
    resultingRevision: Number(row.resulting_revision),
    draftHash: String(row.draft_hash),
    draft: upcastRecoveryPackDraft(row.resulting_draft, draftSchemaVersion),
    draftSchemaVersion,
    lastEditedBy: row.last_edited_by ? String(row.last_edited_by) : null,
    resultingAt: date(row.resulting_at),
    createdAt: date(row.created_at),
  };
}

function mapSource(row: QueryResultRow): RecoveryPackSourceRecord {
  return {
    workspaceId: String(row.workspace_id),
    packId: String(row.pack_id),
    authoringJobId: String(row.authoring_job_id),
    sourceName: String(row.source_name),
    sourceDigest: String(row.source_digest),
    sourceOutputHash: String(row.source_output_hash),
    citationCatalog: row.citation_catalog,
    creationMutationId: String(row.creation_mutation_id),
    creationRequestHash: String(row.creation_request_hash),
    approvedContentHash:
      row.approved_content_hash == null ? null : String(row.approved_content_hash),
    approvedDraftRevision:
      row.approved_draft_revision == null ? null : Number(row.approved_draft_revision),
    approvedAt: row.approved_at == null ? null : date(row.approved_at),
    approvedBy: row.approved_by == null ? null : String(row.approved_by),
    createdAt: date(row.created_at),
  };
}

function assertMutationMatches(receipt: MutationReceipt, input: RecoveryPackMutationReplay) {
  if (
    receipt.workspaceId !== input.workspaceId ||
    receipt.packId !== input.packId ||
    receipt.expectedRevision !== input.expectedRevision ||
    receipt.draftHash !== input.draftHash
  ) {
    throw new RecoveryPackMutationConflictError(input.mutationId);
  }
}

function replay(current: RecoveryPackRecord, receipt: MutationReceipt): RecoveryPackRecord {
  return normalizeRecord({
    ...current,
    draft: structuredClone(receipt.draft),
    draftRevision: receipt.resultingRevision,
    draftSchemaVersion: receipt.draftSchemaVersion,
    lastEditedBy: receipt.lastEditedBy,
    updatedAt: receipt.resultingAt,
  });
}

export class MemoryRecoveryPackRepository
  implements RecoveryPackRepository, MemoryRepositoryLifecycleExtension
{
  readonly packs = new Map<string, RecoveryPackRecord>();
  readonly versions = new Map<string, RecoveryPackVersionRecord>();
  readonly history = new Map<string, RecoveryPackHistoryRecord>();
  private readonly mutations = new Map<string, MutationReceipt>();
  private readonly sources = new Map<string, RecoveryPackSourceRecord>();
  private readonly sourceApprovals = new Map<string, RecoveryPackSourceApprovalReceipt>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly deletedWorkspaces = new Set<string>();

  constructor(private readonly repository: MemoryRepository) {}

  private review(pack: RecoveryPackRecord) {
    return withRecoveryPackSourceReview(normalizeRecord(pack), this.sources.get(pack.id));
  }

  private assertWritable(workspaceId: string) {
    if (this.deletedWorkspaces.has(workspaceId))
      throw new WorkspaceDeletionInProgressError(workspaceId);
    this.repository.assertWorkspaceLiveSessionCreationAllowed(workspaceId);
  }

  private validateMedia(workspaceId: string, draft: RecoveryPackRecord["draft"]) {
    try {
      this.repository.validateMediaReferences(workspaceId, recoveryPackMediaIds(draft));
    } catch (error) {
      throw new RecoveryPackMediaValidationError((error as Error).message);
    }
  }

  private async locked<T>(key: string, work: () => Promise<T>) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, pending);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(key) === pending) this.locks.delete(key);
    }
  }

  /** Share the Pack/account lifecycle fence with atomic practice snapshot creation. */
  async withPracticeCreationLock<T>(workspaceId: string, work: () => T) {
    return this.locked(workspaceId, async () => work());
  }

  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      recoveryPacks: [...this.packs.values()]
        .filter((item) => ownedWorkspaceIds.has(item.workspaceId))
        .map((item) => structuredClone(this.review(item))),
      recoveryPackVersions: [...this.versions.values()]
        .filter((item) => ownedWorkspaceIds.has(item.workspaceId))
        .map((item) => structuredClone(normalizeVersion(item))),
      recoveryPackDraftHistory: [...this.history.values()]
        .filter((item) => ownedWorkspaceIds.has(item.workspaceId))
        .map((item) => structuredClone(item)),
      recoveryPackDraftMutations: [...this.mutations.entries()]
        .filter(([, item]) => ownedWorkspaceIds.has(item.workspaceId))
        .map(([key, item]) => ({
          ...structuredClone(item),
          mutationId: key.slice(key.indexOf(":") + 1),
        })),
      recoveryPackSources: [...this.sources.values()]
        .filter((item) => ownedWorkspaceIds.has(item.workspaceId))
        .map((item) => structuredClone(item)),
      recoveryPackSourceApprovals: [...this.sourceApprovals.entries()]
        .filter(([, item]) => ownedWorkspaceIds.has(item.workspaceId))
        .map(([key, item]) => ({
          ...structuredClone(item),
          mutationId: key.slice(key.indexOf(":") + 1),
        })),
    };
  }

  async deleteAccount({ ownedWorkspaceIds, userId }: MemoryRepositoryLifecycleContext) {
    for (const workspaceId of ownedWorkspaceIds) this.deletedWorkspaces.add(workspaceId);
    for (const workspaceId of ownedWorkspaceIds) {
      // Wait for in-flight writes before enumerating: a create may not have installed its Pack
      // yet when deletion starts. The tombstone also fences queued/stale new writes.
      await this.locked(workspaceId, async () => {
        for (const pack of [...this.packs.values()]) {
          if (pack.workspaceId === workspaceId) this.deletePackContents(workspaceId, pack.id);
        }
      });
    }
    for (const [key, source] of this.sources)
      if (source.approvedBy === userId) this.sources.set(key, { ...source, approvedBy: null });
  }

  async purgeExpired(now: Date) {
    for (const pack of [...this.packs.values()]) {
      await this.locked(pack.workspaceId, () => this.prune(pack.workspaceId, pack.id, now));
    }
    return [];
  }

  async listRecoveryPacks(workspaceId: string) {
    return [...this.packs.values()]
      .filter((item) => item.workspaceId === workspaceId)
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
      )
      .map((item) => structuredClone(this.review(item)));
  }

  async listPublishedRecoveryPackMetadata(workspaceId: string, limit = 100) {
    const packs = [...this.packs.values()]
      .filter((pack) => pack.workspaceId === workspaceId)
      .sort(
        (left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id),
      );
    return packs
      .flatMap((pack): PublishedRecoveryPackMetadata[] => {
        const version = pack.currentVersionId ? this.versions.get(pack.currentVersionId) : null;
        if (
          !version ||
          version.workspaceId !== workspaceId ||
          version.packId !== pack.id ||
          !recoveryPackTextOnlyLiveEligible(version.content)
        )
          return [];
        return [
          {
            packId: pack.id,
            packVersionId: version.id,
            packVersion: version.version,
            title: version.content.title,
          },
        ];
      })
      .slice(0, Math.min(100, Math.max(0, Math.trunc(limit))));
  }

  async createRecoveryPack(input: RecoveryPackRecord) {
    return this.locked(input.workspaceId, async () => this.createPackContents(input));
  }

  private async createPackContents(input: RecoveryPackRecord) {
    this.assertWritable(input.workspaceId);
    if (this.packs.has(input.id)) throw new Error("Recovery Pack already exists");
    const created = structuredClone(withRecoveryPackSourceReview(normalizeRecord(input)));
    this.validateMedia(created.workspaceId, created.draft);
    const snapshot: RecoveryPackHistoryRecord = {
      id: randomUUID(),
      workspaceId: created.workspaceId,
      packId: created.id,
      revision: created.draftRevision,
      draft: structuredClone(created.draft),
      draftSchemaVersion: created.draftSchemaVersion,
      savedBy: created.lastEditedBy,
      mutationId: null,
      createdAt: created.createdAt,
    };
    await this.repository.replaceMediaReferences(
      created.workspaceId,
      "recovery_pack_draft",
      created.id,
      recoveryPackMediaIds(created.draft),
      created.createdAt,
    );
    await this.repository.replaceMediaReferences(
      created.workspaceId,
      "recovery_pack_history",
      snapshot.id,
      recoveryPackMediaIds(created.draft),
      created.createdAt,
    );
    this.packs.set(created.id, created);
    this.history.set(`${created.id}:${snapshot.revision}`, snapshot);
    return structuredClone(this.review(created));
  }

  async replaySourceRecoveryPack(workspaceId: string, mutationId: string, requestHash: string) {
    const source = [...this.sources.values()].find(
      (item) => item.workspaceId === workspaceId && item.creationMutationId === mutationId,
    );
    if (!source) return null;
    if (source.creationRequestHash !== requestHash)
      throw new RecoveryPackMutationConflictError(mutationId);
    return this.getRecoveryPack(workspaceId, source.packId);
  }

  async createSourceRecoveryPack(
    input: RecoveryPackRecord,
    provenance: RecoveryPackSourceProvenance,
    mutationId: string,
    requestHash: string,
  ) {
    return this.locked(input.workspaceId, async () => {
      const previous = await this.replaySourceRecoveryPack(
        input.workspaceId,
        mutationId,
        requestHash,
      );
      if (previous) return previous;
      assertSourceProvenance(provenance);
      assertSourceCitations(RecoveryPackContentSchema.parse(input.draft), provenance);
      const created = await this.createPackContents(input);
      this.sources.set(created.id, {
        ...structuredClone(provenance),
        workspaceId: created.workspaceId,
        packId: created.id,
        creationMutationId: mutationId,
        creationRequestHash: requestHash,
        approvedContentHash: null,
        approvedDraftRevision: null,
        approvedAt: null,
        approvedBy: null,
        createdAt: created.createdAt,
      });
      return structuredClone(this.review(created));
    });
  }

  async approveRecoveryPackSource(input: RecoveryPackSourceApproval) {
    return this.locked(input.workspaceId, async () => {
      const key = `${input.workspaceId}:${input.mutationId}`;
      const requestHash = sourceApprovalRequestHash(input);
      const receipt = this.sourceApprovals.get(key);
      if (receipt && receipt.requestHash !== requestHash)
        throw new RecoveryPackMutationConflictError(input.mutationId);
      const current = this.packs.get(input.packId);
      if (!current || current.workspaceId !== input.workspaceId)
        throw new RecoveryPackNotFoundError();
      if (receipt) {
        return structuredClone(this.review(current));
      }
      this.assertWritable(input.workspaceId);
      if (current.draftRevision !== input.expectedDraftRevision)
        throw new RecoveryPackDraftConflictError(
          input.expectedDraftRevision,
          current.draftRevision,
          current.lastEditedBy,
        );
      const source = this.sources.get(input.packId);
      assertSourceApproval(current, source, input);
      const now = input.now ?? new Date();
      this.sources.set(input.packId, {
        ...source!,
        approvedContentHash: input.expectedContentHash,
        approvedDraftRevision: input.expectedDraftRevision,
        approvedAt: now,
        approvedBy: input.editorId,
      });
      this.sourceApprovals.set(key, {
        workspaceId: input.workspaceId,
        packId: input.packId,
        requestHash,
        createdAt: now,
      });
      return structuredClone(this.review(current));
    });
  }

  async getRecoveryPack(workspaceId: string, packId: string) {
    const item = this.packs.get(packId);
    return item?.workspaceId === workspaceId ? structuredClone(this.review(item)) : null;
  }

  async updateRecoveryPackDraft(input: RecoveryPackDraftUpdate) {
    return this.locked(input.workspaceId, async () => {
      const current = this.packs.get(input.packId);
      if (!current || current.workspaceId !== input.workspaceId) return null;
      const key = `${input.workspaceId}:${input.mutationId}`;
      const prior = this.mutations.get(key);
      if (prior) {
        assertMutationMatches(prior, input);
        return structuredClone(this.review(replay(current, prior)));
      }
      this.assertWritable(input.workspaceId);
      if (current.draftRevision !== input.expectedRevision) {
        throw new RecoveryPackDraftConflictError(
          input.expectedRevision,
          current.draftRevision,
          current.lastEditedBy,
        );
      }
      const draft = upcastRecoveryPackDraft(input.draft, input.draft.schemaVersion);
      this.validateMedia(input.workspaceId, draft);
      const meaningful = JSON.stringify(normalizeRecord(current).draft) !== JSON.stringify(draft);
      const now = new Date();
      const updated = meaningful
        ? normalizeRecord({
            ...current,
            draft,
            draftRevision: current.draftRevision + 1,
            draftSchemaVersion: draft.schemaVersion,
            lastEditedBy: input.editorId,
            updatedAt: now,
          })
        : normalizeRecord(current);
      if (meaningful) {
        const historyId = randomUUID();
        await this.repository.replaceMediaReferences(
          input.workspaceId,
          "recovery_pack_draft",
          input.packId,
          recoveryPackMediaIds(draft),
          now,
        );
        await this.repository.replaceMediaReferences(
          input.workspaceId,
          "recovery_pack_history",
          historyId,
          recoveryPackMediaIds(draft),
          now,
        );
        this.packs.set(input.packId, structuredClone(updated));
        this.history.set(`${input.packId}:${updated.draftRevision}`, {
          id: historyId,
          workspaceId: input.workspaceId,
          packId: input.packId,
          revision: updated.draftRevision,
          draft: structuredClone(draft),
          draftSchemaVersion: draft.schemaVersion,
          savedBy: input.editorId,
          mutationId: input.mutationId,
          createdAt: now,
        });
      }
      this.mutations.set(key, {
        workspaceId: input.workspaceId,
        packId: input.packId,
        expectedRevision: input.expectedRevision,
        resultingRevision: updated.draftRevision,
        draftHash: input.draftHash,
        draft: structuredClone(updated.draft),
        draftSchemaVersion: updated.draftSchemaVersion,
        lastEditedBy: updated.lastEditedBy,
        resultingAt: updated.updatedAt,
        createdAt: now,
      });
      await this.repository.replaceMediaReferences(
        input.workspaceId,
        "recovery_pack_mutation",
        input.mutationId,
        recoveryPackMediaIds(updated.draft),
        now,
      );
      await this.prune(input.workspaceId, input.packId, now);
      return structuredClone(this.review(updated));
    });
  }

  async replayRecoveryPackMutation(input: RecoveryPackMutationReplay) {
    const current = this.packs.get(input.packId);
    if (!current || current.workspaceId !== input.workspaceId) return null;
    const receipt = this.mutations.get(`${input.workspaceId}:${input.mutationId}`);
    if (!receipt) return null;
    assertMutationMatches(receipt, input);
    return structuredClone(this.review(replay(current, receipt)));
  }

  private async prune(workspaceId: string, packId: string, now: Date) {
    const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1_000;
    const snapshots = [...this.history.entries()]
      .filter(([, item]) => item.workspaceId === workspaceId && item.packId === packId)
      .sort((left, right) => right[1].revision - left[1].revision);
    for (const [index, [key, item]] of snapshots.entries()) {
      if (index >= 20 || item.createdAt.getTime() < cutoff) {
        await this.repository.replaceMediaReferences(
          workspaceId,
          "recovery_pack_history",
          item.id,
          [],
          now,
        );
        this.history.delete(key);
      }
    }
    for (const [key, item] of this.mutations) {
      if (
        item.workspaceId === workspaceId &&
        item.packId === packId &&
        item.createdAt.getTime() < cutoff
      ) {
        await this.repository.replaceMediaReferences(
          workspaceId,
          "recovery_pack_mutation",
          key.slice(key.indexOf(":") + 1),
          [],
          now,
        );
        this.mutations.delete(key);
      }
    }
    for (const [key, item] of this.sourceApprovals)
      if (
        item.workspaceId === workspaceId &&
        item.packId === packId &&
        item.createdAt.getTime() < cutoff
      )
        this.sourceApprovals.delete(key);
  }

  async publishRecoveryPack(input: RecoveryPackVersionRecord, expectedDraftRevision: number) {
    return this.locked(input.workspaceId, async () => {
      this.assertWritable(input.workspaceId);
      const current = this.packs.get(input.packId);
      if (!current || current.workspaceId !== input.workspaceId)
        throw new RecoveryPackNotFoundError();
      if (current.draftRevision !== expectedDraftRevision) {
        throw new RecoveryPackDraftConflictError(
          expectedDraftRevision,
          current.draftRevision,
          current.lastEditedBy,
        );
      }
      const normalized = normalizeVersion(input);
      assertSourcePublish(
        current,
        this.sources.get(input.packId),
        normalized.content,
        normalized.contentHash,
      );
      for (const mediaId of recoveryPackMediaIds(normalized.content)) {
        const asset = await this.repository.getMediaAsset(input.workspaceId, mediaId);
        if (!asset || asset.scanStatus !== "clean")
          throw new RecoveryPackMediaValidationError(
            "Recovery Pack media must be clean before publishing",
            mediaId,
          );
      }
      const existing = [...this.versions.values()].find(
        (item) =>
          item.workspaceId === input.workspaceId &&
          item.packId === input.packId &&
          item.contentHash === input.contentHash,
      );
      const nextVersion =
        Math.max(
          0,
          ...[...this.versions.values()]
            .filter(
              (item) => item.packId === input.packId && item.workspaceId === input.workspaceId,
            )
            .map((item) => item.version),
        ) + 1;
      const version = existing
        ? normalizeVersion(existing)
        : { ...normalized, version: nextVersion, sourceDraftRevision: expectedDraftRevision };
      if (
        !existing &&
        [...this.versions.values()].some(
          (item) =>
            item.id === version.id ||
            (item.packId === version.packId && item.version === version.version),
        )
      )
        throw new Error("Recovery Pack version already exists");
      await this.repository.replaceMediaReferences(
        input.workspaceId,
        "recovery_pack_version",
        version.id,
        recoveryPackMediaIds(version.content),
        version.publishedAt,
      );
      this.versions.set(version.id, structuredClone(version));
      this.packs.set(current.id, {
        ...current,
        currentVersionId: version.id,
        publishedDraftRevision: expectedDraftRevision,
        updatedAt: new Date(),
      });
      return structuredClone(version);
    });
  }

  async getRecoveryPackVersion(workspaceId: string, versionId: string) {
    const item = this.versions.get(versionId);
    return item?.workspaceId === workspaceId ? structuredClone(normalizeVersion(item)) : null;
  }

  async listRecoveryPackHistory(workspaceId: string, packId: string, limit = 20) {
    return [...this.history.values()]
      .filter((item) => item.workspaceId === workspaceId && item.packId === packId)
      .sort((left, right) => right.revision - left.revision)
      .slice(0, Math.min(20, Math.max(0, limit)))
      .map((item) => structuredClone(item));
  }

  async deleteRecoveryPack(workspaceId: string, packId: string) {
    return this.locked(workspaceId, async () => this.deletePackContents(workspaceId, packId));
  }

  /** Caller holds the workspace lock; account cleanup must not recursively acquire it. */
  private deletePackContents(workspaceId: string, packId: string) {
    if (this.packs.get(packId)?.workspaceId !== workspaceId) return false;
    const owners = [{ ownerType: "recovery_pack_draft" as const, ownerId: packId }];
    for (const [key, item] of this.versions) {
      if (item.workspaceId === workspaceId && item.packId === packId) {
        this.repository.removeMediaReferencesForOwners(workspaceId, [
          { ownerType: "recovery_pack_version", ownerId: item.id },
        ]);
        this.versions.delete(key);
      }
    }
    for (const [key, item] of this.history) {
      if (item.workspaceId === workspaceId && item.packId === packId) {
        this.repository.removeMediaReferencesForOwners(workspaceId, [
          { ownerType: "recovery_pack_history", ownerId: item.id },
        ]);
        this.history.delete(key);
      }
    }
    for (const [key, item] of this.mutations)
      if (item.workspaceId === workspaceId && item.packId === packId) {
        this.repository.removeMediaReferencesForOwners(workspaceId, [
          { ownerType: "recovery_pack_mutation", ownerId: key.slice(key.indexOf(":") + 1) },
        ]);
        this.mutations.delete(key);
      }
    this.repository.removeMediaReferencesForOwners(workspaceId, owners);
    this.sources.delete(packId);
    for (const [key, item] of this.sourceApprovals)
      if (item.workspaceId === workspaceId && item.packId === packId)
        this.sourceApprovals.delete(key);
    this.packs.delete(packId);
    return true;
  }
}

export class PostgresRecoveryPackRepository implements RecoveryPackRepository {
  constructor(private readonly repository: PostgresRepository) {}

  private async source(client: PoolClient, workspaceId: string, packId: string) {
    const result = await client.query(
      "SELECT * FROM recovery_pack_sources WHERE workspace_id = $1 AND pack_id = $2",
      [workspaceId, packId],
    );
    return result.rows[0] ? mapSource(result.rows[0]) : undefined;
  }

  private async review(client: PoolClient, pack: RecoveryPackRecord) {
    return withRecoveryPackSourceReview(pack, await this.source(client, pack.workspaceId, pack.id));
  }

  private async replaySource(
    client: PoolClient,
    workspaceId: string,
    mutationId: string,
    requestHash: string,
  ) {
    const result = await client.query(
      "SELECT * FROM recovery_pack_sources WHERE workspace_id = $1 AND creation_mutation_id = $2",
      [workspaceId, mutationId],
    );
    if (!result.rows[0]) return null;
    const source = mapSource(result.rows[0]);
    if (source.creationRequestHash !== requestHash)
      throw new RecoveryPackMutationConflictError(mutationId);
    const pack = await client.query(
      "SELECT * FROM recovery_packs WHERE workspace_id = $1 AND id = $2",
      [workspaceId, source.packId],
    );
    return pack.rows[0] ? withRecoveryPackSourceReview(mapRecord(pack.rows[0]), source) : null;
  }

  /** Lock the workspace before any Pack row, matching account-deletion lock ordering. */
  private async lockWorkspaceForWrite(client: PoolClient, workspaceId: string) {
    const result = await client.query<{
      deletion_started_at: Date | null;
      media_deletion_started: boolean;
    }>(
      `SELECT workspace.deletion_started_at, EXISTS (
         SELECT 1 FROM workspace_media_deletion_jobs job WHERE job.workspace_id = workspace.id
       ) AS media_deletion_started
       FROM workspaces workspace WHERE workspace.id = $1 FOR SHARE`,
      [workspaceId],
    );
    const workspace = result.rows[0];
    return Boolean(
      workspace && !workspace.deletion_started_at && !workspace.media_deletion_started,
    );
  }

  private async transaction<T>(workspaceId: string, work: (client: PoolClient) => Promise<T>) {
    const client = await this.repository.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      const databaseError = error as Error & { code?: string };
      if (
        (databaseError.code === "23503" || databaseError.code === "23514") &&
        (databaseError.message.includes("media asset") ||
          databaseError.message.includes("Recovery Pack media"))
      ) {
        throw new RecoveryPackMediaValidationError(databaseError.message);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listRecoveryPacks(workspaceId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT pack.*, to_jsonb(source) AS source_record FROM recovery_packs pack
         LEFT JOIN recovery_pack_sources source ON source.workspace_id = pack.workspace_id AND source.pack_id = pack.id
         WHERE pack.workspace_id = $1 ORDER BY pack.updated_at DESC, pack.id`,
        [workspaceId],
      );
      return result.rows.map((row) =>
        withRecoveryPackSourceReview(
          mapRecord(row),
          row.source_record ? mapSource(row.source_record) : undefined,
        ),
      );
    });
  }

  async listPublishedRecoveryPackMetadata(
    workspaceId: string,
    limit = 100,
  ): Promise<PublishedRecoveryPackMetadata[]> {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT pack.id AS pack_id, version.id AS pack_version_id, version.version AS pack_version,
                version.content ->> 'title' AS title
           FROM recovery_packs pack
           JOIN recovery_pack_versions version
             ON version.workspace_id = pack.workspace_id AND version.pack_id = pack.id
            AND version.id = pack.current_version_id
          WHERE pack.workspace_id = $1 AND ${RECOVERY_PACK_TEXT_ONLY_LIVE_SQL}
          ORDER BY pack.updated_at DESC, pack.id
          LIMIT $2`,
        [workspaceId, Math.min(100, Math.max(0, Math.trunc(limit)))],
      );
      return result.rows.map((row) => ({
        packId: String(row.pack_id),
        packVersionId: String(row.pack_version_id),
        packVersion: Number(row.pack_version),
        title: String(row.title),
      }));
    });
  }

  async createRecoveryPack(input: RecoveryPackRecord) {
    const item = normalizeRecord(input);
    return this.transaction(item.workspaceId, async (client) => {
      if (!(await this.lockWorkspaceForWrite(client, item.workspaceId)))
        throw new WorkspaceDeletionInProgressError(item.workspaceId);
      return this.createPackContents(client, item);
    });
  }

  private async createPackContents(client: PoolClient, item: RecoveryPackRecord) {
    const inserted = await client.query(
      `INSERT INTO recovery_packs (id, workspace_id, title, description, draft, draft_revision,
           draft_schema_version, current_version_id, published_draft_revision, last_edited_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        item.id,
        item.workspaceId,
        item.title,
        item.description,
        JSON.stringify(item.draft),
        item.draftRevision,
        item.draftSchemaVersion,
        item.currentVersionId,
        item.publishedDraftRevision,
        item.lastEditedBy,
        item.createdAt,
        item.updatedAt,
      ],
    );
    await client.query(
      `INSERT INTO recovery_pack_draft_history (id, workspace_id, pack_id, revision, draft, draft_schema_version, saved_by, mutation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8)`,
      [
        randomUUID(),
        item.workspaceId,
        item.id,
        item.draftRevision,
        JSON.stringify(item.draft),
        item.draftSchemaVersion,
        item.lastEditedBy,
        item.createdAt,
      ],
    );
    return mapRecord(inserted.rows[0]!);
  }

  async replaySourceRecoveryPack(workspaceId: string, mutationId: string, requestHash: string) {
    return this.transaction(workspaceId, (client) =>
      this.replaySource(client, workspaceId, mutationId, requestHash),
    );
  }

  async createSourceRecoveryPack(
    input: RecoveryPackRecord,
    provenance: RecoveryPackSourceProvenance,
    mutationId: string,
    requestHash: string,
  ) {
    return this.transaction(input.workspaceId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `recovery-pack-source:${input.workspaceId}:${mutationId}`,
      ]);
      const workspaceWritable = await this.lockWorkspaceForWrite(client, input.workspaceId);
      const prior = await this.replaySource(client, input.workspaceId, mutationId, requestHash);
      if (prior) return prior;
      if (!workspaceWritable) throw new WorkspaceDeletionInProgressError(input.workspaceId);
      assertSourceProvenance(provenance);
      assertSourceCitations(RecoveryPackContentSchema.parse(input.draft), provenance);
      const created = await this.createPackContents(client, normalizeRecord(input));
      const source = await client.query(
        `INSERT INTO recovery_pack_sources (workspace_id, pack_id, authoring_job_id, source_name, source_digest, source_output_hash,
          citation_catalog, creation_mutation_id, creation_request_hash, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          created.workspaceId,
          created.id,
          provenance.authoringJobId,
          provenance.sourceName,
          provenance.sourceDigest,
          provenance.sourceOutputHash,
          JSON.stringify(provenance.citationCatalog),
          mutationId,
          requestHash,
          created.createdAt,
        ],
      );
      return withRecoveryPackSourceReview(created, mapSource(source.rows[0]!));
    });
  }

  async approveRecoveryPackSource(input: RecoveryPackSourceApproval) {
    return this.transaction(input.workspaceId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `recovery-pack-source:${input.workspaceId}:${input.mutationId}`,
      ]);
      const workspaceWritable = await this.lockWorkspaceForWrite(client, input.workspaceId);
      const requestHash = sourceApprovalRequestHash(input);
      const prior = await client.query(
        "SELECT * FROM recovery_pack_source_approvals WHERE workspace_id = $1 AND mutation_id = $2",
        [input.workspaceId, input.mutationId],
      );
      if (prior.rows[0] && prior.rows[0].request_hash !== requestHash)
        throw new RecoveryPackMutationConflictError(input.mutationId);
      const locked = await client.query(
        "SELECT * FROM recovery_packs WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
        [input.workspaceId, input.packId],
      );
      if (!locked.rows[0]) throw new RecoveryPackNotFoundError();
      const current = mapRecord(locked.rows[0]);
      if (prior.rows[0]) {
        return this.review(client, current);
      }
      if (!workspaceWritable) throw new WorkspaceDeletionInProgressError(input.workspaceId);
      if (current.draftRevision !== input.expectedDraftRevision)
        throw new RecoveryPackDraftConflictError(
          input.expectedDraftRevision,
          current.draftRevision,
          current.lastEditedBy,
        );
      const source = await this.source(client, input.workspaceId, input.packId);
      assertSourceApproval(current, source, input);
      const now = input.now ?? new Date();
      const approved = await client.query(
        `UPDATE recovery_pack_sources SET approved_content_hash = $3, approved_draft_revision = $4, approved_at = $5, approved_by = $6
         WHERE workspace_id = $1 AND pack_id = $2 RETURNING *`,
        [
          input.workspaceId,
          input.packId,
          input.expectedContentHash,
          input.expectedDraftRevision,
          now,
          input.editorId,
        ],
      );
      await client.query(
        "INSERT INTO recovery_pack_source_approvals (workspace_id, mutation_id, pack_id, request_hash, created_at) VALUES ($1,$2,$3,$4,$5)",
        [input.workspaceId, input.mutationId, input.packId, requestHash, now],
      );
      return withRecoveryPackSourceReview(current, mapSource(approved.rows[0]!));
    });
  }

  async getRecoveryPack(workspaceId: string, packId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        "SELECT * FROM recovery_packs WHERE workspace_id = $1 AND id = $2",
        [workspaceId, packId],
      );
      return result.rows[0] ? this.review(client, mapRecord(result.rows[0])) : null;
    });
  }

  async updateRecoveryPackDraft(input: RecoveryPackDraftUpdate) {
    return this.transaction(input.workspaceId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `recovery-pack:${input.workspaceId}:${input.mutationId}`,
      ]);
      const workspaceWritable = await this.lockWorkspaceForWrite(client, input.workspaceId);
      const locked = await client.query(
        "SELECT * FROM recovery_packs WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
        [input.workspaceId, input.packId],
      );
      if (!locked.rows[0]) return null;
      const current = mapRecord(locked.rows[0]);
      const prior = await client.query(
        "SELECT * FROM recovery_pack_draft_mutations WHERE workspace_id = $1 AND mutation_id = $2",
        [input.workspaceId, input.mutationId],
      );
      if (prior.rows[0]) {
        const receipt = mapReceipt(prior.rows[0]);
        assertMutationMatches(receipt, input);
        return this.review(client, replay(current, receipt));
      }
      if (!workspaceWritable) throw new WorkspaceDeletionInProgressError(input.workspaceId);
      if (current.draftRevision !== input.expectedRevision)
        throw new RecoveryPackDraftConflictError(
          input.expectedRevision,
          current.draftRevision,
          current.lastEditedBy,
        );
      const draft = upcastRecoveryPackDraft(input.draft, input.draft.schemaVersion);
      const comparison = await client.query<{ meaningful: boolean }>(
        "SELECT $1::jsonb <> $2::jsonb AS meaningful",
        [JSON.stringify(current.draft), JSON.stringify(draft)],
      );
      const meaningful = comparison.rows[0]?.meaningful ?? true;
      let updated = current;
      if (meaningful) {
        const result = await client.query(
          `UPDATE recovery_packs SET title = $3, description = $4, draft = $5, draft_revision = $6,
             draft_schema_version = $7, last_edited_by = $8, updated_at = now()
           WHERE workspace_id = $1 AND id = $2 RETURNING *`,
          [
            input.workspaceId,
            input.packId,
            draft.title,
            draft.description,
            JSON.stringify(draft),
            current.draftRevision + 1,
            draft.schemaVersion,
            input.editorId,
          ],
        );
        updated = mapRecord(result.rows[0]!);
        await client.query(
          `INSERT INTO recovery_pack_draft_history (id, workspace_id, pack_id, revision, draft, draft_schema_version, saved_by, mutation_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            randomUUID(),
            input.workspaceId,
            input.packId,
            updated.draftRevision,
            JSON.stringify(draft),
            draft.schemaVersion,
            input.editorId,
            input.mutationId,
          ],
        );
      }
      await client.query(
        `INSERT INTO recovery_pack_draft_mutations (workspace_id, mutation_id, pack_id, expected_revision,
           resulting_revision, draft_hash, resulting_draft, draft_schema_version, last_edited_by, resulting_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          input.workspaceId,
          input.mutationId,
          input.packId,
          input.expectedRevision,
          updated.draftRevision,
          input.draftHash,
          JSON.stringify(updated.draft),
          updated.draftSchemaVersion,
          updated.lastEditedBy,
          updated.updatedAt,
        ],
      );
      await client.query(
        `DELETE FROM recovery_pack_draft_history history
         WHERE history.workspace_id = $1 AND history.pack_id = $2
           AND (history.created_at < now() - interval '30 days' OR history.id NOT IN (
             SELECT kept.id FROM recovery_pack_draft_history kept WHERE kept.workspace_id = $1 AND kept.pack_id = $2
             ORDER BY kept.revision DESC LIMIT 20))`,
        [input.workspaceId, input.packId],
      );
      await client.query(
        "DELETE FROM recovery_pack_draft_mutations WHERE workspace_id = $1 AND pack_id = $2 AND created_at < now() - interval '30 days'",
        [input.workspaceId, input.packId],
      );
      return this.review(client, updated);
    });
  }

  async replayRecoveryPackMutation(input: RecoveryPackMutationReplay) {
    return this.transaction(input.workspaceId, async (client) => {
      const pack = await client.query(
        "SELECT * FROM recovery_packs WHERE workspace_id = $1 AND id = $2",
        [input.workspaceId, input.packId],
      );
      if (!pack.rows[0]) return null;
      const result = await client.query(
        "SELECT * FROM recovery_pack_draft_mutations WHERE workspace_id = $1 AND mutation_id = $2",
        [input.workspaceId, input.mutationId],
      );
      if (!result.rows[0]) return null;
      const receipt = mapReceipt(result.rows[0]);
      assertMutationMatches(receipt, input);
      return this.review(client, replay(mapRecord(pack.rows[0]), receipt));
    });
  }

  async publishRecoveryPack(input: RecoveryPackVersionRecord, expectedDraftRevision: number) {
    const item = normalizeVersion(input);
    return this.transaction(item.workspaceId, async (client) => {
      if (!(await this.lockWorkspaceForWrite(client, item.workspaceId)))
        throw new WorkspaceDeletionInProgressError(item.workspaceId);
      const locked = await client.query(
        "SELECT * FROM recovery_packs WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
        [item.workspaceId, item.packId],
      );
      if (!locked.rows[0]) throw new RecoveryPackNotFoundError();
      const current = mapRecord(locked.rows[0]);
      if (current.draftRevision !== expectedDraftRevision)
        throw new RecoveryPackDraftConflictError(
          expectedDraftRevision,
          current.draftRevision,
          current.lastEditedBy,
        );
      assertSourcePublish(
        current,
        await this.source(client, item.workspaceId, item.packId),
        item.content,
        item.contentHash,
      );
      const mediaIds = recoveryPackMediaIds(item.content);
      if (mediaIds.length) {
        const assets = await client.query(
          "SELECT id, scan_status FROM media_assets WHERE workspace_id = $1 AND id = ANY($2::uuid[]) FOR SHARE",
          [item.workspaceId, mediaIds],
        );
        if (
          assets.rows.length !== mediaIds.length ||
          assets.rows.some((asset) => asset.scan_status !== "clean")
        )
          throw new RecoveryPackMediaValidationError(
            "Recovery Pack media must be clean before publishing",
          );
      }
      const prior = await client.query(
        "SELECT * FROM recovery_pack_versions WHERE workspace_id = $1 AND pack_id = $2 AND content_hash = $3",
        [item.workspaceId, item.packId, item.contentHash],
      );
      let version = prior.rows[0] ? mapVersion(prior.rows[0]) : null;
      if (!version) {
        const next = await client.query<{ next_version: number }>(
          "SELECT COALESCE(max(version), 0) + 1 AS next_version FROM recovery_pack_versions WHERE workspace_id = $1 AND pack_id = $2",
          [item.workspaceId, item.packId],
        );
        const result = await client.query(
          `INSERT INTO recovery_pack_versions (id, workspace_id, pack_id, version, content, content_schema_version, content_hash, source_draft_revision, published_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            item.id,
            item.workspaceId,
            item.packId,
            Number(next.rows[0]!.next_version),
            JSON.stringify(item.content),
            item.contentSchemaVersion,
            item.contentHash,
            expectedDraftRevision,
            item.publishedAt,
          ],
        );
        version = mapVersion(result.rows[0]!);
      }
      await client.query(
        "UPDATE recovery_packs SET current_version_id = $3, published_draft_revision = $4, updated_at = now() WHERE workspace_id = $1 AND id = $2",
        [item.workspaceId, item.packId, version.id, expectedDraftRevision],
      );
      return version;
    });
  }

  async getRecoveryPackVersion(workspaceId: string, versionId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        "SELECT * FROM recovery_pack_versions WHERE workspace_id = $1 AND id = $2",
        [workspaceId, versionId],
      );
      return result.rows[0] ? mapVersion(result.rows[0]) : null;
    });
  }

  async listRecoveryPackHistory(workspaceId: string, packId: string, limit = 20) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        "SELECT * FROM recovery_pack_draft_history WHERE workspace_id = $1 AND pack_id = $2 ORDER BY revision DESC LIMIT $3",
        [workspaceId, packId, Math.min(20, Math.max(0, limit))],
      );
      return result.rows.map(mapHistory);
    });
  }

  async deleteRecoveryPack(workspaceId: string, packId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        "DELETE FROM recovery_packs WHERE workspace_id = $1 AND id = $2 RETURNING id",
        [workspaceId, packId],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }
}

export function createRecoveryPackRepository(repository: Repository): RecoveryPackRepository {
  if (repository instanceof PostgresRepository)
    return new PostgresRecoveryPackRepository(repository);
  if (repository instanceof MemoryRepository)
    return repository.getOrCreateLifecycleExtension(
      "recoveryPacks",
      () => new MemoryRecoveryPackRepository(repository),
    );
  throw new Error("Recovery Packs require a supported durable or in-memory repository");
}
