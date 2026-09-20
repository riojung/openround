import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import type { Repository } from "./types.js";
import { presentationMediaIds } from "./media-references.js";
import {
  PRESENTATION_CONTENT_SCHEMA_VERSION,
  PRESENTATION_DRAFT_SCHEMA_VERSION,
  upcastPresentationContent,
  upcastPresentationDraft,
} from "./artifact-schemas.js";
import {
  PresentationArchivedError,
  PresentationDraftConflictError,
  PresentationMutationConflictError,
  type PresentationDraftUpdate,
  type PresentationHistoryRecord,
  type PresentationRecord,
  type PresentationRepository,
  type PresentationSummaryRecord,
  type PresentationVersionRecord,
} from "./presentation-types.js";

interface PresentationMutationReceipt {
  workspaceId: string;
  presentationId: string;
  expectedRevision: number;
  resultingRevision: number;
  draftHash: string;
  createdAt: Date;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizePresentationRecord(input: PresentationRecord): PresentationRecord {
  const draftSchemaVersion = input.draftSchemaVersion ?? PRESENTATION_DRAFT_SCHEMA_VERSION;
  const draft = upcastPresentationDraft(input.draft, draftSchemaVersion);
  return {
    ...input,
    title: draft.title,
    description: draft.description,
    draft,
    draftSchemaVersion,
  };
}

function normalizePresentationVersion(input: PresentationVersionRecord): PresentationVersionRecord {
  const contentSchemaVersion = input.contentSchemaVersion ?? PRESENTATION_CONTENT_SCHEMA_VERSION;
  return {
    ...input,
    content: upcastPresentationContent(input.content, contentSchemaVersion),
    contentSchemaVersion,
  };
}

function normalizePresentationHistory(
  input: PresentationHistoryRecord,
  fallbackSchemaVersion = PRESENTATION_DRAFT_SCHEMA_VERSION,
): PresentationHistoryRecord {
  const draftSchemaVersion = input.draftSchemaVersion ?? fallbackSchemaVersion;
  return {
    ...input,
    draft: upcastPresentationDraft(input.draft, draftSchemaVersion),
    draftSchemaVersion,
  };
}

function presentationAtDraftRevision(
  current: PresentationRecord,
  snapshot: PresentationHistoryRecord,
): PresentationRecord {
  const normalized = normalizePresentationHistory(snapshot);
  return normalizePresentationRecord({
    ...current,
    title: normalized.draft.title,
    description: normalized.draft.description,
    draft: clone(normalized.draft),
    draftRevision: normalized.revision,
    draftSchemaVersion: normalized.draftSchemaVersion ?? PRESENTATION_DRAFT_SCHEMA_VERSION,
    lastEditedBy: normalized.savedBy,
    updatedAt: normalized.createdAt,
  });
}

function mutationKey(workspaceId: string, mutationId: string) {
  return `${workspaceId}:${mutationId}`;
}

function assertMutationMatches(
  receipt: PresentationMutationReceipt,
  input: Pick<
    PresentationDraftUpdate,
    "workspaceId" | "presentationId" | "expectedRevision" | "mutationId" | "draftHash"
  >,
) {
  if (
    receipt.workspaceId !== input.workspaceId ||
    receipt.presentationId !== input.presentationId ||
    receipt.expectedRevision !== input.expectedRevision ||
    receipt.draftHash !== input.draftHash
  ) {
    throw new PresentationMutationConflictError(input.mutationId);
  }
}

function mapPresentation(row: QueryResultRow): PresentationRecord {
  const draftSchemaVersion = Number(row.draft_schema_version ?? PRESENTATION_DRAFT_SCHEMA_VERSION);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    title: String(row.title),
    description: String(row.description),
    status: row.status,
    draft: upcastPresentationDraft(row.draft, draftSchemaVersion),
    draftRevision: Number(row.draft_revision),
    draftSchemaVersion,
    currentVersionId: row.current_version_id ? String(row.current_version_id) : null,
    folderId: row.folder_id ? String(row.folder_id) : null,
    publishedDraftRevision:
      row.published_draft_revision == null ? null : Number(row.published_draft_revision),
    lastEditedBy: row.last_edited_by ? String(row.last_edited_by) : null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

function mapPresentationVersion(row: QueryResultRow): PresentationVersionRecord {
  const contentSchemaVersion = Number(
    row.content_schema_version ?? PRESENTATION_CONTENT_SCHEMA_VERSION,
  );
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    presentationId: String(row.presentation_id),
    version: Number(row.version),
    content: upcastPresentationContent(row.content, contentSchemaVersion),
    contentSchemaVersion,
    contentHash: String(row.content_hash),
    sourceDraftRevision: Number(row.source_draft_revision),
    publishedAt:
      row.published_at instanceof Date ? row.published_at : new Date(String(row.published_at)),
  };
}

function mapPresentationSummary(row: QueryResultRow): PresentationSummaryRecord {
  const draftSchemaVersion = Number(row.draft_schema_version ?? PRESENTATION_DRAFT_SCHEMA_VERSION);
  const draft = upcastPresentationDraft(row.draft, draftSchemaVersion);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    title: String(row.title),
    description: String(row.description),
    status: row.status,
    draftRevision: Number(row.draft_revision),
    draftSchemaVersion,
    currentVersionId: row.current_version_id ? String(row.current_version_id) : null,
    folderId: row.folder_id ? String(row.folder_id) : null,
    publishedDraftRevision:
      row.published_draft_revision == null ? null : Number(row.published_draft_revision),
    lastEditedBy: row.last_edited_by ? String(row.last_edited_by) : null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
    blockCount: draft.blocks.length,
  };
}

