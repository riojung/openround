"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EventEnvelope, SessionSnapshot } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { Countdown } from "../../../components/countdown";
import { JoinAccess } from "../../../components/join-access";
import { QuestionMedia } from "../../../components/question-media";
import { createRealtimeClient, withRealtimeReceipt } from "../../../lib/realtime";
import { liveThemeStyle } from "../../../lib/theme";

type Ack<T> = { data?: T; error?: { message: string } };

export default function PresenterPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const socket = useMemo(createRealtimeClient, []);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const [error, setError] = useState("");
  const [mediaCredential, setMediaCredential] = useState("");

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const hostToken = sessionStorage.getItem(`openround:host:${sessionId}`);
    if (!hostToken) {
      setError("Presenter access must be opened from the host tab.");
      return;
    }
    setMediaCredential(hostToken);
    const sync = () =>
      socket.emit(
        "sync.request",
        {
          sessionId,
          role: "presenter",
          hostToken,
          lastSeq: snapshotRef.current?.seq ?? 0,
        },
        (response: Ack<{ snapshot: SessionSnapshot }>) =>
          response.data
            ? setSnapshot(response.data.snapshot)
            : setError(response.error?.message ?? "Could not synchronize"),
      );
    const update = withRealtimeReceipt((envelope: EventEnvelope<{ snapshot: SessionSnapshot }>) =>
      setSnapshot(envelope.payload.snapshot),
    );
    socket.on("connect", sync);
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

  return (
    <div
      className="live-shell"
      data-branded={snapshot?.brandTheme ? "true" : undefined}
      style={liveThemeStyle(snapshot?.brandTheme)}
    >
      <header className="shell live-topbar">
        <Brand inverted name={snapshot?.brandTheme?.organizationName} />
        <button
          className="button-quiet small-button"
          onClick={() => router.push(`/host/${sessionId}`)}
          type="button"
        >
          Host controls
        </button>
      </header>
      <main className="shell live-stage" aria-live="polite">
        {error ? (
          <section className="live-card">
            <p className="error">{error}</p>
          </section>
        ) : null}
        {!snapshot && !error ? (
          <section className="live-card">
            <p>Synchronizing presenter view…</p>
          </section>
        ) : null}
        {snapshot?.phase === "lobby" ? (
          <section className="live-card" style={{ textAlign: "center" }}>
            <p className="eyebrow">Join at this site</p>
            <div className="session-code">{snapshot.code}</div>
            <JoinAccess code={snapshot.code} size={220} />
            <h2>{snapshot.participants.length} ready</h2>
            <ul className="roster" style={{ justifyContent: "center" }}>
              {snapshot.participants.map((participant) => (
                <li key={participant.id}>{participant.nickname}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {snapshot?.question && snapshot.phase !== "finished" ? (
          <section className="live-card">
            <div className="page-heading" style={{ alignItems: "center" }}>
              <span className="status-pill">
                Question {(snapshot.questionIndex ?? 0) + 1} of {snapshot.questionCount}
              </span>
              {snapshot.phase === "question_open" ? (
                <Countdown deadline={snapshot.deadline} />
              ) : null}
            </div>
            <h1 style={{ fontSize: "clamp(2.4rem, 6vw, 5rem)" }}>{snapshot.question.prompt}</h1>
            <QuestionMedia
              altText={snapshot.question.mediaAlt}
              credential={mediaCredential}
              mediaId={snapshot.question.mediaId}
              sessionId={sessionId}
            />
            <div className="answer-grid">
              {snapshot.question.choices.map((choice, index) => (
                <div
                  className="answer-button"
                  data-correct={snapshot.correctChoiceId === choice.id || undefined}
                  key={choice.id}
                >
                  <span aria-hidden="true">{String.fromCharCode(65 + index)}.</span> {choice.label}
                </div>
              ))}
            </div>
            {snapshot.explanation ? <p className="notice">{snapshot.explanation}</p> : null}
            {snapshot.phase === "leaderboard" &&
            snapshot.settings.resultVisibility === "leaderboard" ? (
              <ol style={{ fontSize: "1.4rem", lineHeight: 1.8 }}>
                {snapshot.participants.slice(0, 5).map((participant) => (
                  <li key={participant.id}>
                    {participant.nickname} · {participant.score}
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        ) : null}
        {snapshot?.phase === "finished" ? (
          <section className="live-card" style={{ textAlign: "center" }}>
            <p className="eyebrow">Round complete</p>
            <h1 style={{ fontSize: "clamp(3rem, 9vw, 6rem)" }}>Thank you.</h1>
            <p className="lead" style={{ margin: "auto" }}>
              The facilitator now has the results for follow-up.
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
