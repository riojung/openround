"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnswerAck,
  ConfidenceValue,
  EventEnvelope,
  ResponsePayload,
  SessionSnapshot,
} from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { Countdown } from "../../../components/countdown";
import { QuestionMedia } from "../../../components/question-media";
import { QnaPanel } from "../../../components/qna-panel";
import { createRealtimeClient, withRealtimeReceipt } from "../../../lib/realtime";
import { liveThemeStyle } from "../../../lib/theme";
import { clientUuid } from "../../../lib/uuid";

type Ack<T> = { data?: T; error?: { code: string; message: string } };

export default function PlayerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const socket = useMemo(createRealtimeClient, []);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState<AnswerAck | null>(null);
  const [mediaCredential, setMediaCredential] = useState("");
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>([]);
  const [numericValue, setNumericValue] = useState("");
  const [ratingValue, setRatingValue] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceValue | null>(null);
  const [qnaRevision, setQnaRevision] = useState(0);

  function resetResponse() {
    setAcknowledged(null);
    setSelectedChoiceIds([]);
    setNumericValue("");
    setRatingValue(null);
    setConfidence(null);
  }

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const token = sessionStorage.getItem(`openround:participant:${sessionId}`);
    if (!token) {
      setError("This device does not have a resume credential. Join the round again.");
      return;
    }
    setMediaCredential(token);
    const sync = () => {
      socket.emit(
        "sync.request",
        {
          sessionId,
          role: "participant",
          participantToken: token,
          lastSeq: snapshotRef.current?.seq ?? 0,
        },
        (response: Ack<{ snapshot: SessionSnapshot }>) => {
          if (response.error) setError(response.error.message);
          if (response.data) setSnapshot(response.data.snapshot);
        },
      );
    };
    const update = withRealtimeReceipt((envelope: EventEnvelope<{ snapshot: SessionSnapshot }>) => {
      setSnapshot(envelope.payload.snapshot);
      if (envelope.payload.snapshot.roundId !== snapshotRef.current?.roundId) resetResponse();
    });
    const qnaUpdate = withRealtimeReceipt(() => setQnaRevision((current) => current + 1));
    socket.on("connect", () => {
      setConnected(true);
      setError("");
      sync();
    });
    socket.on("disconnect", () => setConnected(false));
    for (const event of [
      "lobby.updated",
      "question.open",
      "question.locked",
      "question.reveal",
      "checkpoint.insight",
      "intervention.updated",
      "recheck.open",
      "leaderboard.updated",
      "game.finished",
      "session.snapshot",
    ])
      socket.on(event, update);
    for (const event of [
      "qna.question.created",
      "qna.question.updated",
      "qna.reply.created",
      "qna.reply.updated",
      "qna.vote.updated",
      "qna.settings.updated",
    ])
      socket.on(event, qnaUpdate);
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [sessionId, socket]);

  function submitResponse(response: ResponsePayload, selectedConfidence = confidence) {
    if (!snapshot?.roundId || acknowledged || submitting) return;
    if (snapshot.question?.confidence === "required" && selectedConfidence === null) {
      setError("Choose how sure you are before submitting your response.");
      return;
    }
    const participantToken = sessionStorage.getItem(`openround:participant:${sessionId}`);
    if (!participantToken) return;
    setSubmitting(true);
    const idempotencyKey = `${sessionId}:${snapshot.roundId}:${clientUuid()}`;
    socket.emit(
      "answer.submit",
      {
        sessionId,
        roundId: snapshot.roundId,
        response,
        confidence: selectedConfidence ?? undefined,
        participantToken,
        idempotencyKey,
      },
      (response: Ack<AnswerAck>) => {
        setSubmitting(false);
        if (response.error) setError(response.error.message);
        else if (response.data) {
          setAcknowledged(response.data);
          if (!response.data.accepted)
            setError(
              response.data.code === "ANSWER_LATE"
                ? "Time expired before the server received that answer."
                : "That answer was not accepted.",
            );
        }
      },
    );
  }

  function chooseChoice(choiceId: string) {
    const question = snapshot?.question;
    if (!question || snapshot.phase !== "question_open" || acknowledged || submitting) return;
    if (question.type === "multi_select") {
      setSelectedChoiceIds((current) =>
        current.includes(choiceId)
          ? current.filter((selected) => selected !== choiceId)
          : [...current, choiceId],
      );
      return;
    }
    setSelectedChoiceIds([choiceId]);
    if (question.confidence === "off") {
      submitResponse({
        kind: question.type === "poll" ? "poll" : "choice",
        choiceIds: [choiceId],
      });
    }
  }

  function submitSelectedResponse() {
    const question = snapshot?.question;
    if (!question) return;
    if (["single_select", "true_false", "multi_select"].includes(question.type)) {
      if (selectedChoiceIds.length === 0) {
        setError("Choose an answer before submitting.");
        return;
      }
      submitResponse({ kind: "choice", choiceIds: selectedChoiceIds });
    } else if (question.type === "poll") {
      if (selectedChoiceIds.length !== 1) {
        setError("Choose a poll response before submitting.");
        return;
      }
      submitResponse({ kind: "poll", choiceIds: selectedChoiceIds });
    } else if (question.type === "numeric") {
      if (!numericValue.trim()) {
        setError("Enter a numeric response before submitting.");
        return;
      }
      submitResponse({
        kind: "numeric",
        value: numericValue,
        unit: question.unit ?? undefined,
      });
    } else if (ratingValue !== null) {
      submitResponse({ kind: "rating", value: ratingValue });
    } else {
      setError("Choose a rating before submitting.");
    }
  }

  const myRow = snapshot?.participants.find(
    (participant) => participant.id === snapshot.myParticipantId,
  );
  const revealed =
    snapshot?.phase === "question_reveal" ||
    snapshot?.phase === "leaderboard" ||
    snapshot?.phase === "finished" ||
    (snapshot?.phase === "intervention" && snapshot.correctResponse !== undefined);
  const savedChoiceIds =
    snapshot?.myResponse?.kind === "choice" || snapshot?.myResponse?.kind === "poll"
      ? snapshot.myResponse.choiceIds
      : [];
  const displayedChoiceIds = savedChoiceIds.length > 0 ? savedChoiceIds : selectedChoiceIds;

  return (
    <div
      className="live-shell"
      data-branded={snapshot?.brandTheme ? "true" : undefined}
      style={liveThemeStyle(snapshot?.brandTheme)}
    >
      <header className="shell live-topbar">
        <Brand inverted name={snapshot?.brandTheme?.organizationName} />
        <span className="connection" data-connected={connected} role="status">
          <span className="connection-dot" aria-hidden="true" />
          {connected ? "Connected" : "Reconnecting…"}
        </span>
      </header>
      <main className="shell live-stage" aria-live="polite">
        {error ? (
          <section className="live-card">
            <p className="error" role="alert">
              {error}
            </p>
            {!snapshot ? (
              <Link className="button" href="/join">
                Join again
              </Link>
            ) : null}
          </section>
        ) : null}
        {!snapshot && !error ? (
          <section className="live-card">
            <p>Synchronizing with the round…</p>
          </section>
        ) : null}
        {snapshot?.phase === "lobby" ? (
          <section className="live-card">
            <p className="eyebrow">You are in</p>
            <h1 style={{ fontSize: "clamp(2.6rem, 10vw, 5rem)" }}>{myRow?.nickname ?? "Ready"}</h1>
            <p className="lead">The facilitator will start when everyone is ready.</p>
            <p className="muted">
              {snapshot.participants.length} participant
              {snapshot.participants.length === 1 ? "" : "s"} joined
            </p>
          </section>
        ) : null}
        {snapshot?.question && snapshot.phase !== "finished" ? (
          <section className="live-card">
            <div className="page-heading" style={{ alignItems: "center", marginBottom: 20 }}>
              <span className="status-pill">
                {snapshot.roundKind === "main" ? "Checkpoint" : "Recheck"}{" "}
                {(snapshot.questionPosition ?? snapshot.questionIndex ?? 0) + 1} of{" "}
                {snapshot.questionCount}
              </span>
              {snapshot.phase === "question_open" ? (
                <Countdown deadline={snapshot.deadline} />
              ) : null}
            </div>
            <h1 style={{ fontSize: "clamp(2rem, 7vw, 4rem)" }}>{snapshot.question.prompt}</h1>
            <QuestionMedia
              altText={snapshot.question.mediaAlt}
              credential={mediaCredential}
              mediaId={snapshot.question.mediaId}
              sessionId={sessionId}
            />
            {snapshot.phase === "paused" ? (
              <p className="notice">The facilitator paused this checkpoint.</p>
            ) : null}
            {snapshot.phase === "intervention" ? (
              <p className="notice">
                The facilitator started{" "}
                {snapshot.intervention?.type.replaceAll("_", " ") ?? "an intervention"}.
              </p>
            ) : null}
            {["single_select", "true_false", "multi_select", "poll"].includes(
              snapshot.question.type,
            ) ? (
              <div className="answer-grid" aria-label="Answer choices">
                {snapshot.question.choices.map((choice, index) => {
                  const selected = displayedChoiceIds.includes(choice.id);
                  const correct =
                    revealed &&
                    snapshot.correctResponse?.kind === "choice" &&
                    snapshot.correctResponse.choiceIds.includes(choice.id);
                  const incorrect = revealed && selected && !correct;
                  return (
                    <button
                      aria-pressed={selected}
                      className="answer-button"
                      data-correct={correct || undefined}
                      data-incorrect={incorrect || undefined}
                      data-selected={selected || undefined}
                      disabled={
                        snapshot.phase !== "question_open" || Boolean(acknowledged) || submitting
                      }
                      key={choice.id}
                      onClick={() => chooseChoice(choice.id)}
                      type="button"
                    >
                      <span aria-hidden="true" style={{ marginRight: 10 }}>
                        {String.fromCharCode(65 + index)}.
                      </span>
                      {choice.label}
                    </button>
                  );
                })}
              </div>
            ) : snapshot.question.type === "numeric" ? (
              <label className="field">
                <span>Numeric response {snapshot.question.unit ?? ""}</span>
                <input
                  className="input"
                  disabled={snapshot.phase !== "question_open" || Boolean(acknowledged)}
                  inputMode="decimal"
                  onChange={(event) => setNumericValue(event.target.value)}
                  value={numericValue}
                />
              </label>
            ) : snapshot.question.rating ? (
              <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                <legend className="field-label">Choose a rating</legend>
                <div className="answer-grid">
                  {Array.from(
                    {
                      length: snapshot.question.rating.max - snapshot.question.rating.min + 1,
                    },
                    (_, index) => snapshot.question!.rating!.min + index,
                  ).map((value) => (
                    <button
                      aria-pressed={ratingValue === value}
                      className="answer-button"
                      data-selected={ratingValue === value || undefined}
                      disabled={snapshot.phase !== "question_open" || Boolean(acknowledged)}
                      key={value}
                      onClick={() => setRatingValue(value)}
                      type="button"
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <p className="muted">
                  {snapshot.question.rating.minLabel} · {snapshot.question.rating.maxLabel}
                </p>
              </fieldset>
            ) : null}
            {snapshot.question.confidence !== "off" ? (
              <fieldset
                className="field"
                disabled={snapshot.phase !== "question_open" || Boolean(acknowledged)}
                style={{ border: 0, padding: 0 }}
              >
                <legend className="field-label">
                  How sure are you?{snapshot.question.confidence === "required" ? " Required" : ""}
                </legend>
                <div className="button-row">
                  {[
                    [1, "Not sure"],
                    [2, "Somewhat sure"],
                    [3, "Very sure"],
                  ].map(([value, label]) => (
                    <button
                      aria-pressed={confidence === value}
                      className="button-quiet"
                      data-selected={confidence === value || undefined}
                      key={value}
                      onClick={() => setConfidence(value as ConfidenceValue)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {snapshot.phase === "question_open" &&
            !acknowledged &&
            (snapshot.question.type === "multi_select" ||
              snapshot.question.type === "numeric" ||
              snapshot.question.type === "rating" ||
              snapshot.question.confidence !== "off") ? (
              <button
                className="button"
                disabled={submitting}
                onClick={submitSelectedResponse}
                type="button"
              >
                {submitting ? "Saving…" : "Submit response"}
              </button>
            ) : null}
            {acknowledged?.accepted && !revealed ? (
              <p className="success" role="status">
                Answer received and saved.
              </p>
            ) : null}
            {revealed ? (
              <div className={snapshot.myCorrect ? "success" : "notice"}>
                <strong>
                  {snapshot.question.purpose === "opinion"
                    ? "Response recorded"
                    : snapshot.myCorrect === true
                      ? "Correct"
                      : snapshot.myCorrect === false
                        ? "Review this checkpoint"
                        : "Answer revealed"}
                </strong>
                {snapshot.explanation ? <div>{snapshot.explanation}</div> : null}
                {snapshot.feedback ? <div>{snapshot.feedback}</div> : null}
              </div>
            ) : null}
          </section>
        ) : null}
        {snapshot?.phase === "finished" ? (
          <section className="live-card">
            <p className="eyebrow">Round complete</p>
            <h1>Thanks for taking part.</h1>
            <p className="lead">Your final score is {myRow?.score ?? 0}.</p>
          </section>
        ) : null}
        {snapshot && mediaCredential ? (
          <QnaPanel
            revision={qnaRevision}
            role="participant"
            sessionId={sessionId}
            token={mediaCredential}
          />
        ) : null}
      </main>
    </div>
  );
}
