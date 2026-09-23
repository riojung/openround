"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CreatorBrand } from "../../../../components/brand";
import { useLocale } from "../../../../components/locale-provider";
import { WorkspaceProvider } from "../../../../components/workspace/workspace-provider";
import { WorkspaceFeatureGate } from "../../../../components/workspace/workspace-shell";
import styles from "../../../../components/presentation-live/presentation-live.module.css";
import { apiFetch, humanError } from "../../../../lib/api";

interface PresentationReport {
  sessionId: string;
  title: string;
  status: "active" | "finished";
  participantCount: number;
  responseCount: number;
  evidenceNote: string;
  evidence: Array<
    | {
        blockId: string;
        blockIndex: number;
        kind: "content";
        title: string;
        assessmentStatus: "not_assessed";
      }
    | {
        blockId: string;
        blockIndex: number;
        kind: "question";
        prompt: string;
        questionTypeLabel: string;
        respondents: number;
        correct: number | null;
        accuracyPercent: number | null;
        totalScore: number;
        averageResponseMs: number | null;
      }
  >;
  leaderboard: Array<{
    id: string;
    nickname: string;
    score: number;
    rank: number;
  }>;
  recovery: Array<{
    sourceQuestionId: string;
    recheckQuestionId: string;
    eligible: number;
    recovered: number;
    recoveryPercent: number | null;
  }>;
  timeline: Array<{
    sequence: number;
    type: string;
    blockIndex: number | null;
    occurredAt: string;
  }>;
}

function PresentationReportContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { locale, t } = useLocale();
  const [report, setReport] = useState<PresentationReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiFetch<{ report: PresentationReport }>(`/v1/presentation-sessions/${id}/report`)
      .then(({ report: loaded }) => setReport(loaded))
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
  }, [id, router]);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <CreatorBrand />
        <div className="button-row">
          <Link href="/results">{t("live.presentationReport.allResults")}</Link>
          <Link href={`/presentation-session/${id}/host`}>
            {t("live.presentationReport.hostView")}
          </Link>
        </div>
      </header>
      <div className={`${styles.stage} ${styles.report}`}>
        {error ? (
          <p className="error" lang="en-CA" role="alert">
            {error}
          </p>
        ) : null}
        {!report ? (
          <section className={styles.reportCard}>{t("live.presentationReport.loading")}</section>
        ) : (
          <>
            <section className={styles.reportCard}>
              <span className={styles.statusPill} lang="en-CA">
                {report.status} report
              </span>
              <h1 lang="">{report.title}</h1>
              <p lang="en-CA">{report.evidenceNote}</p>
              <div className={styles.metricRow}>
                <div className={styles.metric}>
                  <strong>{report.participantCount.toLocaleString(locale)}</strong>
                  <span>{t("live.common.participants")}</span>
                </div>
                <div className={styles.metric}>
                  <strong>{report.responseCount.toLocaleString(locale)}</strong>
                  <span>{t("live.common.responses")}</span>
                </div>
              </div>
            </section>
            <section
              className={styles.reportGrid}
              aria-label={t("live.presentationReport.blockEvidence")}
            >
              {report.evidence.map((block) => (
                <article className={styles.reportCard} key={block.blockId}>
                  <span className={styles.statusPill}>
                    {t("live.presentationReport.blockLabel", {
                      number: (block.blockIndex + 1).toLocaleString(locale),
                      kind:
                        block.kind === "content"
                          ? t("live.presentationPlay.content")
                          : t("live.roundSetup.item.question"),
                    })}
                  </span>
                  <h2 lang={block.kind === "question" || block.title ? "" : undefined}>
                    {block.kind === "content"
                      ? block.title || t("live.presentationReport.contentSlide")
                      : block.prompt}
                  </h2>
                  {block.kind === "content" ? (
                    <p>
                      <strong>{t("live.presentationReport.notAssessed")}</strong>{" "}
                      {t("live.presentationReport.notAssessedDescription")}
                    </p>
                  ) : (
                    <div className={styles.metricRow}>
                      <div className={styles.metric}>
                        <strong>{block.respondents.toLocaleString(locale)}</strong>
                        <span>{t("live.presentationReport.respondents")}</span>
                      </div>
                      <div className={styles.metric}>
                        <strong>
                          {block.accuracyPercent === null
                            ? t("live.common.notScored")
                            : `${block.accuracyPercent.toLocaleString(locale)}%`}
                        </strong>
                        <span>{t("live.presentationReport.accuracy")}</span>
                      </div>
                      <div className={styles.metric}>
                        <strong lang="en-CA">{block.questionTypeLabel}</strong>
                        <span>{t("live.presentationReport.questionType")}</span>
                      </div>
                      <div className={styles.metric}>
                        <strong>
                          {block.averageResponseMs === null
                            ? "—"
                            : `${(block.averageResponseMs / 1_000).toLocaleString(locale, {
                                maximumFractionDigits: 1,
                                minimumFractionDigits: 1,
                              })}s`}
                        </strong>
                        <span>{t("live.presentationReport.averageResponse")}</span>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </section>
            {report.leaderboard.length ? (
              <section className={styles.reportCard}>
                <h2>{t("live.common.leaderboard")}</h2>
                <ol className={styles.leaderboard}>
                  {report.leaderboard.map((participant) => (
                    <li key={participant.id}>
                      <span lang={locale}>{participant.rank.toLocaleString(locale)}.</span>{" "}
                      <span lang="">{participant.nickname}</span>
                      <strong>
                        {t("live.common.points", {
                          count: participant.score.toLocaleString(locale),
                        })}
                      </strong>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {report.recovery.length ? (
              <section className={styles.reportCard}>
                <h2>{t("live.presentationReport.recoveryEvidence")}</h2>
                {report.recovery.map((item) => (
                  <p key={`${item.sourceQuestionId}:${item.recheckQuestionId}`}>
                    {t("live.presentationReport.recovered", {
                      recovered: item.recovered.toLocaleString(locale),
                      eligible: item.eligible.toLocaleString(locale),
                      percent:
                        item.recoveryPercent === null
                          ? ""
                          : ` (${item.recoveryPercent.toLocaleString(locale)}%)`,
                    })}
                  </p>
                ))}
              </section>
            ) : null}
            <section className={styles.reportCard}>
              <h2>{t("live.presentationReport.facilitationTimeline")}</h2>
              <ol className={styles.timeline}>
                {report.timeline.map((event) => (
                  <li key={event.sequence}>
                    <strong>{event.sequence.toLocaleString(locale)}</strong>
                    <span lang="en-CA">{event.type.replaceAll(".", " ")}</span>
                    <time dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleTimeString(locale)}
                    </time>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function PresentationReportPage() {
  return (
    <WorkspaceProvider>
      <WorkspaceFeatureGate feature="presentations">
        <PresentationReportContent />
      </WorkspaceFeatureGate>
    </WorkspaceProvider>
  );
}