function mapPresentationHistory(row: QueryResultRow): PresentationHistoryRecord {
  const draftSchemaVersion = Number(row.draft_schema_version ?? PRESENTATION_DRAFT_SCHEMA_VERSION);
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    presentationId: String(row.presentation_id),
    revision: Number(row.revision),
    draft: upcastPresentationDraft(row.draft, draftSchemaVersion),
    draftSchemaVersion,
    savedBy: row.saved_by ? String(row.saved_by) : null,
    mutationId: row.mutation_id ? String(row.mutation_id) : null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
  };
}

function mapMutationReceipt(row: QueryResultRow): PresentationMutationReceipt {
  return {
    workspaceId: String(row.workspace_id),
    presentationId: String(row.presentation_id),
    expectedRevision: Number(row.expected_revision),
    resultingRevision: Number(row.resulting_revision),
    draftHash: String(row.draft_hash),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
  };
}

export class MemoryPresentationRepository
  implements PresentationRepository, MemoryRepositoryLifecycleExtension
{
  readonly presentations = new Map<string, PresentationRecord>();
  readonly versions = new Map<string, PresentationVersionRecord>();
  readonly history = new Map<string, PresentationHistoryRecord>();
  private readonly mutations = new Map<string, PresentationMutationReceipt>();

  constructor(
    private readonly repository?: Pick<
      MemoryRepository,
      "listFolders" | "replaceMediaReferences" | "validateMediaReferences"
    >,
  ) {}

  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      presentations: [...this.presentations.values()]
        .filter((presentation) => ownedWorkspaceIds.has(presentation.workspaceId))
        .map((presentation) => clone(normalizePresentationRecord(presentation))),
      presentationVersions: [...this.versions.values()]
        .filter((version) => ownedWorkspaceIds.has(version.workspaceId))
        .map((version) => clone(normalizePresentationVersion(version))),
      presentationDraftHistory: [...this.history.values()]
        .filter((snapshot) => ownedWorkspaceIds.has(snapshot.workspaceId))
        .map((snapshot) => clone(normalizePresentationHistory(snapshot))),
    };
  }

  deleteAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const [id, presentation] of this.presentations) {
      if (ownedWorkspaceIds.has(presentation.workspaceId)) this.presentations.delete(id);
    }
    for (const [id, version] of this.versions) {
      if (ownedWorkspaceIds.has(version.workspaceId)) this.versions.delete(id);
    }
    for (const [id, snapshot] of this.history) {
      if (ownedWorkspaceIds.has(snapshot.workspaceId)) this.history.delete(id);
    }
    for (const [id, mutation] of this.mutations) {
      if (ownedWorkspaceIds.has(mutation.workspaceId)) this.mutations.delete(id);
    }
  }

  async listPresentations(workspaceId: string, includeArchived = false) {
    const folderIds = new Set(
      (await this.repository?.listFolders(workspaceId))?.map((folder) => folder.id) ?? [],
    );
    return [...this.presentations.values()]
      .filter(
        (presentation) =>
          presentation.workspaceId === workspaceId &&
          (includeArchived || presentation.status !== "archived"),
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((presentation) => {
        const normalized = normalizePresentationRecord(presentation);
        if (presentation.folderId && !folderIds.has(presentation.folderId)) {
          presentation.folderId = null;
          normalized.folderId = null;
        }
        const { draft, ...summary } = clone(normalized);
        return { ...summary, blockCount: draft.blocks.length };
      });
  }

  async createPresentation(input: PresentationRecord) {
    const created = clone(normalizePresentationRecord(input));
    this.repository?.validateMediaReferences(
      created.workspaceId,
      presentationMediaIds(created.draft),
    );
    this.presentations.set(input.id, created);
    const historyId = randomUUID();
    this.history.set(`${input.id}:0`, {
      id: historyId,
      workspaceId: input.workspaceId,
      presentationId: input.id,
      revision: 0,
      draft: clone(created.draft),
      draftSchemaVersion: created.draftSchemaVersion,
      savedBy: input.lastEditedBy,
      mutationId: null,
      createdAt: input.createdAt,
    });
    await this.repository?.replaceMediaReferences(
      input.workspaceId,
      "presentation_draft",
      input.id,
      presentationMediaIds(created.draft),
      input.createdAt,
    );
    await this.repository?.replaceMediaReferences(
      input.workspaceId,
      "presentation_history",
      historyId,
      presentationMediaIds(created.draft),
      input.createdAt,
    );
    return clone(created);
  }

  async getPresentation(workspaceId: string, presentationId: string) {
    const presentation = this.presentations.get(presentationId);
    if (!presentation || presentation.workspaceId !== workspaceId) return null;
    if (presentation.folderId) {
      const folders = await this.repository?.listFolders(workspaceId);
      if (!folders?.some((folder) => folder.id === presentation.folderId)) {
        presentation.folderId = null;
      }
    }
    return clone(normalizePresentationRecord(presentation));
  }

  async updatePresentationDraft(input: PresentationDraftUpdate) {
    const draft = upcastPresentationDraft(input.draft, input.draft.schemaVersion);
    const presentation = this.presentations.get(input.presentationId);
    if (!presentation || presentation.workspaceId !== input.workspaceId) {
      return null;
    }
    const key = mutationKey(input.workspaceId, input.mutationId);
    const retry = this.mutations.get(key);
    if (retry) {
      assertMutationMatches(retry, input);
      return this.replayPresentationDraftMutation(presentation, retry);
    }
    if (presentation.status === "archived") return null;
    if (presentation.draftRevision !== input.expectedRevision) {
      throw new PresentationDraftConflictError(
        input.expectedRevision,
        presentation.draftRevision,
        presentation.lastEditedBy,
      );
    }
    const meaningful =
      JSON.stringify(normalizePresentationRecord(presentation).draft) !== JSON.stringify(draft);
    if (meaningful) {
      this.repository?.validateMediaReferences(input.workspaceId, presentationMediaIds(draft));
    }
    const revision = meaningful ? presentation.draftRevision + 1 : presentation.draftRevision;
    const updatedAt = new Date();
    this.mutations.set(key, {
      workspaceId: input.workspaceId,
      presentationId: input.presentationId,
      expectedRevision: input.expectedRevision,
      resultingRevision: revision,
      draftHash: input.draftHash,
      createdAt: updatedAt,
    });
    if (!meaningful) return clone(normalizePresentationRecord(presentation));

    const updated: PresentationRecord = {
      ...presentation,
      title: draft.title,
      description: draft.description,
      draft: clone(draft),
      draftRevision: revision,
      draftSchemaVersion: draft.schemaVersion,
      lastEditedBy: input.editorId,
      updatedAt,
    };
    this.presentations.set(updated.id, updated);
    const historyId = randomUUID();
    this.history.set(`${updated.id}:${revision}`, {
      id: historyId,
      workspaceId: updated.workspaceId,
      presentationId: updated.id,
      revision,
      draft: clone(updated.draft),
      draftSchemaVersion: updated.draftSchemaVersion,
      savedBy: input.editorId,
      mutationId: input.mutationId,
      createdAt: updated.updatedAt,
    });
    await this.repository?.replaceMediaReferences(
      updated.workspaceId,
      "presentation_draft",
      updated.id,
      presentationMediaIds(updated.draft),
      updated.updatedAt,
    );
    await this.repository?.replaceMediaReferences(
      updated.workspaceId,
      "presentation_history",
      historyId,
      presentationMediaIds(updated.draft),
      updated.updatedAt,
    );
    await this.pruneHistory(updated.id, updated.updatedAt);
    return clone(normalizePresentationRecord(updated));
  }

  private replayPresentationDraftMutation(
    current: PresentationRecord,
    receipt: PresentationMutationReceipt,
  ): PresentationRecord {
    if (current.draftRevision === receipt.resultingRevision) {
      return clone(normalizePresentationRecord(current));
    }
    const snapshot = this.history.get(`${receipt.presentationId}:${receipt.resultingRevision}`);
    if (snapshot && snapshot.workspaceId === receipt.workspaceId) {
      return clone(presentationAtDraftRevision(current, snapshot));
    }
    throw new PresentationDraftConflictError(
      receipt.resultingRevision,
      current.draftRevision,
      current.lastEditedBy,
    );
  }

  private async pruneHistory(presentationId: string, now: Date) {
    const snapshots = [...this.history.entries()]
      .filter(([, item]) => item.presentationId === presentationId)
      .sort((left, right) => right[1].revision - left[1].revision);
    const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1_000;
    for (const [index, [key, snapshot]] of snapshots.entries()) {
      if (index >= 20 || snapshot.createdAt.getTime() < cutoff) {
        this.history.delete(key);
        await this.repository?.replaceMediaReferences(
          snapshot.workspaceId,
          "presentation_history",
          snapshot.id,
          [],
          now,
        );
      }
    }
    for (const [key, receipt] of this.mutations) {
      if (receipt.presentationId === presentationId && receipt.createdAt.getTime() < cutoff) {
        this.mutations.delete(key);
      }
    }
  }

  async publishPresentation(input: PresentationVersionRecord, expectedDraftRevision: number) {
    const presentation = this.presentations.get(input.presentationId);
    if (!presentation || presentation.workspaceId !== input.workspaceId) {
      throw new Error("Presentation not found");
    }
    if (presentation.status === "archived") throw new PresentationArchivedError();
    if (presentation.draftRevision !== expectedDraftRevision) {
      throw new PresentationDraftConflictError(
        expectedDraftRevision,
        presentation.draftRevision,
        presentation.lastEditedBy,
      );
    }
    const normalizedInput = normalizePresentationVersion(input);
    const existing = [...this.versions.values()].find(
      (version) =>
        version.presentationId === normalizedInput.presentationId &&
        version.contentHash === normalizedInput.contentHash,
    );
    const version = existing ? normalizePresentationVersion(existing) : clone(normalizedInput);
    this.versions.set(version.id, version);
    Object.assign(presentation, {
      status: "published",
      currentVersionId: version.id,
      publishedDraftRevision: expectedDraftRevision,
      updatedAt: new Date(),
    });
    await this.repository?.replaceMediaReferences(
      version.workspaceId,
      "presentation_version",
      version.id,
      presentationMediaIds(version.content),
      version.publishedAt,
    );
    return clone(version);
  }

  async getPresentationVersion(workspaceId: string, versionId: string) {
    const version = this.versions.get(versionId);
    return version?.workspaceId === workspaceId
      ? clone(normalizePresentationVersion(version))
      : null;
  }

  async listPresentationHistory(workspaceId: string, presentationId: string, limit = 20) {
    return [...this.history.values()]
      .filter(
        (snapshot) =>
          snapshot.workspaceId === workspaceId && snapshot.presentationId === presentationId,
      )
      .sort((left, right) => right.revision - left.revision)
      .slice(0, limit)
      .map((snapshot) => clone(normalizePresentationHistory(snapshot)));
  }

  async restorePresentationHistory(input: {
    workspaceId: string;
    presentationId: string;
    historyRevision: number;
    expectedRevision: number;
    mutationId: string;
    editorId: string;
  }) {
    const presentation = this.presentations.get(input.presentationId);
    if (!presentation || presentation.workspaceId !== input.workspaceId) return null;
    const draftHash = `restore:${input.historyRevision}`;
    const retry = this.mutations.get(mutationKey(input.workspaceId, input.mutationId));
    if (retry) {
      assertMutationMatches(retry, { ...input, draftHash });
      return this.replayPresentationDraftMutation(presentation, retry);
    }
    const snapshot = this.history.get(`${input.presentationId}:${input.historyRevision}`);
    if (!snapshot || snapshot.workspaceId !== input.workspaceId) return null;
    return this.updatePresentationDraft({
      ...input,
      draft: normalizePresentationHistory(snapshot).draft,
      draftHash,
    });
  }

  async organizePresentation(workspaceId: string, presentationId: string, folderId: string | null) {
    const presentation = this.presentations.get(presentationId);
    if (!presentation || presentation.workspaceId !== workspaceId) return null;
    if (folderId) {
      const folders = await this.repository?.listFolders(workspaceId);
      if (!folders?.some((folder) => folder.id === folderId)) return null;
    }
    presentation.folderId = folderId;
    presentation.updatedAt = new Date();
    return clone(normalizePresentationRecord(presentation));
  }

  async archivePresentation(workspaceId: string, presentationId: string, archived: boolean) {
    const presentation = this.presentations.get(presentationId);
    if (!presentation || presentation.workspaceId !== workspaceId) return null;
    presentation.status = archived
      ? "archived"
      : presentation.currentVersionId
        ? "published"
        : "draft";
    presentation.updatedAt = new Date();
    return clone(normalizePresentationRecord(presentation));
  }
}

