import { randomUUID } from "node:crypto";
import { ScopedAudienceEventSchema } from "@openround/contracts";
import type { PoolClient, QueryResultRow } from "pg";
import {
  MemoryRepository,
  type MemoryRepositoryLifecycleContext,
  type MemoryRepositoryLifecycleExtension,
} from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import { createPresentationSessionRepository } from "./presentation-sessions.js";
import type { MemoryPresentationSessionRepository } from "./presentation-session-memory.js";
import { WorkspaceDeletionInProgressError, type Repository } from "./types.js";
import {
  AudienceScopeStoreError,
  type AudienceScopeRecord,
  type AudienceScopeRepository,
  type ScopedAudienceOutboxRecord,
} from "./audience-scope-types.js";

function activationEvent(scope: AudienceScopeRecord) {
  return ScopedAudienceEventSchema.parse({
    schemaVersion: 1,
    eventId: randomUUID(),
    scopeId: scope.id,
    audienceSeq: scope.audienceSeq,
    serverTime: scope.createdAt.toISOString(),
    type: "audience.scope.activated",
    payload: { kind: "presentation" },
  });
}

export class MemoryAudienceScopeRepository
  implements AudienceScopeRepository, MemoryRepositoryLifecycleExtension
{
  private readonly scopes = new Map<string, AudienceScopeRecord>();
  private readonly outbox = new Map<string, ScopedAudienceOutboxRecord>();

  constructor(
    private readonly sessions: Pick<
      MemoryPresentationSessionRepository,
      "getSessionForWorkspaceSync"
    >,
    private readonly repository: Pick<
      MemoryRepository,
      "assertWorkspaceLiveSessionCreationAllowed"
    >,
  ) {}

  async get(workspaceId: string, scopeId: string) {
    const scope = this.scopes.get(scopeId);
    return scope?.workspaceId === workspaceId ? structuredClone(scope) : null;
  }

  async activatePresentation(input: {
    workspaceId: string;
    sessionId: string;
    idempotencyKey: string;
    now: Date;
  }) {
    // All checks and both writes stay in one synchronous turn, matching the parent's lifecycle
    // mutations. An awaited cloned parent could be finished/deleted before these records commit.
    const session = this.sessions.getSessionForWorkspaceSync(input.workspaceId, input.sessionId);
    if (!session) throw new AudienceScopeStoreError("NOT_FOUND", "Presentation not found");
    if (
      [...this.scopes.values()].some(
        (scope) =>
          scope.workspaceId === input.workspaceId &&
          scope.creationIdempotencyKey === input.idempotencyKey &&
          scope.id !== input.sessionId,
      )
    ) {
      throw new AudienceScopeStoreError(
        "CONFLICT",
        "This idempotency key was used for another audience scope",
      );
    }
    const existing = this.scopes.get(input.sessionId);
    if (existing) return { scope: structuredClone(existing), created: false };
    this.repository.assertWorkspaceLiveSessionCreationAllowed(input.workspaceId);
    if (
      session.status !== "active" ||
      session.liveExpiresAt <= input.now ||
      session.retentionExpiresAt <= input.now
    ) {
      throw new AudienceScopeStoreError(
        "ROOM_CLOSED",
        "This Presentation is closed; create a new live room",
      );
    }
    const scope: AudienceScopeRecord = {
      id: session.id,
      workspaceId: session.workspaceId,
      kind: "presentation",
      identityPolicy: "facilitator_visible_alias",
      schemaVersion: 1,
      audienceSeq: 1,
      creationIdempotencyKey: input.idempotencyKey,
      createdAt: input.now,
      expiresAt: session.retentionExpiresAt,
    };
    const event = activationEvent(scope);
    this.scopes.set(scope.id, structuredClone(scope));
    this.outbox.set(event.eventId, {
      workspaceId: scope.workspaceId,
      event,
      leaseToken: null,
      leaseUntil: null,
      publishedAt: null,
    });
    return { scope: structuredClone(scope), created: true };
  }

  async claimOutbox(now: Date, leaseUntil: Date) {
    const record = [...this.outbox.values()]
      .filter(
        (row) =>
          !row.publishedAt &&
          (!row.leaseUntil || row.leaseUntil <= now) &&
          this.scopes.get(row.event.scopeId)!.expiresAt > now,
      )
      .sort(
        (a, b) =>
          a.event.serverTime.localeCompare(b.event.serverTime) ||
          a.event.eventId.localeCompare(b.event.eventId),
      )[0];
    if (!record) return null;
    record.leaseToken = randomUUID();
    record.leaseUntil = leaseUntil;
    return structuredClone(record);
  }

  async completeOutbox(workspaceId: string, eventId: string, leaseToken: string, now: Date) {
    const record = this.outbox.get(eventId);
    if (
      !record ||
      record.workspaceId !== workspaceId ||
      record.leaseToken !== leaseToken ||
      record.publishedAt ||
      !record.leaseUntil ||
      record.leaseUntil <= now
    )
      return false;
    record.publishedAt = now;
    record.leaseToken = null;
    record.leaseUntil = null;
    return true;
  }

  deletePresentationSessionMetadata(workspaceId: string, sessionId: string) {
    if (this.scopes.get(sessionId)?.workspaceId !== workspaceId) return;
    this.scopes.delete(sessionId);
    for (const [id, row] of this.outbox)
      if (row.event.scopeId === sessionId) this.outbox.delete(id);
  }

  exportAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    return {
      audienceScopes: [...this.scopes.values()]
        .filter((scope) => ownedWorkspaceIds.has(scope.workspaceId))
        .map((scope) => structuredClone(scope)),
    };
  }

  deleteAccount({ ownedWorkspaceIds }: MemoryRepositoryLifecycleContext) {
    for (const scope of this.scopes.values())
      if (ownedWorkspaceIds.has(scope.workspaceId))
        this.deletePresentationSessionMetadata(scope.workspaceId, scope.id);
  }

  purgeExpired(now: Date) {
    for (const scope of this.scopes.values())
      if (scope.expiresAt <= now)
        this.deletePresentationSessionMetadata(scope.workspaceId, scope.id);
    return [];
  }
}

