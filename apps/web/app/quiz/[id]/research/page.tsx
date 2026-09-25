"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { WorkspaceProductFeatures } from "@openround/contracts";
import { CreatorBrand } from "../../../../components/brand";
import {
  ResearchPrototypeLab,
  type ResearchPrototypeQuiz,
  type ResearchPrototypeVersion,
} from "../../../../components/rehearsal/research-prototype-lab";
import {
  canAccessResearchPrototypeLab,
  rehearsalReturnLink,
  type RehearsalWorkspaceRole,
} from "../../../../components/rehearsal/rehearsal-access";
import styles from "../../../../components/rehearsal/research-prototype-lab.module.css";
import { apiFetch, humanError } from "../../../../lib/api";

interface ResearchPagePayload {
  quiz: ResearchPrototypeQuiz;
  currentVersion: ResearchPrototypeVersion | null;
  role: RehearsalWorkspaceRole;
  available: boolean;
  productFeatures: Pick<WorkspaceProductFeatures, "workspaceShell">;
}

export default function ResearchPrototypePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [payload, setPayload] = useState<ResearchPagePayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<{
        quiz: ResearchPrototypeQuiz;
        currentVersion: ResearchPrototypeVersion | null;
      }>(`/v1/quizzes/${id}`),
      apiFetch<{
        creator: { role: RehearsalWorkspaceRole };
        productFeatures: Pick<WorkspaceProductFeatures, "recoveryRehearsal" | "workspaceShell">;
      }>("/v1/auth/me"),
    ])
      .then(([round, account]) => {
        if (!active) return;
        setPayload({
          ...round,
          role: account.creator.role,
          available: canAccessResearchPrototypeLab({
            role: account.creator.role,
            recoveryRehearsal: account.productFeatures.recoveryRehearsal === true,
            status: round.quiz.status,
          }),
          productFeatures: account.productFeatures,
        });
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

  return (
    <div className={styles.page} data-testid="research-prototype-page" lang="en-CA">
      <a className={styles.skipLink} href="#prototype-main">
        Skip to prototype lab
      </a>
      <header className={styles.topbar}>
        <CreatorBrand productFeatures={payload?.productFeatures} />
        <div className={styles.topbarActions}>
          <span className={styles.prototypeBadge}>Allowlisted prototype</span>
          <Link className={styles.quietLink} href={returnLink.href}>
            {returnLink.label}
          </Link>
        </div>
      </header>
      <main className={styles.main} id="prototype-main">
        {!payload && !error ? (
          <section aria-live="polite" className={styles.stateCard}>
            <span aria-hidden="true" className={styles.loadingDot} />
            <h1>Preparing the research prototype lab</h1>
            <p>Loading the read-only Round snapshot and workspace rollout status.</p>
          </section>
        ) : null}

        {error ? (
          <section className={styles.stateCard}>
            <p className={styles.eyebrow}>Phase 0 prototype</p>
            <h1>The research lab could not be opened</h1>
            <p className={styles.error} lang="en-CA" role="alert">
              {error}
            </p>
            <Link className={styles.primaryLink} href="/dashboard">
              Back to Rounds
            </Link>
          </section>
        ) : null}

        {payload && !payload.available ? (
          <section className={styles.stateCard} data-testid="research-prototype-unavailable">
            <p className={styles.eyebrow}>Phase 0 prototype</p>
            <h1>
              {payload.quiz.status === "archived"
                ? "Archived Rounds cannot be evaluated"
                : "The research prototype lab is unavailable"}
            </h1>
            <p>
              This browser-only lab is limited to workspaces in the existing Recovery Rehearsal
              rollout. No research record was created.
            </p>
            <Link className={styles.primaryLink} href={returnLink.href}>
              {returnLink.label}
            </Link>
          </section>
        ) : null}

        {payload?.available ? (
          <ResearchPrototypeLab currentVersion={payload.currentVersion} quiz={payload.quiz} />
        ) : null}
      </main>
    </div>
  );
}
