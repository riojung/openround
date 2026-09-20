"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "../../../../components/brand";
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
        <Brand />
        <div className="button-row">
          <Link href="/results">All results</Link>
          <Link href={`/presentation-session/${id}/host`}>Host view</Link>
        </div>
      </header>
      <div className={`${styles.stage} ${styles.report}`}>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {!report ? (
          <section className={styles.reportCard}>Loading Presentation report…</section>
        ) : (
          <>
            <section className={styles.reportCard}>
              <span className={styles.statusPill}>{report.status} report</span>
              <h1>{report.title}</h1>
              <p>{report.evidenceNote}</p>
              <div className={styles.metricRow}>
                <div className={styles.metric}>
                  <strong>{report.participantCount}</strong>
                  <span>Participants</span>
                </div>
                <div className={styles.metric}>
                  <strong>{report.responseCount}</strong>
                  <span>Responses</span>
                </div>
              </div>
            </section>
            <section className={styles.reportGrid} aria-label="Block evidence">
              {report.evidence.map((block) => (
                <article className={styles.reportCard} key={block.blockId}>
                  <span className={styles.statusPill}>
                    Block {block.blockIndex + 1} · {block.kind}
                  </span>
                  <h2>
                    {block.kind === "content" ? block.title || "Content slide" : block.prompt}
                  </h2>
                  {block.kind === "content" ? (
                    <p>
                      <strong>Not assessed.</strong> Presentation exposure is not treated as
                      learning evidence.
                    </p>
                  ) : (
                    <div className={styles.metricRow}>
                      <div className={styles.metric}>
                        <strong>{block.respondents}</strong>
                        <span>Respondents</span>
                      </div>
                      <div className={styles.metric}>
                        <strong>
                          {block.accuracyPercent === null
                            ? "Not scored"
                            : `${block.accuracyPercent}%`}
                        </strong>
                        <span>Accuracy</span>
                      </div>
                      <div className={styles.metric}>
                        <strong>{block.questionTypeLabel}</strong>
                        <span>Question type</span>
                      </div>
                      <div className={styles.metric}>
                        <strong>
                          {block.averageResponseMs === null
                            ? "—"
                            : `${(block.averageResponseMs / 1_000).toFixed(1)}s`}
                        </strong>
                        <span>Average response</span>
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </section>
            {report.leaderboard.length ? (
              <section className={styles.reportCard}>
                <h2>Leaderboard</h2>
                <ol className={styles.leaderboard}>
                  {report.leaderboard.map((participant) => (
                    <li key={participant.id}>
                      <span>
                        {participant.rank}. {participant.nickname}
                      </span>
                      <strong>{participant.score.toLocaleString()} points</strong>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            {report.recovery.length ? (
              <section className={styles.reportCard}>
                <h2>Recovery Loop evidence</h2>
                {report.recovery.map((item) => (
                  <p key={`${item.sourceQuestionId}:${item.recheckQuestionId}`}>
                    {item.recovered} of {item.eligible} initially incorrect participants recovered
                    {item.recoveryPercent === null ? "." : ` (${item.recoveryPercent}%).`}
                  </p>
                ))}
              </section>
            ) : null}
            <section className={styles.reportCard}>
              <h2>Facilitation timeline</h2>
              <ol className={styles.timeline}>
                {report.timeline.map((event) => (
                  <li key={event.sequence}>
                    <strong>{event.sequence}</strong>
                    <span>{event.type.replaceAll(".", " ")}</span>
                    <time dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleTimeString()}
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
