import {
  PresentationContentSchema,
  PresentationDraftSchema,
  QuizContentSchema,
  QuizDraftSchema,
  type PresentationContent,
  type PresentationDraft,
  type QuizDraft,
} from "@openround/contracts";

export const ROUND_DRAFT_SCHEMA_VERSION = 1;
export const ROUND_CONTENT_SCHEMA_VERSION = 1;
export const PRESENTATION_DRAFT_SCHEMA_VERSION = 1;
export const PRESENTATION_CONTENT_SCHEMA_VERSION = 1;

export type PersistedArtifactType = "round" | "presentation";
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

const presentationDraftUpcasters = new Map<number, Upcaster<PresentationDraft>>([
  [
    PRESENTATION_DRAFT_SCHEMA_VERSION,
    (value) => PresentationDraftSchema.parse(withPresentationSchemaVersion(value)),
  ],
]);

const presentationContentUpcasters = new Map<number, Upcaster<PresentationContent>>([
  [
    PRESENTATION_CONTENT_SCHEMA_VERSION,
    (value) => PresentationContentSchema.parse(withPresentationSchemaVersion(value)),
  ],
]);

function withPresentationSchemaVersion(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if ("schemaVersion" in value) return value;
  return { ...value, schemaVersion: PRESENTATION_DRAFT_SCHEMA_VERSION };
}

export function upcastRoundDraft(value: unknown, schemaVersion?: unknown): QuizDraft {
  return parseVersioned("round", "draft", value, schemaVersion, roundDraftUpcasters);
}

export function upcastRoundContent(value: unknown, schemaVersion?: unknown): QuizDraft {
  return parseVersioned("round", "content", value, schemaVersion, roundContentUpcasters);
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
