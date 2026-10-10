import type { ScopedAudienceEvent } from "@openround/contracts";

export interface AudienceScopeRecord {
  id: string;
  workspaceId: string;
  kind: "presentation";
  identityPolicy: "facilitator_visible_alias";
  schemaVersion: 1;
  audienceSeq: number;
  creationIdempotencyKey: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface ScopedAudienceOutboxRecord {
  workspaceId: string;
  event: ScopedAudienceEvent;
  leaseToken: string | null;
  leaseUntil: Date | null;
  publishedAt: Date | null;
}

export class AudienceScopeStoreError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "CONFLICT" | "ROOM_CLOSED",
    message: string,
  ) {
    super(message);
  }
}

export interface AudienceScopeRepository {
  get(workspaceId: string, scopeId: string): Promise<AudienceScopeRecord | null>;
  /** Scope and first audience event commit together; retries never advance a game sequence. */
  activatePresentation(input: {
    workspaceId: string;
    sessionId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<{ scope: AudienceScopeRecord; created: boolean }>;
  claimOutbox(now: Date, leaseUntil: Date): Promise<ScopedAudienceOutboxRecord | null>;
  completeOutbox(
    workspaceId: string,
    eventId: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean>;
}
