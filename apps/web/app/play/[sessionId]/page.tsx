"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AnswerAck, EventEnvelope, SessionSnapshot } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { Countdown } from "../../../components/countdown";
import { QuestionMedia } from "../../../components/question-media";
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
      if (envelope.payload.snapshot.roundId !== snapshotRef.current?.roundId) setAcknowledged(null);
    });
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
      "leaderboard.updated",
      "game.finished",
      "session.snapshot",
    ])
      socket.on(event, update);
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [sessionId, socket]);

  async function answer(choiceId: string) {
    if (!snapshot?.roundId || acknowledged || submitting) return;
    const participantToken = sessionStorage.getItem(`openround:participant:${sessionId}`);
    if (!participantToken) return;
    setSubmitting(true);
    const idempotencyKey = `${sessionId}:${snapshot.roundId}:${clientUuid()}`;
    socket.emit(
      "answer.submit",
      { sessionId, roundId: snapshot.roundId, choiceId, participantToken, idempotencyKey },
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

  const myRow = snapshot?.participants.find(
    (participant) => participant.id === snapshot.myParticipantId,
  );
  const revealed =
    snapshot?.phase === "question_reveal" ||
    snapshot?.phase === "leaderboard" ||
    snapshot?.phase === "finished";

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
                Question {(snapshot.questionIndex ?? 0) + 1} of {snapshot.questionCount}
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
              <p className="notice">The facilitator paused this question.</p>
            ) : null}
            <div className="answer-grid" aria-label="Answer choices">
              {snapshot.question.choices.map((choice, index) => {
                const selected =
                  snapshot.myAnswerChoiceId === choice.id ||
                  (acknowledged?.accepted && !snapshot.myAnswerChoiceId);
                const correct = revealed && snapshot.correctChoiceId === choice.id;
                const incorrect = revealed && selected && !correct;
                return (
                  <button
                    className="answer-button"
                    data-correct={correct || undefined}
                    data-incorrect={incorrect || undefined}
                    data-selected={selected || undefined}
                    disabled={
                      snapshot.phase !== "question_open" || Boolean(acknowledged) || submitting
                    }
                    key={choice.id}
                    onClick={() => void answer(choice.id)}
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
            {acknowledged?.accepted && !revealed ? (
              <p className="success" role="status">
                Answer received and saved.
              </p>
            ) : null}
            {revealed ? (
              <div
                className={
                  snapshot.myAnswerChoiceId === snapshot.correctChoiceId ? "success" : "notice"
                }
              >
                <strong>
                  {snapshot.myAnswerChoiceId === snapshot.correctChoiceId
                    ? "Correct"
                    : "Answer revealed"}
                </strong>
                {snapshot.explanation ? <div>{snapshot.explanation}</div> : null}
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
      </main>
    </div>
  );
}
