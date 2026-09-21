"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "../../../../components/brand";
import { PresentationMedia } from "../../../../components/presentation-live/presentation-media";
import { WorkspaceProvider } from "../../../../components/workspace/workspace-provider";
import { WorkspaceFeatureGate } from "../../../../components/workspace/workspace-shell";
import { recordAuthoringEvent } from "../../../../components/workspace/product-events";
import styles from "../../../../components/presentation-live/presentation-live.module.css";
import { apiFetch, humanError } from "../../../../lib/api";
import {
  shouldApplyLiveSnapshot,
  type LiveSnapshotFence,
} from "../../../../lib/live-snapshot-fence";

interface ContentBlock {
  id: string;
  kind: "content";
  layout: string;
  title: string;
  body: string;
  speakerNotes: string;
  mediaId: string | null;
  mediaAlt: string | null;
}

interface QuestionBlock {
  id: string;
  kind: "question";
  question: {
    id: string;
    type: string;
    prompt: string;
    explanation: string;
    mediaId: string | null;
    mediaAlt: string | null;
    choices?: Array<{ id: string; label: string; isCorrect: boolean }>;
    min?: number;
    max?: number;
    correctValue?: string;
    delivery?: "main" | "recheck";
    linkedRecheckQuestionId?: string | null;
  };
}

interface HostSnapshot {
  id: string;
  title: string;
  code: string;
  status: "active" | "finished";
  phase: "lobby" | "content" | "question_open" | "question_reveal" | "intervention" | "finished";
  currentBlockIndex: number;
  blockCount: number;
  revision: number;
  currentBlock: ContentBlock | QuestionBlock | null;
  participantCount: number;
  responseCount: number;
  questionClosesAt: string | null;
  acceptingResponses: boolean;
  participants: Array<{ id: string; nickname: string; score: number; rank: number }>;
  leaderboard: Array<{ id: string; nickname: string; score: number; rank: number }>;
}

function advanceLabel(snapshot: HostSnapshot) {
  if (snapshot.phase === "lobby") return "Start Presentation";
  if (snapshot.phase === "question_open") return "Reveal and close question";
  if (
    snapshot.phase === "question_reveal" &&
    snapshot.currentBlock?.kind === "question" &&
    snapshot.currentBlock.question.delivery !== "recheck" &&
    snapshot.currentBlock.question.linkedRecheckQuestionId
  ) {
    return "Present intervention";
  }
  if (snapshot.phase === "intervention") return "Continue to recheck";
  if (snapshot.currentBlockIndex >= snapshot.blockCount - 1) return "Finish Presentation";
  return "Next block";
}

function PresentationHostContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<HostSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const connectionState = useRef({ hadSuccess: false, failedAfterSuccess: false, tracked: false });
  const requestSequence = useRef(0);
  const appliedSnapshot = useRef<LiveSnapshotFence>({ requestId: 0, revision: -1 });

  const applySnapshot = useCallback((incoming: HostSnapshot, requestId: number) => {
    const fence = { requestId, revision: incoming.revision };
    if (!shouldApplyLiveSnapshot(appliedSnapshot.current, fence)) return false;
    appliedSnapshot.current = fence;
    setSnapshot(incoming);
    return true;
  }, []);

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    try {
      const response = await apiFetch<{ snapshot: HostSnapshot }>(
        `/v1/presentation-sessions/${id}`,
      );
      if (!applySnapshot(response.snapshot, requestId)) return;
      if (connectionState.current.failedAfterSuccess && !connectionState.current.tracked) {
        recordAuthoringEvent("presentation_reconnected", "presentation");
        connectionState.current.tracked = true;
      }
      connectionState.current.hadSuccess = true;
      connectionState.current.failedAfterSuccess = false;
      setError("");
    } catch (caught) {
      if (requestId < appliedSnapshot.current.requestId) return;
      if (connectionState.current.hadSuccess) {
        connectionState.current.failedAfterSuccess = true;
      }
      if ((caught as { status?: number }).status === 401) router.replace("/signin");
      else setError(humanError(caught));
    }
  }, [applySnapshot, id, router]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  async function advance() {
    if (!snapshot || snapshot.phase === "finished") return;
    const requestId = ++requestSequence.current;
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch<{ snapshot: HostSnapshot }>(
        `/v1/presentation-sessions/${id}/advance`,
        {
          method: "POST",
          body: JSON.stringify({ expectedRevision: snapshot.revision }),
        },
      );
      applySnapshot(response.snapshot, requestId);
    } catch (caught) {
      setError(humanError(caught));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const block = snapshot?.currentBlock ?? null;
  const joinUrl = snapshot
    ? `${typeof window === "undefined" ? "" : window.location.origin}/presentation/join?code=${snapshot.code}`
    : "";
  const remainingSeconds = snapshot?.questionClosesAt
    ? Math.max(0, Math.ceil((new Date(snapshot.questionClosesAt).getTime() - now) / 1_000))
    : null;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Brand />
        <div className="button-row">
          <Link href="/sessions">Sessions</Link>
          {snapshot?.phase === "finished" ? (
            <Link className="button small-button" href={`/presentation-session/${id}/report`}>
              View report
            </Link>
          ) : null}
        </div>
      </header>
      <div className={styles.stage}>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {!snapshot ? (
          <section className={styles.canvas}>Loading live Presentation…</section>
        ) : (
          <div className={styles.hostGrid}>
            <section className={styles.canvas} aria-live="polite">
              <div className={styles.canvasContent}>
                {snapshot.phase === "lobby" ? (
                  <>
                    <span className={styles.statusPill}>Waiting room</span>
                    <h1>{snapshot.title}</h1>
                    <p>Participants can join now. Start when the room is ready.</p>
                  </>
                ) : null}
                {block?.kind === "content" ? (
                  <>
                    <span className={styles.statusPill}>Content slide</span>
                    <h1>{block.title}</h1>
                    <p>{block.body}</p>
                    <PresentationMedia
                      altText={block.mediaAlt}
                      mediaId={block.mediaId}
                      sessionId={id}
                    />
                  </>
                ) : null}
                {block?.kind === "question" ? (
                  <>
                    <span className={styles.statusPill}>
                      {snapshot.phase === "intervention"
                        ? "Recovery intervention"
                        : snapshot.phase === "question_reveal"
                          ? "Response review"
                          : snapshot.acceptingResponses
                            ? "Question open"
                            : "Time ended"}
                    </span>
                    {remainingSeconds !== null ? (
                      <p className={styles.timer} aria-live="off">
                        {remainingSeconds}s
                      </p>
                    ) : null}
                    <h1>{block.question.prompt}</h1>
                    <PresentationMedia
                      altText={block.question.mediaAlt}
                      mediaId={block.question.mediaId}
                      sessionId={id}
                    />
                    {block.question.choices ? (
                      <div className={styles.choiceGrid}>
                        {block.question.choices.map((choice) => (
                          <div
                            className={styles.choice}
                            data-correct={
                              snapshot.phase === "question_reveal" ||
                              snapshot.phase === "intervention"
                                ? choice.isCorrect
                                : undefined
                            }
                            key={choice.id}
                          >
                            {choice.label}
                          </div>
                        ))}
                      </div>
                    ) : block.question.type === "numeric" ? (
                      <p>Participants enter a numeric response.</p>
                    ) : (
                      <p>Participants choose a rating.</p>
                    )}
                    {(snapshot.phase === "question_reveal" || snapshot.phase === "intervention") &&
                    block.question.explanation ? (
                      <p className="notice">{block.question.explanation}</p>
                    ) : null}
                  </>
                ) : null}
                {snapshot.phase === "finished" ? (
                  <>
                    <span className={styles.statusPill}>Complete</span>
                    <h1>Presentation finished</h1>
                    <p>The report separates assessed questions from content-only slides.</p>
                    <Link className="button" href={`/presentation-session/${id}/report`}>
                      Open session report
                    </Link>
                  </>
                ) : null}
              </div>
            </section>
            <aside className={styles.sideCard}>
              <div>
                <span className={styles.statusPill}>Join code</span>
                <p className={styles.joinCode}>{snapshot.code}</p>
                <Link href={`/presentation/join?code=${snapshot.code}`}>Open participant join</Link>
              </div>
              <div className={styles.metricRow}>
                <div className={styles.metric}>
                  <strong>{snapshot.participantCount}</strong>
                  <span>Participants</span>
                </div>
                <div className={styles.metric}>
                  <strong>{snapshot.responseCount}</strong>
                  <span>Responses now</span>
                </div>
              </div>
              <p>
                Block {Math.max(snapshot.currentBlockIndex + 1, 0)} of {snapshot.blockCount}
              </p>
              {block?.kind === "content" && block.speakerNotes ? (
                <div className="notice">
                  <strong>Speaker notes</strong>
                  <p>{block.speakerNotes}</p>
                </div>
              ) : null}
              {snapshot.phase !== "finished" ? (
                <button
                  className="button full-width"
                  disabled={busy}
                  onClick={() => void advance()}
                  type="button"
                >
                  {busy ? "Updating…" : advanceLabel(snapshot)}
                </button>
              ) : null}
              <button
                className="button-quiet full-width"
                disabled={!joinUrl}
                onClick={() => void navigator.clipboard?.writeText(joinUrl)}
                type="button"
              >
                Copy join link
              </button>
              {snapshot.participants.length ? (
                <details>
                  <summary>Leaderboard · {snapshot.participants.length} joined</summary>
                  <ol className={styles.leaderboard}>
                    {snapshot.leaderboard.map((participant) => (
                      <li key={participant.id}>
                        <span>{participant.nickname}</span>
                        <strong>{participant.score.toLocaleString()}</strong>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

export default function PresentationHostPage() {
  return (
    <WorkspaceProvider>
      <WorkspaceFeatureGate feature="presentations">
        <PresentationHostContent />
      </WorkspaceFeatureGate>
    </WorkspaceProvider>
  );
}