function mapScope(row: QueryResultRow): AudienceScopeRecord {
  if (
    row.schema_version !== 1 ||
    row.kind !== "presentation" ||
    row.identity_policy !== "facilitator_visible_alias"
  ) {
    throw new Error("Unsupported stored audience-scope schema; keep compatible readers deployed");
  }
  if (!Number.isSafeInteger(Number(row.audience_seq)) || Number(row.audience_seq) < 1)
    throw new Error("Invalid stored audience sequence");
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    identityPolicy: row.identity_policy,
    schemaVersion: row.schema_version,
    audienceSeq: Number(row.audience_seq),
    creationIdempotencyKey: row.creation_idempotency_key,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
  };
}

function mapOutbox(row: QueryResultRow): ScopedAudienceOutboxRecord {
  return {
    workspaceId: row.workspace_id,
    event: ScopedAudienceEventSchema.parse({
      schemaVersion: row.schema_version,
      eventId: row.event_id,
      scopeId: row.scope_id,
      audienceSeq: Number(row.audience_seq),
      serverTime: new Date(row.created_at).toISOString(),
      type: row.event_type,
      payload: row.payload,
    }),
    leaseToken: row.lease_token,
    leaseUntil: row.lease_until ? new Date(row.lease_until) : null,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
  };
}

export class PostgresAudienceScopeRepository implements AudienceScopeRepository {
  constructor(private readonly repository: PostgresRepository) {}

