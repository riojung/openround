import Link from "next/link";
import {
  packPracticeAssignmentHref,
  packPracticeUnavailableReason,
  type PublishedPracticePack,
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
}: {
  packId: string;
  version: PublishedPracticePack | null;
  loading?: boolean;
  loadError?: string;
  recoveryPacksEnabled: boolean;
  practiceAssignmentsEnabled: boolean;
  canEdit: boolean;
  followups: boolean;
}) {
  const reason = loading
    ? "Checking the frozen published delayed probe…"
    : loadError ||
      packPracticeUnavailableReason({
        version,
        recoveryPacksEnabled,
        practiceAssignmentsEnabled,
        canEdit,
        followups,
      });
  return (
    <section aria-label="Pack delayed-probe practice">
      <h3>Standalone delayed-probe practice</h3>
      <p>
        Assign only the delayed probe from this exact published version. This is not full Pack
        recovery or a delayed recovery trail. Diagnostic and recheck checkpoints are not
        substituted.
      </p>
      {reason ? (
        <>
          <p className="muted" role={loading ? "status" : undefined}>
            {reason}
          </p>
          <button className="button-quiet" disabled type="button">
            Assign delayed-probe practice
          </button>
        </>
      ) : version ? (
        <Link className="button-quiet" href={packPracticeAssignmentHref(packId, version.id)}>
          Assign delayed-probe practice
        </Link>
      ) : null}
    </section>
  );
}