export class PostgresPresentationRepository implements PresentationRepository {
  constructor(private readonly repository: PostgresRepository) {}

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
      throw error;
    } finally {
      client.release();
    }
  }

  private async replayPresentationDraftMutation(
    client: PoolClient,
    input: Pick<PresentationDraftUpdate, "workspaceId" | "presentationId">,
    receipt: PresentationMutationReceipt,
    currentRow?: QueryResultRow,
  ): Promise<PresentationRecord | null> {
    const currentResult = currentRow
      ? null
      : await client.query("SELECT * FROM presentations WHERE workspace_id = $1 AND id = $2", [
          input.workspaceId,
          input.presentationId,
        ]);
    const row = currentRow ?? currentResult?.rows[0];
    if (!row) return null;
    const current = mapPresentation(row);
    if (current.draftRevision === receipt.resultingRevision) return current;

    const history = await client.query(
      `SELECT * FROM presentation_draft_history
       WHERE workspace_id = $1 AND presentation_id = $2 AND revision = $3`,
      [input.workspaceId, input.presentationId, receipt.resultingRevision],
    );
    if (history.rows[0]) {
      return presentationAtDraftRevision(current, mapPresentationHistory(history.rows[0]));
    }
    throw new PresentationDraftConflictError(
      receipt.resultingRevision,
      current.draftRevision,
      current.lastEditedBy,
    );
  }

  async listPresentations(workspaceId: string, includeArchived = false) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT id, workspace_id, title, description, status, draft, draft_revision,
                draft_schema_version, current_version_id, folder_id, published_draft_revision,
                last_edited_by, created_at, updated_at
         FROM presentations
         WHERE workspace_id = $1 AND ($2::boolean OR status <> 'archived')
         ORDER BY updated_at DESC`,
        [workspaceId, includeArchived],
      );
      return result.rows.map(mapPresentationSummary);
    });
  }

  async createPresentation(input: PresentationRecord) {
    const normalized = normalizePresentationRecord(input);
    return this.transaction(normalized.workspaceId, async (client) => {
      const result = await client.query(
        `INSERT INTO presentations
           (id, workspace_id, title, description, status, draft, draft_revision,
            draft_schema_version, current_version_id, folder_id, published_draft_revision,
            last_edited_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          normalized.id,
          normalized.workspaceId,
          normalized.title,
          normalized.description,
          normalized.status,
          JSON.stringify(normalized.draft),
          normalized.draftRevision,
          normalized.draftSchemaVersion,
          normalized.currentVersionId,
          normalized.folderId,
          normalized.publishedDraftRevision,
          normalized.lastEditedBy,
          normalized.createdAt,
          normalized.updatedAt,
        ],
      );
      await client.query(
        `INSERT INTO presentation_draft_history
           (id, workspace_id, presentation_id, revision, draft, draft_schema_version,
            saved_by, mutation_id, created_at)
         VALUES ($1,$2,$3,0,$4,$5,$6,NULL,$7)`,
        [
          randomUUID(),
          normalized.workspaceId,
          normalized.id,
          JSON.stringify(normalized.draft),
          normalized.draftSchemaVersion,
          normalized.lastEditedBy,
          normalized.createdAt,
        ],
      );
      return mapPresentation(result.rows[0]!);
    });
  }

  async getPresentation(workspaceId: string, presentationId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentations WHERE workspace_id = $1 AND id = $2",
        [workspaceId, presentationId],
      );
      return result.rows[0] ? mapPresentation(result.rows[0]) : null;
    });
  }

  async updatePresentationDraft(input: PresentationDraftUpdate) {
    const draft = upcastPresentationDraft(input.draft, input.draft.schemaVersion);
    return this.transaction(input.workspaceId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        mutationKey(input.workspaceId, input.mutationId),
      ]);
      const locked = await client.query(
        "SELECT * FROM presentations WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
        [input.workspaceId, input.presentationId],
      );
      if (!locked.rows[0]) return null;
      const retried = await client.query(
        `SELECT * FROM presentation_draft_mutations
         WHERE workspace_id = $1 AND mutation_id = $2`,
        [input.workspaceId, input.mutationId],
      );
      if (retried.rows[0]) {
        const receipt = mapMutationReceipt(retried.rows[0]);
        assertMutationMatches(receipt, input);
        return this.replayPresentationDraftMutation(client, input, receipt, locked.rows[0]);
      }
      if (locked.rows[0].status === "archived") return null;
      const currentRevision = Number(locked.rows[0].draft_revision);
      if (currentRevision !== input.expectedRevision) {
        throw new PresentationDraftConflictError(
          input.expectedRevision,
          currentRevision,
          locked.rows[0].last_edited_by ? String(locked.rows[0].last_edited_by) : null,
        );
      }
      const comparison = await client.query<{ meaningful: boolean }>(
        "SELECT $1::jsonb <> $2::jsonb AS meaningful",
        [JSON.stringify(locked.rows[0].draft), JSON.stringify(draft)],
      );
      const meaningful = comparison.rows[0]?.meaningful ?? true;
      const revision = meaningful ? currentRevision + 1 : currentRevision;
      await client.query(
        `INSERT INTO presentation_draft_mutations
           (mutation_id, workspace_id, presentation_id, expected_revision, resulting_revision, draft_hash)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          input.mutationId,
          input.workspaceId,
          input.presentationId,
          input.expectedRevision,
          revision,
          input.draftHash,
        ],
      );
      if (!meaningful) return mapPresentation(locked.rows[0]);

      const updated = await client.query(
        `UPDATE presentations SET title = $3, description = $4, draft = $5,
           draft_revision = $6, draft_schema_version = $7, last_edited_by = $8,
           updated_at = now()
         WHERE workspace_id = $1 AND id = $2 RETURNING *`,
        [
          input.workspaceId,
          input.presentationId,
          draft.title,
          draft.description,
          JSON.stringify(draft),
          revision,
          draft.schemaVersion,
          input.editorId,
        ],
      );
      await client.query(
        `INSERT INTO presentation_draft_history
           (id, workspace_id, presentation_id, revision, draft, draft_schema_version,
            saved_by, mutation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          input.workspaceId,
          input.presentationId,
          revision,
          JSON.stringify(draft),
          draft.schemaVersion,
          input.editorId,
          input.mutationId,
        ],
      );
      await client.query(
        `DELETE FROM presentation_draft_history history
         WHERE history.workspace_id = $1 AND history.presentation_id = $2
           AND (history.created_at < now() - interval '30 days' OR history.id NOT IN (
             SELECT kept.id FROM presentation_draft_history kept
             WHERE kept.workspace_id = $1 AND kept.presentation_id = $2
             ORDER BY kept.revision DESC LIMIT 20
           ))`,
        [input.workspaceId, input.presentationId],
      );
      await client.query(
        `DELETE FROM presentation_draft_mutations
         WHERE workspace_id = $1 AND presentation_id = $2
           AND created_at < now() - interval '30 days'`,
        [input.workspaceId, input.presentationId],
      );
      return mapPresentation(updated.rows[0]!);
    });
  }

  async publishPresentation(input: PresentationVersionRecord, expectedDraftRevision: number) {
    return this.transaction(input.workspaceId, async (client) => {
      const locked = await client.query(
        "SELECT * FROM presentations WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
        [input.workspaceId, input.presentationId],
      );
      if (!locked.rows[0]) throw new Error("Presentation not found");
      if (locked.rows[0].status === "archived") throw new PresentationArchivedError();
      const currentRevision = Number(locked.rows[0].draft_revision);
      if (currentRevision !== expectedDraftRevision) {
        throw new PresentationDraftConflictError(
          expectedDraftRevision,
          currentRevision,
          locked.rows[0].last_edited_by ? String(locked.rows[0].last_edited_by) : null,
        );
      }
      const normalized = normalizePresentationVersion(input);
      const existing = await client.query(
        `SELECT * FROM presentation_versions
         WHERE workspace_id = $1 AND presentation_id = $2 AND content_hash = $3`,
        [normalized.workspaceId, normalized.presentationId, normalized.contentHash],
      );
      let version = existing.rows[0] ? mapPresentationVersion(existing.rows[0]) : null;
      if (!version) {
        const inserted = await client.query(
          `INSERT INTO presentation_versions
             (id, workspace_id, presentation_id, version, content, content_schema_version,
              content_hash, source_draft_revision, published_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            normalized.id,
            normalized.workspaceId,
            normalized.presentationId,
            normalized.version,
            JSON.stringify(normalized.content),
            normalized.contentSchemaVersion,
            normalized.contentHash,
            normalized.sourceDraftRevision,
            normalized.publishedAt,
          ],
        );
        version = mapPresentationVersion(inserted.rows[0]!);
      }
      await client.query(
        `UPDATE presentations SET status = 'published', current_version_id = $3,
           published_draft_revision = $4, updated_at = now()
         WHERE workspace_id = $1 AND id = $2`,
        [normalized.workspaceId, normalized.presentationId, version.id, expectedDraftRevision],
      );
      return version;
    });
  }

  async getPresentationVersion(workspaceId: string, versionId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        "SELECT * FROM presentation_versions WHERE workspace_id = $1 AND id = $2",
        [workspaceId, versionId],
      );
      return result.rows[0] ? mapPresentationVersion(result.rows[0]) : null;
    });
  }

  async listPresentationHistory(workspaceId: string, presentationId: string, limit = 20) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `SELECT * FROM presentation_draft_history
         WHERE workspace_id = $1 AND presentation_id = $2
         ORDER BY revision DESC LIMIT $3`,
        [workspaceId, presentationId, limit],
      );
      return result.rows.map(mapPresentationHistory);
    });
  }

  async restorePresentationHistory(input: {
    workspaceId: string;
    presentationId: string;
    historyRevision: number;
    expectedRevision: number;
    mutationId: string;
    editorId: string;
  }) {
    const draftHash = `restore:${input.historyRevision}`;
    const replayReceipt = () =>
      this.transaction(input.workspaceId, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          mutationKey(input.workspaceId, input.mutationId),
        ]);
        const current = await client.query(
          "SELECT * FROM presentations WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
          [input.workspaceId, input.presentationId],
        );
        if (!current.rows[0]) return { handled: true as const, presentation: null };
        const receipt = await client.query(
          `SELECT * FROM presentation_draft_mutations
           WHERE workspace_id = $1 AND mutation_id = $2`,
          [input.workspaceId, input.mutationId],
        );
        if (!receipt.rows[0]) return { handled: false as const, presentation: null };
        const mappedReceipt = mapMutationReceipt(receipt.rows[0]);
        assertMutationMatches(mappedReceipt, { ...input, draftHash });
        return {
          handled: true as const,
          presentation: await this.replayPresentationDraftMutation(
            client,
            input,
            mappedReceipt,
            current.rows[0],
          ),
        };
      });
    const replayed = await replayReceipt();
    if (replayed.handled) return replayed.presentation;
    const history = await this.listPresentationHistory(input.workspaceId, input.presentationId, 20);
    const snapshot = history.find((item) => item.revision === input.historyRevision);
    if (!snapshot) {
      const racedReplay = await replayReceipt();
      return racedReplay.handled ? racedReplay.presentation : null;
    }
    return this.updatePresentationDraft({
      ...input,
      draft: snapshot.draft,
      draftHash,
    });
  }

  async organizePresentation(workspaceId: string, presentationId: string, folderId: string | null) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `UPDATE presentations SET folder_id = $3, updated_at = now()
         WHERE workspace_id = $1 AND id = $2
           AND ($3::uuid IS NULL OR EXISTS (
             SELECT 1 FROM folders WHERE workspace_id = $1 AND id = $3
           ))
         RETURNING *`,
        [workspaceId, presentationId, folderId],
      );
      return result.rows[0] ? mapPresentation(result.rows[0]) : null;
    });
  }

  async archivePresentation(workspaceId: string, presentationId: string, archived: boolean) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `UPDATE presentations
         SET status = CASE
               WHEN $3 THEN 'archived'
               WHEN current_version_id IS NOT NULL THEN 'published'
               ELSE 'draft'
             END,
             archived_at = CASE WHEN $3 THEN now() ELSE NULL END,
             updated_at = now()
         WHERE workspace_id = $1 AND id = $2
         RETURNING *`,
        [workspaceId, presentationId, archived],
      );
      return result.rows[0] ? mapPresentation(result.rows[0]) : null;
    });
  }
}

export function createPresentationRepository(repository: Repository): PresentationRepository {
  if (repository instanceof PostgresRepository)
    return new PostgresPresentationRepository(repository);
  if (repository instanceof MemoryRepository) {
    return repository.getOrCreateLifecycleExtension(
      "presentations",
      () => new MemoryPresentationRepository(repository),
    );
  }
  return new MemoryPresentationRepository();
}
