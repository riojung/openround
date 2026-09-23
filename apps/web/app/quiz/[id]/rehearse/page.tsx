"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CreatorBrand } from "../../../../components/brand";
import { useLocale } from "../../../../components/locale-provider";
import {
  RecoveryRehearsal,
  type RecoveryRehearsalQuiz,
  type RecoveryRehearsalVersion,
} from "../../../../components/rehearsal/recovery-rehearsal";
import {
  canAccessRecoveryRehearsal,
  rehearsalReturnLink,
  type RehearsalWorkspaceRole,
} from "../../../../components/rehearsal/rehearsal-access";
import { apiFetch, humanError } from "../../../../lib/api";
import styles from "../../../../components/rehearsal/rehearsal.module.css";

export default function RehearsePage() {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [payload, setPayload] = useState<{
    quiz: RecoveryRehearsalQuiz;
    currentVersion: RecoveryRehearsalVersion | null;
    available: boolean;
    role: RehearsalWorkspaceRole;
  } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<{
        quiz: RecoveryRehearsalQuiz;
        currentVersion: RecoveryRehearsalVersion | null;
      }>(`/v1/quizzes/${id}`),
      apiFetch<{
        creator: { role: RehearsalWorkspaceRole };
        productFeatures: { recoveryRehearsal?: boolean };
      }>("/v1/auth/me"),
    ])
      .then(([result, account]) => {
        if (active) {
          setPayload({
            ...result,
            available: canAccessRecoveryRehearsal({
              role: account.creator.role,
              recoveryRehearsal: account.productFeatures.recoveryRehearsal === true,
              status: result.quiz.status,
            }),
            role: account.creator.role,
          });
        }
      })
      .catch((caught) => {
        if (!active) return;
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
    return () => {
      active = false;
    };
  }, [id, router]);

  const returnLink = payload
    ? rehearsalReturnLink({ quizId: id, role: payload.role, status: payload.quiz.status })
    : { href: "/dashboard", label: "Back to Rounds" };
  const archived = payload?.quiz.status === "archived";
  const returnLabel =
    returnLink.label === "Back to Round preview"
      ? t("reportRound.rehearsal.backToPreview")
      : returnLink.label === "Back to editor"
        ? t("delivery.presentation.backToEditor")
        : t("reportRound.rehearsal.backToRounds");

  return (
    <div className={styles.page} data-testid="rehearsal-page">
      <a className={styles.skipLink} href="#rehearsal-main">
        {t("reportRound.rehearsal.skip")}
      </a>
      <header className={styles.topbar}>
        <CreatorBrand />
        <div className={styles.topbarActions}>
          <span className={styles.readOnlyBadge}>{t("reportRound.rehearsal.readOnlyBadge")}</span>
          <Link className={styles.quietLink} href={returnLink.href}>
            {returnLabel}
          </Link>
        </div>
      </header>
      <main className={styles.main} id="rehearsal-main">
        {!payload && !error ? (
          <section aria-live="polite" className={styles.stateCard}>
            <span aria-hidden="true" className={styles.loadingDot} />
            <p>{t("reportRound.rehearsal.preparing")}</p>
          </section>
        ) : null}
        {error ? (
          <section className={styles.stateCard}>
            <p className={styles.eyebrow}>{t("reportRound.rehearsal.eyebrow")}</p>
            <h1>{t("reportRound.rehearsal.openError")}</h1>
            <p className={styles.error} lang="en-CA" role="alert">
              {error}
            </p>
            <Link className={styles.primaryLink} href="/dashboard">
              {t("reportRound.rehearsal.backToRounds")}
            </Link>
          </section>
        ) : null}
        {payload && !payload.available ? (
          <section className={styles.stateCard} data-testid="rehearsal-unavailable">
            <p className={styles.eyebrow}>{t("reportRound.rehearsal.eyebrow")}</p>
            <h1>
              {archived
                ? t("reportRound.rehearsal.archivedTitle")
                : t("reportRound.rehearsal.unavailableTitle")}
            </h1>
            <p>
              {archived
                ? t("reportRound.rehearsal.archivedDescription")
                : t("reportRound.rehearsal.unavailableDescription")}{" "}
              {t("reportRound.rehearsal.noRecordCreated")}
            </p>
            <Link className={styles.primaryLink} href={returnLink.href}>
              {returnLabel}
            </Link>
          </section>
        ) : null}
        {payload?.available ? (
          <RecoveryRehearsal
            canEdit={payload.role !== "viewer"}
            currentVersion={payload.currentVersion}
            quiz={payload.quiz}
          />
        ) : null}
      </main>
    </div>
  );
}
