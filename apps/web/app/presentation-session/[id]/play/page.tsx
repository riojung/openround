"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "../../../../components/brand";
import { useLocale } from "../../../../components/locale-provider";
import { PresentationMedia } from "../../../../components/presentation-live/presentation-media";
import styles from "../../../../components/presentation-live/presentation-live.module.css";
import { apiFetch, humanError } from "../../../../lib/api";
import { formatNumber } from "../../../../lib/i18n/format";
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
  const { locale, t } = useLocale();
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
        <span>
          {snapshot
            ? t("live.common.joinedCount", {
                count: formatNumber(locale, snapshot.participantCount),
              })
            : t("live.common.connecting")}
        </span>
      </header>
      <div className={styles.stage}>
        {error ? (
          <p className="error" lang="en-CA" role="alert">
            {error}
          </p>
        ) : null}
        <section className={styles.canvas} aria-live="polite">
          <div className={styles.canvasContent}>
            {!snapshot ? <p>{t("live.presentationPlay.restoring")}</p> : null}
            {snapshot?.phase === "lobby" ? (
              <>
                <span className={styles.statusPill}>{t("live.presentationPlay.youreIn")}</span>
                <h1 lang="">{snapshot.title}</h1>
                <p>{t("live.presentationPlay.facilitatorStarts")}</p>
              </>
            ) : null}
            {block?.kind === "content" ? (
              <>
                <span className={styles.statusPill}>{t("live.presentationPlay.content")}</span>
                <h1 lang="">{block.title}</h1>
                <p lang="">{block.body}</p>
                <PresentationMedia
                  altText={block.mediaAlt}
                  mediaId={block.mediaId}
                  participant
                  sessionId={id}
                />
                <p className="muted">{t("live.presentationPlay.noResponse")}</p>
              </>
            ) : null}
            {block?.kind === "question" ? (
              <>
                <span className={styles.statusPill}>
                  {snapshot?.phase === "intervention"
                    ? t("live.presentationPlay.reviewRecover")
                    : snapshot?.acceptingResponses
                      ? t("live.presentationPlay.respondNow")
                      : t("live.presentationPlay.responseClosed")}
                </span>
                {remainingSeconds !== null ? (
                  <p className={styles.timer} aria-live="off">
                    {formatNumber(locale, remainingSeconds, {
                      style: "unit",
                      unit: "second",
                      unitDisplay: "narrow",
                    })}
                  </p>
                ) : null}
                <h1 lang="">{block.question.prompt}</h1>
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
                        lang=""
                        onClick={() => toggleChoice(block.question, choice.id)}
                        type="button"
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                ) : block.question.type === "numeric" ? (
                  <label className={styles.formStack}>
                    {t("live.presentationPlay.numericResponse")}
                    <input
                      disabled={!snapshot?.acceptingResponses || snapshot.responseSubmitted}
                      inputMode="decimal"
                      onChange={(event) => setNumericValue(event.target.value)}
                      value={numericValue}
                    />
                  </label>
                ) : (
                  <label className={styles.formStack}>
                    {t("live.presentationPlay.rating")}
                    <select
                      disabled={!snapshot?.acceptingResponses || snapshot.responseSubmitted}
                      onChange={(event) => setRatingValue(Number(event.target.value))}
                      value={ratingValue ?? ""}
                    >
                      <option disabled value="">
                        {t("live.presentationPlay.chooseRating")}
                      </option>
                      {Array.from(
                        {
                          length: (block.question.max ?? 5) - (block.question.min ?? 1) + 1,
                        },
                        (_, index) => (block.question.min ?? 1) + index,
                      ).map((value) => (
                        <option key={value} value={value}>
                          {formatNumber(locale, value)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {block.question.confidence !== "off" && snapshot?.acceptingResponses ? (
                  <label className={styles.formStack}>
                    {t("live.presentationPlay.confidence", {
                      requirement:
                        block.question.confidence === "required"
                          ? t("live.presentationPlay.required")
                          : t("live.presentationPlay.optional"),
                    })}
                    <select
                      disabled={snapshot.responseSubmitted}
                      onChange={(event) => setConfidence(Number(event.target.value))}
                      value={confidence ?? ""}
                    >
                      <option value="">{t("live.presentationPlay.chooseConfidence")}</option>
                      <option value="1">{t("live.presentationPlay.low")}</option>
                      <option value="2">{t("live.presentationPlay.medium")}</option>
                      <option value="3">{t("live.presentationPlay.high")}</option>
                    </select>
                  </label>
                ) : null}
                <div className={styles.responseActions}>
                  {snapshot?.responseResult ? (
                    <p className="notice" role="status">
                      {snapshot.responseResult.correct === null
                        ? t("live.presentationPlay.responseRecorded")
                        : snapshot.responseResult.correct
                          ? t("live.presentationPlay.correctPoints", {
                              score: formatNumber(locale, snapshot.responseResult.score),
                            })
                          : t("live.presentationPlay.notQuite")}
                      {snapshot.standing
                        ? t("live.presentationPlay.rankPoints", {
                            rank: formatNumber(locale, snapshot.standing.rank),
                            score: formatNumber(locale, snapshot.standing.score),
                          })
                        : ""}
                    </p>
                  ) : snapshot?.responseSubmitted ? (
                    <p className="notice" role="status">
                      {t("live.presentationPlay.responseSaved")}
                    </p>
                  ) : snapshot?.acceptingResponses ? (
                    <button
                      className="button"
                      disabled={!canSubmit || busy}
                      onClick={() => void submitResponse()}
                      type="button"
                    >
                      {busy ? t("live.common.saving") : t("live.presentationPlay.submit")}
                    </button>
                  ) : (
                    <p className="muted">{t("live.presentationPlay.closed")}</p>
                  )}
                </div>
              </>
            ) : null}
            {snapshot?.phase === "finished" ? (
              <>
                <span className={styles.statusPill}>{t("live.common.complete")}</span>
                <h1>{t("live.presentationPlay.thanks")}</h1>
                <p>{t("live.presentationPlay.savedForReport")}</p>
                <Link className="button" href="/">
                  {t("live.presentationPlay.leave")}
                </Link>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
