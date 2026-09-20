"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "../../../../components/brand";
import { PresentationMedia } from "../../../../components/presentation-live/presentation-media";
import styles from "../../../../components/presentation-live/presentation-live.module.css";
import { apiFetch, humanError } from "../../../../lib/api";
import {
  shouldApplyLiveSnapshot,
  type LiveSnapshotFence,
} from "../../../../lib/live-snapshot-fence";

interface ParticipantContentBlock {
  id: string;
  kind: "content";
  layout: string;
  title: string;
  body: string;
  mediaId: string | null;
  mediaAlt: string | null;
}

interface ParticipantQuestionBlock {
  id: string;
  kind: "question";
  question: {
    id: string;
    type: "single_select" | "true_false" | "multi_select" | "poll" | "numeric" | "rating";
    prompt: string;
    confidence: "off" | "optional" | "required";
    mediaId: string | null;
    mediaAlt: string | null;
    choices?: Array<{ id: string; label: string }>;
    min?: number;
    max?: number;
    minLabel?: string;
    maxLabel?: string;
  };
}

interface ParticipantSnapshot {
  id: string;
  title: string;
  status: "active" | "finished";
  phase: "lobby" | "content" | "question_open" | "question_reveal" | "intervention" | "finished";
  currentBlockIndex: number;
  blockCount: number;
  revision: number;
  currentBlock: ParticipantContentBlock | ParticipantQuestionBlock | null;
  participantCount: number;
  questionClosesAt: string | null;
  acceptingResponses: boolean;
  responseSubmitted: boolean;
  standing: { rank: number; score: number } | null;
  responseResult: { correct: boolean | null; score: number } | null;
}

