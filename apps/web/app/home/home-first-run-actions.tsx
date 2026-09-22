import Link from "next/link";
import { useLocale } from "../../components/locale-provider";
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
  const { t } = useLocale();
  if (!canEdit && !guideAvailable) return null;

  return (
    <div className={styles.onboardingActions}>
      {canEdit ? (
        <Link className="button" href={createHref}>
          {t("pages.home.firstRun.create")}
        </Link>
      ) : null}
      {guideAvailable ? (
        <Link className="button-quiet" href="/help#quick-start">
          {t("pages.home.firstRun.watch")}
        </Link>
      ) : null}
    </div>
  );
}
