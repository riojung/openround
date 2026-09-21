import Link from "next/link";
import styles from "./home.module.css";

export function HomeFirstRunActions({
  canEdit,
  createHref,
  guideAvailable,
}: {
  canEdit: boolean;
  createHref: string;
  guideAvailable: boolean;
}) {
  if (!canEdit && !guideAvailable) return null;

  return (
    <div className={styles.onboardingActions}>
      {canEdit ? (
        <Link className="button" href={createHref}>
          Create your first artifact
        </Link>
      ) : null}
      {guideAvailable ? (
        <Link className="button-quiet" href="/help#quick-start">
          Watch the 1-minute quick start
        </Link>
      ) : null}
    </div>
  );
}