export default function PresentationParticipantPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ParticipantSnapshot | null>(null);
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>([]);
  const [numericValue, setNumericValue] = useState("");
  const [ratingValue, setRatingValue] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const blockId = useRef<string | null>(null);
  const requestSequence = useRef(0);
  const appliedSnapshot = useRef<LiveSnapshotFence>({ requestId: 0, revision: -1 });

  const applySnapshot = useCallback((incoming: ParticipantSnapshot, requestId: number) => {
    const fence = { requestId, revision: incoming.revision };
    if (!shouldApplyLiveSnapshot(appliedSnapshot.current, fence)) return false;
    appliedSnapshot.current = fence;
    if (incoming.currentBlock?.id !== blockId.current) {
      blockId.current = incoming.currentBlock?.id ?? null;
      setSelectedChoiceIds([]);
      setNumericValue("");
      setRatingValue(null);
      setConfidence(null);
    }
    setSnapshot(incoming);
    return true;
  }, []);

  const refresh = useCallback(async () => {
    const token = sessionStorage.getItem(`openround:presentation-participant:${id}`);
    if (!token) {
      router.replace("/presentation/join");
      return;
    }
    const requestId = ++requestSequence.current;
    try {
      const response = await apiFetch<{ snapshot: ParticipantSnapshot }>(
        `/v1/presentation-sessions/${id}/participant`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!applySnapshot(response.snapshot, requestId)) return;
      setError("");
    } catch (caught) {
      if (requestId < appliedSnapshot.current.requestId) return;
      if ((caught as { status?: number }).status === 401) {
        sessionStorage.removeItem(`openround:presentation-participant:${id}`);
        router.replace("/presentation/join");
      } else {
        setError(humanError(caught));
      }
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

  function toggleChoice(question: ParticipantQuestionBlock["question"], choiceId: string) {
    if (question.type !== "multi_select") {
      setSelectedChoiceIds([choiceId]);
      return;
    }
    setSelectedChoiceIds((current) =>
      current.includes(choiceId)
        ? current.filter((candidate) => candidate !== choiceId)
        : [...current, choiceId],
    );
  }

  async function submitResponse() {
    const token = sessionStorage.getItem(`openround:presentation-participant:${id}`);
    const block = snapshot?.currentBlock;
    if (!token || block?.kind !== "question") return;
    const question = block.question;
    const response =
      question.type === "numeric"
        ? { numericValue, ...(confidence ? { confidence } : {}) }
        : question.type === "rating"
          ? { ratingValue, ...(confidence ? { confidence } : {}) }
          : { choiceIds: selectedChoiceIds, ...(confidence ? { confidence } : {}) };
    setBusy(true);
    setError("");
    try {
      await apiFetch(`/v1/presentation-sessions/${id}/responses`, {
        method: "POST",
        body: JSON.stringify({ participantToken: token, response }),
      });
      await refresh();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  const block = snapshot?.currentBlock ?? null;
  const canSubmit =
    block?.kind === "question" &&
    snapshot?.phase === "question_open" &&
    snapshot.acceptingResponses &&
    !snapshot.responseSubmitted &&
    (block.question.type === "numeric"
      ? numericValue.trim() !== ""
      : block.question.type === "rating"
        ? ratingValue !== null
        : selectedChoiceIds.length > 0) &&
    (block.question.confidence !== "required" || confidence !== null);
  const remainingSeconds = snapshot?.questionClosesAt
    ? Math.max(0, Math.ceil((new Date(snapshot.questionClosesAt).getTime() - now) / 1_000))
    : null;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Brand />
        <span>{snapshot ? `${snapshot.participantCount} joined` : "Connecting…"}</span>
      </header>
      <div className={styles.stage}>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <section className={styles.canvas} aria-live="polite">
          <div className={styles.canvasContent}>
            {!snapshot ? <p>Restoring this Presentation…</p> : null}
            {snapshot?.phase === "lobby" ? (
              <>
                <span className={styles.statusPill}>You’re in</span>
                <h1>{snapshot.title}</h1>
                <p>The facilitator will begin shortly.</p>
              </>
            ) : null}
            {block?.kind === "content" ? (
              <>
                <span className={styles.statusPill}>Content</span>
                <h1>{block.title}</h1>
                <p>{block.body}</p>
                <PresentationMedia
                  altText={block.mediaAlt}
                  mediaId={block.mediaId}
                  participant
                  sessionId={id}
                />
                <p className="muted">No response is collected on this slide.</p>
              </>
            ) : null}
            {block?.kind === "question" ? (
              <>
                <span className={styles.statusPill}>
                  {snapshot?.phase === "intervention"
                    ? "Review and recover"
                    : snapshot?.acceptingResponses
                      ? "Respond now"
                      : "Response closed"}
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
                  participant
                  sessionId={id}
                />
                {block.question.choices ? (
                  <div className={styles.choiceGrid}>
                    {block.question.choices.map((choice) => (
                      <button
                        aria-pressed={selectedChoiceIds.includes(choice.id)}
                        className={styles.choiceButton}
                        disabled={!snapshot?.acceptingResponses || snapshot.responseSubmitted}
                        key={choice.id}
                        onClick={() => toggleChoice(block.question, choice.id)}
                        type="button"
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                ) : block.question.type === "numeric" ? (
                  <label className={styles.formStack}>
                    Numeric response
                    <input
                      disabled={!snapshot?.acceptingResponses || snapshot.responseSubmitted}
                      inputMode="decimal"
                      onChange={(event) => setNumericValue(event.target.value)}
                      value={numericValue}
                    />
                  </label>
                ) : (
                  <label className={styles.formStack}>
                    Rating
                    <select
                      disabled={!snapshot?.acceptingResponses || snapshot.responseSubmitted}
                      onChange={(event) => setRatingValue(Number(event.target.value))}
                      value={ratingValue ?? ""}
                    >
                      <option disabled value="">
                        Choose a rating
                      </option>
                      {Array.from(
                        {
                          length: (block.question.max ?? 5) - (block.question.min ?? 1) + 1,
                        },
                        (_, index) => (block.question.min ?? 1) + index,
                      ).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {block.question.confidence !== "off" && snapshot?.acceptingResponses ? (
                  <label className={styles.formStack}>
                    Confidence{" "}
                    {block.question.confidence === "required" ? "(required)" : "(optional)"}
                    <select
                      disabled={snapshot.responseSubmitted}
                      onChange={(event) => setConfidence(Number(event.target.value))}
                      value={confidence ?? ""}
                    >
                      <option value="">Choose confidence</option>
                      <option value="1">Low</option>
                      <option value="2">Medium</option>
                      <option value="3">High</option>
                    </select>
                  </label>
                ) : null}
                <div className={styles.responseActions}>
                  {snapshot?.responseResult ? (
                    <p className="notice" role="status">
                      {snapshot.responseResult.correct === null
                        ? "Response recorded"
                        : snapshot.responseResult.correct
                          ? `Correct · +${snapshot.responseResult.score.toLocaleString()} points`
                          : "Not quite · review the facilitator’s explanation"}
                      {snapshot.standing
                        ? ` · Rank ${snapshot.standing.rank} with ${snapshot.standing.score.toLocaleString()} points`
                        : ""}
                    </p>
                  ) : snapshot?.responseSubmitted ? (
                    <p className="notice" role="status">
                      Response saved. You can stay here while the facilitator continues.
                    </p>
                  ) : snapshot?.acceptingResponses ? (
                    <button
                      className="button"
                      disabled={!canSubmit || busy}
                      onClick={() => void submitResponse()}
                      type="button"
                    >
                      {busy ? "Saving…" : "Submit response"}
                    </button>
                  ) : (
                    <p className="muted">The facilitator has closed this question.</p>
                  )}
                </div>
              </>
            ) : null}
            {snapshot?.phase === "finished" ? (
              <>
                <span className={styles.statusPill}>Complete</span>
                <h1>Thanks for participating</h1>
                <p>Your responses have been saved for the facilitator’s session report.</p>
                <Link className="button" href="/">
                  Leave Presentation
                </Link>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