  private async transaction<T>(
    workspaceId: string | null,
    work: (client: PoolClient) => Promise<T>,
  ) {
    const client = await this.repository.pool.connect();
    try {
      await client.query("BEGIN");
      if (workspaceId)
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
      else await client.query("SELECT set_config('app.system_access', 'on', true)");
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

  async get(workspaceId: string, scopeId: string) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        "SELECT * FROM audience_scopes WHERE workspace_id = $1 AND id = $2",
        [workspaceId, scopeId],
      );
      return result.rows[0] ? mapScope(result.rows[0]) : null;
    });
  }

  async activatePresentation(input: {
    workspaceId: string;
    sessionId: string;
    idempotencyKey: string;
    now: Date;
  }) {
    try {
      return await this.transaction(input.workspaceId, async (client) => {
        const accepted = await client.query(
          "SELECT * FROM audience_scopes WHERE workspace_id = $1 AND (id = $2 OR creation_idempotency_key = $3)",
          [input.workspaceId, input.sessionId, input.idempotencyKey],
        );
        if (
          accepted.rows.some(
            (row) =>
              row.creation_idempotency_key === input.idempotencyKey && row.id !== input.sessionId,
          )
        ) {
          throw new AudienceScopeStoreError(
            "CONFLICT",
            "This idempotency key was used for another audience scope",
          );
        }
        const acceptedScope = accepted.rows.find((row) => row.id === input.sessionId);
        if (acceptedScope) return { scope: mapScope(acceptedScope), created: false };
        // Follow the parent repository's workspace -> session lock order during account deletion.
        const workspace = await client.query(
          "SELECT id FROM workspaces WHERE id = $1 AND deletion_started_at IS NULL FOR SHARE",
          [input.workspaceId],
        );
        if (!workspace.rows[0]) throw new WorkspaceDeletionInProgressError(input.workspaceId);
        // Serialize lifecycle and activation on the existing Presentation row, not a new code directory.
        const parent = await client.query(
          "SELECT * FROM presentation_live_sessions WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
          [input.workspaceId, input.sessionId],
        );
        const session = parent.rows[0];
        if (!session) throw new AudienceScopeStoreError("NOT_FOUND", "Presentation not found");
        const receipt = await client.query(
          "SELECT id FROM audience_scopes WHERE workspace_id = $1 AND creation_idempotency_key = $2",
          [input.workspaceId, input.idempotencyKey],
        );
        if (receipt.rows[0] && receipt.rows[0].id !== input.sessionId)
          throw new AudienceScopeStoreError(
            "CONFLICT",
            "This idempotency key was used for another audience scope",
          );
        const existing = await client.query(
          "SELECT * FROM audience_scopes WHERE workspace_id = $1 AND id = $2",
          [input.workspaceId, input.sessionId],
        );
        if (existing.rows[0]) return { scope: mapScope(existing.rows[0]), created: false };
        if (
          session.status !== "active" ||
          new Date(session.live_expires_at) <= input.now ||
          new Date(session.retention_expires_at) <= input.now
        ) {
          throw new AudienceScopeStoreError(
            "ROOM_CLOSED",
            "This Presentation is closed; create a new live room",
          );
        }
        const result = await client.query(
          `INSERT INTO audience_scopes
          (id, workspace_id, kind, identity_policy, creation_idempotency_key, created_at, expires_at)
          VALUES ($1, $2, 'presentation', 'facilitator_visible_alias', $3, $4, $5) RETURNING *`,
          [
            input.sessionId,
            input.workspaceId,
            input.idempotencyKey,
            input.now,
            session.retention_expires_at,
          ],
        );
        const scope = mapScope(result.rows[0]!);
        const event = activationEvent(scope);
        await client.query(
          `INSERT INTO scoped_audience_outbox
          (event_id, workspace_id, scope_id, audience_seq, schema_version, event_type, payload, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            event.eventId,
            scope.workspaceId,
            scope.id,
            event.audienceSeq,
            event.schemaVersion,
            event.type,
            event.payload,
            input.now,
          ],
        );
        return { scope, created: true };
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new AudienceScopeStoreError(
          "CONFLICT",
          "This idempotency key was used for another audience scope",
        );
      throw error;
    }
  }

  async claimOutbox(now: Date, leaseUntil: Date) {
    return this.transaction(null, async (client) => {
      const result = await client.query(
        `WITH candidate AS (
        SELECT event.event_id FROM scoped_audience_outbox event
        JOIN audience_scopes scope ON scope.id = event.scope_id AND scope.workspace_id = event.workspace_id
        WHERE event.published_at IS NULL AND (event.lease_until IS NULL OR event.lease_until <= $1)
          AND scope.expires_at > $1
        ORDER BY event.created_at, event.event_id FOR UPDATE OF event SKIP LOCKED LIMIT 1
      ) UPDATE scoped_audience_outbox event SET lease_token = $2, lease_until = $3
        FROM candidate WHERE event.event_id = candidate.event_id RETURNING event.*`,
        [now, randomUUID(), leaseUntil],
      );
      return result.rows[0] ? mapOutbox(result.rows[0]) : null;
    });
  }

  async completeOutbox(workspaceId: string, eventId: string, leaseToken: string, now: Date) {
    return this.transaction(workspaceId, async (client) => {
      const result = await client.query(
        `UPDATE scoped_audience_outbox SET published_at = $4, lease_token = NULL, lease_until = NULL
        WHERE workspace_id = $1 AND event_id = $2 AND lease_token = $3 AND lease_until > $4 AND published_at IS NULL`,
        [workspaceId, eventId, leaseToken, now],
      );
      return result.rowCount === 1;
    });
  }
}

export function createAudienceScopeRepository(repository: Repository): AudienceScopeRepository {
  if (repository instanceof PostgresRepository)
    return new PostgresAudienceScopeRepository(repository);
  if (repository instanceof MemoryRepository)
    return repository.getOrCreateLifecycleExtension(
      "audience-scopes",
      () =>
        new MemoryAudienceScopeRepository(
          createPresentationSessionRepository(repository),
          repository,
        ),
    );
  throw new Error("Audience scopes require a supported lifecycle-aware repository");
}
