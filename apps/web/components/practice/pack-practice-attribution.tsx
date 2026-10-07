import Link from "next/link";
import type { RecoveryPackPracticeSource } from "@openround/contracts";

/** Render only frozen source identity; never fetch a Pack or expose its checkpoint contents. */
export function PackPracticeAttribution({
  source,
}: {
  source?: RecoveryPackPracticeSource | null;
}) {
  return source ? (
    <p lang="en-CA">
      {source.role === "full_sequence"
        ? "Recovery Pack full sequence"
        : "Recovery Pack delayed probe"}
      : <span lang="">{source.packTitle}</span> · published version {source.packVersion}.{" "}
      <Link href="/recovery-packs">Open Recovery Pack library</Link>
    </p>
  ) : null;
}
