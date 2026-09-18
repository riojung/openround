"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "../../../../components/brand";
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

  return (
    <div className={styles.page} data-testid="rehearsal-page">
      <a className={styles.skipLink} href="#rehearsal-main">
        Skip to rehearsal
      </a>
      <header className={styles.topbar}>
        <Brand />
        <div className={styles.topbarActions}>
          <span className={styles.readOnlyBadge}>Read-only practice · synthetic learners only</span>
          <Link className={styles.quietLink} href={returnLink.href}>
            {returnLink.label}
          </Link>
        </div>
      </header>
      <main className={styles.main} id="rehearsal-main">
        {!payload && !error ? (
          <section aria-live="polite" className={styles.stateCard}>
            <span aria-hidden="true" className={styles.loadingDot} />
            <p>Preparing a private practice room…</p>
          </section>
        ) : null}
        {error ? (
          <section className={styles.stateCard}>
            <p className={styles.eyebrow}>Recovery rehearsal</p>
            <h1>We couldn’t open this Round.</h1>
            <p className={styles.error} role="alert">
              {error}
            </p>
            <Link className={styles.primaryLink} href="/dashboard">
              Back to Rounds
            </Link>
          </section>
        ) : null}
        {payload && !payload.available ? (
          <section className={styles.stateCard} data-testid="rehearsal-unavailable">
            <p className={styles.eyebrow}>Recovery rehearsal</p>
            <h1>
              {archived
                ? "Archived Rounds can’t be rehearsed."
                : "This practice lab isn’t available for your workspace."}
            </h1>
            <p>
              {archived
                ? "Restore this Round from Rounds before starting a rehearsal."
                : "Ask a workspace administrator about the UX beta, or return to the Round."}{" "}
              No synthetic room was started and no session, participant, answer, or rehearsal record
              was created.
            </p>
            <Link className={styles.primaryLink} href={returnLink.href}>
              {returnLink.label}
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
