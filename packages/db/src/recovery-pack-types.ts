import type {
  RecoveryPackContent,
  RecoveryPackDraft,
  RecoveryPackSourceReview,
  SourceCitation,
} from "@openround/contracts";

export interface RecoveryPackRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  draft: RecoveryPackDraft;
  draftRevision: number;
  draftSchemaVersion: number;
  currentVersionId: string | null;
  publishedDraftRevision: number | null;
  lastEditedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  sourceReview?: RecoveryPackSourceReview;
}

export interface RecoveryPackSourceProvenance {
  authoringJobId: string;
  sourceName: string;
  sourceDigest: string;
  sourceOutputHash: string;
  citationCatalog: SourceCitation[];
}

export interface RecoveryPackSourceApproval {
  workspaceId: string;
  packId: string;
  editorId: string;
  expectedDraftRevision: number;
  expectedContentHash: string;
  sourceDigest: string;
  sourceOutputHash: string;
  mutationId: string;
  now?: Date;
}

export interface RecoveryPackVersionRecord {
  id: string;
  workspaceId: string;
  packId: string;
  version: number;
  content: RecoveryPackContent;
  contentSchemaVersion?: number;
  contentHash: string;
  sourceDraftRevision: number;
  publishedAt: Date;
}

export interface RecoveryPackHistoryRecord {
  id: string;
  workspaceId: string;
  packId: string;
  revision: number;
  draft: RecoveryPackDraft;
  draftSchemaVersion: number;
  savedBy: string | null;
  mutationId: string | null;
  createdAt: Date;
}

export interface RecoveryPackDraftUpdate {
  workspaceId: string;
  packId: string;
  draft: RecoveryPackDraft;
  expectedRevision: number;
  mutationId: string;
  editorId: string;
  draftHash: string;
}

export type RecoveryPackMutationReplay = Pick<
  RecoveryPackDraftUpdate,
  "workspaceId" | "packId" | "expectedRevision" | "mutationId" | "draftHash"
>;

export interface RecoveryPackRepository {
  listRecoveryPacks(workspaceId: string): Promise<RecoveryPackRecord[]>;
  createRecoveryPack(input: RecoveryPackRecord): Promise<RecoveryPackRecord>;
  replaySourceRecoveryPack(
    workspaceId: string,
    mutationId: string,
    requestHash: string,
  ): Promise<RecoveryPackRecord | null>;
  createSourceRecoveryPack(
    input: RecoveryPackRecord,
    provenance: RecoveryPackSourceProvenance,
    mutationId: string,
    requestHash: string,
  ): Promise<RecoveryPackRecord>;
  approveRecoveryPackSource(input: RecoveryPackSourceApproval): Promise<RecoveryPackRecord>;
  getRecoveryPack(workspaceId: string, packId: string): Promise<RecoveryPackRecord | null>;
  updateRecoveryPackDraft(input: RecoveryPackDraftUpdate): Promise<RecoveryPackRecord | null>;
  replayRecoveryPackMutation(input: RecoveryPackMutationReplay): Promise<RecoveryPackRecord | null>;
  publishRecoveryPack(
    input: RecoveryPackVersionRecord,
    expectedDraftRevision: number,
  ): Promise<RecoveryPackVersionRecord>;
  getRecoveryPackVersion(
    workspaceId: string,
    versionId: string,
  ): Promise<RecoveryPackVersionRecord | null>;
  listRecoveryPackHistory(
    workspaceId: string,
    packId: string,
    limit?: number,
  ): Promise<RecoveryPackHistoryRecord[]>;
  deleteRecoveryPack(workspaceId: string, packId: string): Promise<boolean>;
}

export class RecoveryPackDraftConflictError extends Error {
  constructor(
    public readonly expectedRevision: number,
    public readonly currentRevision: number,
    public readonly currentEditorId: string | null,
  ) {
    super("The Recovery Pack was changed in another editor");
    this.name = "RecoveryPackDraftConflictError";
  }
}

export class RecoveryPackMutationConflictError extends Error {
  constructor(public readonly mutationId: string) {
    super("The Recovery Pack mutation ID was already used for another change");
    this.name = "RecoveryPackMutationConflictError";
  }
}

export class RecoveryPackNotFoundError extends Error {
  constructor() {
    super("Recovery Pack not found");
    this.name = "RecoveryPackNotFoundError";
  }
}

export class RecoveryPackMediaValidationError extends Error {
  constructor(
    message: string,
    public readonly mediaId?: string,
  ) {
    super(message);
    this.name = "RecoveryPackMediaValidationError";
  }
}

export class RecoveryPackSourceReviewConflictError extends Error {
  constructor() {
    super("The Recovery Pack content or source changed; review the current draft");
    this.name = "RecoveryPackSourceReviewConflictError";
  }
}

export class RecoveryPackSourceReviewRequiredError extends Error {
  constructor() {
    super("Approve the current Recovery Pack content and source citations before publishing");
    this.name = "RecoveryPackSourceReviewRequiredError";
  }
}

export class RecoveryPackSourceCitationValidationError extends Error {
  constructor(message = "Every Recovery Pack item must cite an original source span") {
    super(message);
    this.name = "RecoveryPackSourceCitationValidationError";
  }
}
