import type { RecoveryPackContent } from "@openround/contracts";
import type { CreatedPractice, PracticeTimeMode } from "./practice-assignment";

export interface PublishedPracticePack {
  id: string;
  packId: string;
  version: number;
  content: RecoveryPackContent;
  publishedAt: string;
}

export interface PackPracticeAssignmentInput {
  mode?: PackPracticeMode;
  sourcePackVersionId: string;
  mutationId: string;
  accessSeed: string;
  title?: string;
  timeMode: PracticeTimeMode;
  opensAt?: string;
  closesAt: string;
  personalLabels: string[];
}

export type PackPracticeMode = "delayed_probe" | "full_sequence";

export function packPracticeAssignmentHref(
  packId: string,
  versionId: string,
  mode: PackPracticeMode = "delayed_probe",
) {
  return `/recovery-packs/${encodeURIComponent(packId)}/assign?version=${encodeURIComponent(versionId)}${mode === "full_sequence" ? "&mode=full_sequence" : ""}`;
}

export function packPracticeUnavailableReason({
  version,
  recoveryPacksEnabled,
  practiceAssignmentsEnabled,
  canEdit,
  followups,
  mode = "delayed_probe",
}: {
  version: PublishedPracticePack | null;
  recoveryPacksEnabled: boolean;
  practiceAssignmentsEnabled: boolean;
  canEdit: boolean;
  followups: boolean;
  mode?: PackPracticeMode;
}) {
  if (!version)
    return mode === "full_sequence"
      ? "Publish a Recovery Pack version before assigning its sequence."
      : "Publish a Recovery Pack version before assigning its delayed probe.";
  if (mode === "delayed_probe" && !version.content.delayedProbe)
    return "This published Pack has no delayed probe. Its diagnostic and recheck are not substitutes.";
  if (!recoveryPacksEnabled || !practiceAssignmentsEnabled)
    return "New Pack practice assignments are paused for this workspace. Existing practice remains readable.";
  if (!canEdit) return "An owner or editor must create the practice assignment.";
  if (!followups) return "Creating Recovery Pack practice assignments requires Pro.";
  return null;
}

/** Generate only on explicit submit. Never put this seed in a URL, storage, or rendered state. */
export function packPracticeAccessSeed() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function packPracticeDates({
  opensLater,
  opensAt,
  closesAt,
  maxClosesAt,
  now = new Date(),
}: {
  opensLater: boolean;
  opensAt: string;
  closesAt: string;
  maxClosesAt: string;
  now?: Date;
}) {
  const opening = opensLater ? new Date(opensAt) : now;
  const closing = new Date(closesAt);
  const limit = new Date(maxClosesAt);
  if (
    !Number.isFinite(opening.getTime()) ||
    !Number.isFinite(closing.getTime()) ||
    !Number.isFinite(limit.getTime()) ||
    opening < now ||
    closing <= opening ||
    closing > limit
  ) {
    throw new Error(
      "Choose an opening and later closing time within the practice retention window.",
    );
  }
  return {
    ...(opensLater ? { opensAt: opening.toISOString() } : {}),
    closesAt: closing.toISOString(),
  };
}

export interface PackPracticeCreationState {
  busy: boolean;
  pending: boolean;
  created: CreatedPractice | null;
}

/** Retain a private serialized request, not just its ID, until an acknowledgement settles it. */
export function createPackPracticeCreation({
  execute,
  onState,
}: {
  execute: (body: string) => Promise<CreatedPractice>;
  onState: (state: PackPracticeCreationState) => void;
}) {
  let body: string | null = null;
  let state: PackPracticeCreationState = { busy: false, pending: false, created: null };
  const publish = (next: PackPracticeCreationState) => {
    state = next;
    onState(next);
  };
  async function attempt() {
    if (!body || state.busy) return;
    publish({ busy: true, pending: true, created: null });
    try {
      const created = await execute(body);
      body = null;
      publish({ busy: false, pending: false, created });
      return created;
    } catch (error) {
      const { status } = (error ?? {}) as { status?: number };
      // A definitive validation/source conflict requires a fresh explicit review. Pauses,
      // transport errors, and rate limits never replace an unresolved receipt identity.
      if (status === 400 || status === 409 || status === 422) body = null;
      publish({ busy: false, pending: body !== null, created: null });
      throw error;
    }
  }
  return {
    state: () => state,
    run(input: () => PackPracticeAssignmentInput) {
      if (state.busy || state.pending || state.created) return Promise.resolve(undefined);
      body = JSON.stringify(input());
      return attempt();
    },
    retry() {
      return attempt();
    },
  };
}
