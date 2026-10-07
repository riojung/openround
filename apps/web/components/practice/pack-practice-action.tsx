import Link from "next/link";
import {
  packPracticeAssignmentHref,
  packPracticeUnavailableReason,
  type PublishedPracticePack,
  type PackPracticeMode,
} from "../../lib/recovery-pack-practice";

export function PackPracticeAction({
  packId,
  version,
  loading = false,
  loadError = "",
  recoveryPacksEnabled,
  practiceAssignmentsEnabled,
  canEdit,
  followups,
  mode = "delayed_probe",
}: {
  packId: string;
  version: PublishedPracticePack | null;
  loading?: boolean;
  loadError?: string;
  recoveryPacksEnabled: boolean;
  practiceAssignmentsEnabled: boolean;
  canEdit: boolean;
  followups: boolean;
  mode?: PackPracticeMode;
}) {
  const reason = loading
    ? mode === "full_sequence"
      ? "Checking the frozen published sequence…"
      : "Checking the frozen published delayed probe…"
    : loadError ||
      packPracticeUnavailableReason({
        version,
        recoveryPacksEnabled,
        practiceAssignmentsEnabled,
        canEdit,
        followups,
        mode,
      });
  return (
    <section
      aria-label={
        mode === "full_sequence" ? "Full-sequence Pack practice" : "Pack delayed-probe practice"
      }
    >
      <h3>
        {mode === "full_sequence"
          ? "Full-sequence Recovery Pack practice"
          : "Standalone delayed-probe practice"}
      </h3>
      <p>
        {mode === "full_sequence" ? (
          "Assign the diagnostic, all frozen intervention cards, and linked recheck from this exact published version. The optional delayed probe is not included; this is not a delayed recovery trail."
        ) : (
          <>
            Assign only the delayed probe from this exact published version. This is not full Pack
            recovery or a delayed recovery trail. Diagnostic and recheck checkpoints are not
            substituted.
          </>
        )}
      </p>
      {reason ? (
        <>
          <p className="muted" role={loading ? "status" : undefined}>
            {reason}
          </p>
          <button className="button-quiet" disabled type="button">
            {mode === "full_sequence"
              ? "Assign full-sequence practice"
              : "Assign delayed-probe practice"}
          </button>
        </>
      ) : version ? (
        <Link className="button-quiet" href={packPracticeAssignmentHref(packId, version.id, mode)}>
          {mode === "full_sequence"
            ? "Assign full-sequence practice"
            : "Assign delayed-probe practice"}
        </Link>
      ) : null}
    </section>
  );
}
