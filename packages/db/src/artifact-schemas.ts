import {
  PresentationContentSchema,
  PresentationDraftSchema,
  QuizContentSchema,
  QuizDraftSchema,
  RecoveryPackContentSchema,
  RecoveryPackDraftSchema,
  migratePresentationV1,
  type PresentationContent,
  type PresentationDraft,
  type QuizDraft,
  type RecoveryPackContent,
  type RecoveryPackDraft,
} from "@openround/contracts";

export const ROUND_DRAFT_SCHEMA_VERSION = 1;
export const ROUND_CONTENT_SCHEMA_VERSION = 1;
export const PRESENTATION_DRAFT_SCHEMA_VERSION = 2;
export const PRESENTATION_CONTENT_SCHEMA_VERSION = 2;
export const RECOVERY_PACK_DRAFT_SCHEMA_VERSION = 1;
export const RECOVERY_PACK_CONTENT_SCHEMA_VERSION = 1;

export type PersistedArtifactType = "round" | "presentation" | "recovery_pack";
export type PersistedArtifactDocument = "draft" | "content";

/**
 * Raised before parsing when persisted JSON declares a version for which this process has no
 * deterministic upcaster. Keeping this distinct from contract validation failures lets callers
 * distinguish a deploy-order problem from corrupt persisted data.
 */
export class UnsupportedArtifactSchemaVersionError extends Error {
  readonly code = "UNSUPPORTED_ARTIFACT_SCHEMA_VERSION";

  constructor(
    public readonly artifactType: PersistedArtifactType,
    public readonly document: PersistedArtifactDocument,
    public readonly schemaVersion: unknown,
    public readonly supportedVersions: readonly number[],
  ) {
    super(
      `Unsupported ${artifactType} ${document} schema version ${String(schemaVersion)}; supported versions: ${supportedVersions.join(", ")}`,
    );
    this.name = "UnsupportedArtifactSchemaVersionError";
  }
}

type Upcaster<T> = (value: unknown) => T;

function parseVersioned<T>(
  artifactType: PersistedArtifactType,
  document: PersistedArtifactDocument,
  value: unknown,
  schemaVersion: unknown,
  upcasters: ReadonlyMap<number, Upcaster<T>>,
): T {
  // Version columns were introduced after the original tables. Treat an absent in-memory value as
  // v1, matching the database migration defaults, but never silently guess for another value.
  const version = schemaVersion == null ? 1 : schemaVersion;
  const upcaster =
    typeof version === "number" && Number.isInteger(version) ? upcasters.get(version) : undefined;
  if (!upcaster) {
    throw new UnsupportedArtifactSchemaVersionError(artifactType, document, schemaVersion, [
      ...upcasters.keys(),
    ]);
  }
  return upcaster(value);
}

const roundDraftUpcasters = new Map<number, Upcaster<QuizDraft>>([
  [ROUND_DRAFT_SCHEMA_VERSION, (value) => QuizDraftSchema.parse(value)],
]);

const roundContentUpcasters = new Map<number, Upcaster<QuizDraft>>([
  [ROUND_CONTENT_SCHEMA_VERSION, (value) => QuizContentSchema.parse(value)],
]);

const recoveryPackDraftUpcasters = new Map<number, Upcaster<RecoveryPackDraft>>([
  [RECOVERY_PACK_DRAFT_SCHEMA_VERSION, (value) => RecoveryPackDraftSchema.parse(value)],
]);
const recoveryPackContentUpcasters = new Map<number, Upcaster<RecoveryPackContent>>([
  [RECOVERY_PACK_CONTENT_SCHEMA_VERSION, (value) => RecoveryPackContentSchema.parse(value)],
]);

const presentationDraftUpcasters = new Map<number, Upcaster<PresentationDraft>>([
  [1, (value) => PresentationDraftSchema.parse(migratePresentationV1(value))],
  [
    PRESENTATION_DRAFT_SCHEMA_VERSION,
    (value) => PresentationDraftSchema.parse(withPresentationSchemaVersion(value, 2)),
  ],
]);

const presentationContentUpcasters = new Map<number, Upcaster<PresentationContent>>([
  [1, (value) => PresentationContentSchema.parse(migratePresentationV1(value))],
  [
    PRESENTATION_CONTENT_SCHEMA_VERSION,
    (value) => PresentationContentSchema.parse(withPresentationSchemaVersion(value, 2)),
  ],
]);

function withPresentationSchemaVersion(value: unknown, version: number): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return { ...value, schemaVersion: version };
}

export function upcastRoundDraft(value: unknown, schemaVersion?: unknown): QuizDraft {
  return parseVersioned("round", "draft", value, schemaVersion, roundDraftUpcasters);
}

export function upcastRoundContent(value: unknown, schemaVersion?: unknown): QuizDraft {
  return parseVersioned("round", "content", value, schemaVersion, roundContentUpcasters);
}

export function upcastRecoveryPackDraft(
  value: unknown,
  schemaVersion?: unknown,
): RecoveryPackDraft {
  return parseVersioned("recovery_pack", "draft", value, schemaVersion, recoveryPackDraftUpcasters);
}

export function upcastRecoveryPackContent(
  value: unknown,
  schemaVersion?: unknown,
): RecoveryPackContent {
  return parseVersioned(
    "recovery_pack",
    "content",
    value,
    schemaVersion,
    recoveryPackContentUpcasters,
  );
}

export function upcastPresentationDraft(
  value: unknown,
  schemaVersion?: unknown,
): PresentationDraft {
  return parseVersioned("presentation", "draft", value, schemaVersion, presentationDraftUpcasters);
}

export function upcastPresentationContent(
  value: unknown,
  schemaVersion?: unknown,
): PresentationContent {
  return parseVersioned(
    "presentation",
    "content",
    value,
    schemaVersion,
    presentationContentUpcasters,
  );
}
