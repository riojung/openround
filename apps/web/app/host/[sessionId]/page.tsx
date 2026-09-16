"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EventEnvelope, HostAction, SessionSnapshot } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { Countdown } from "../../../components/countdown";
import { JoinAccess } from "../../../components/join-access";
import { QuestionMedia } from "../../../components/question-media";
import { apiFetch } from "../../../lib/api";
import { createRealtimeClient, withRealtimeReceipt } from "../../../lib/realtime";
import { liveThemeStyle } from "../../../lib/theme";
import { clientUuid } from "../../../lib/uuid";

type Ack<T> = { data?: T; error?: { code: string; message: string } };

function actionsFor(
  snapshot: SessionSnapshot,
): Array<{ action: HostAction; label: string; className: string }> {
  switch (snapshot.phase) {
    case "lobby":
      return [{ action: "start", label: "Start round", className: "button" }];
    case "question_open":
      return [
        { action: "pause", label: "Pause", className: "button-quiet" },
        { action: "lock", label: "Lock answers", className: "button" },
      ];
    case "paused":
      return [
        { action: "resume", label: "Resume", className: "button" },
        { action: "lock", label: "Lock answers", className: "button-quiet" },
      ];
    case "question_locked":
      return [{ action: "reveal", label: "Reveal answer", className: "button" }];
    case "question_reveal":
      return [
        { action: "show_leaderboard", label: "Show standings", className: "button-quiet" },
        {
          action: "next",
          label:
            snapshot.questionIndex === snapshot.questionCount - 1
              ? "Finish round"
              : "Next question",
          className: "button",
        },
      ];
    case "leaderboard":
      return [
        {
          action: "next",
          label:
            snapshot.questionIndex === snapshot.questionCount - 1
              ? "Finish round"
              : "Next question",
          className: "button",
        },
      ];
    default:
      return [];
  }
}

export default function HostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const router = useRouter();
  const socket = useMemo(createRealtimeClient, []);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reportId, setReportId] = useState("");
  const [mediaCredential, setMediaCredential] = useState("");

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const hostToken = sessionStorage.getItem(`openround:host:${sessionId}`);
    if (!hostToken) {
      setError(
        "This tab does not have the host credential. Start the session from your dashboard.",
      );
      return;
    }
    setMediaCredential(hostToken);
    const sync = () => {
      socket.emit(
        "sync.request",
        { sessionId, role: "host", hostToken, lastSeq: snapshotRef.current?.seq ?? 0 },
        (response: Ack<{ snapshot: SessionSnapshot }>) => {
          if (response.error) setError(response.error.message);
          if (response.data) setSnapshot(response.data.snapshot);
        },
      );
    };
    const update = withRealtimeReceipt(
      (envelope: EventEnvelope<{ snapshot: SessionSnapshot; reportId?: string }>) => {
        setSnapshot(envelope.payload.snapshot);
        if (envelope.payload.reportId) setReportId(envelope.payload.reportId);
        setBusy(false);
      },
    );
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

  useEffect(() => {
    if (snapshot?.phase !== "finished" || reportId) return;
    apiFetch<{ report: { id: string } }>(`/v1/sessions/${sessionId}/report`)
      .then(({ report }) => setReportId(report.id))
      .catch(() => undefined);
  }, [reportId, sessionId, snapshot?.phase]);

  function command(action: HostAction, participantId?: string) {
    if (!snapshot || busy) return;
    const hostToken = sessionStorage.getItem(`openround:host:${sessionId}`);
    if (!hostToken) return;
    setBusy(true);
    setError("");
    socket.emit(
      "host.command",
      {
        sessionId,
        hostToken,
        commandId: clientUuid(),
        expectedVersion: snapshot.version,
        action,
        participantId,
      },
      (response: Ack<{ snapshot: SessionSnapshot }>) => {
        setBusy(false);
        if (response.error) {
          setError(response.error.message);
          socket.emit(
            "sync.request",
            { sessionId, role: "host", hostToken, lastSeq: snapshotRef.current?.seq ?? 0 },
            (sync: Ack<{ snapshot: SessionSnapshot }>) => {
              if (sync.data) setSnapshot(sync.data.snapshot);
            },
          );
        } else if (response.data) setSnapshot(response.data.snapshot);
      },
    );
  }

  function presenter() {
    router.push(`/present/${sessionId}`);
  }

  return (
    <div
      className="live-shell"
      data-branded={snapshot?.brandTheme ? "true" : undefined}
      style={liveThemeStyle(snapshot?.brandTheme)}
    >
      <header className="shell live-topbar">
        <Brand inverted name={snapshot?.brandTheme?.organizationName} />
        <div className="button-row">
          <span className="connection" data-connected={connected} role="status">
            <span className="connection-dot" aria-hidden="true" />
            {connected ? "Connected" : "Reconnecting…"}
          </span>
          <button className="button-quiet small-button" onClick={presenter} type="button">
            Presenter view
          </button>
        </div>
      </header>
      <main className="shell" style={{ padding: "26px 0 70px" }}>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {!snapshot ? (
          <section className="live-card">
            <p>Synchronizing host controls…</p>
            <Link href="/dashboard">Return to dashboard</Link>
          </section>
        ) : (
          <div className="host-grid">
            <section className="live-card" aria-live="polite">
              {snapshot.phase === "lobby" ? (
                <>
                  <p className="eyebrow">Round code</p>
                  <div
                    className="session-code"
                    aria-label={`Round code ${snapshot.code.split("").join(" ")}`}
                  >
                    {snapshot.code}
                  </div>
                  <p className="lead">Share the code or QR. Start when the room is ready.</p>
                  <ul className="roster" aria-label="Participant roster">
                    {snapshot.participants.map((participant) => (
                      <li key={participant.id}>
                        <span>
                          {participant.nickname}
                          {participant.connected ? "" : " · offline"}
                        </span>
                        <button
                          aria-label={`Remove ${participant.nickname}`}
                          className="roster-kick"
                          disabled={busy}
                          onClick={() => command("kick", participant.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {snapshot.question && snapshot.phase !== "finished" ? (
                <>
                  <div className="page-heading" style={{ alignItems: "center", marginBottom: 18 }}>
                    <span className="status-pill">{snapshot.phase.replaceAll("_", " ")}</span>
                    {snapshot.phase === "question_open" ? (
                      <Countdown deadline={snapshot.deadline} />
                    ) : null}
                  </div>
                  <h1 style={{ fontSize: "clamp(2rem, 6vw, 4rem)" }}>{snapshot.question.prompt}</h1>
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
                        <span aria-hidden="true">{String.fromCharCode(65 + index)}.</span>{" "}
                        {choice.label}
                      </div>
                    ))}
                  </div>
                  {snapshot.explanation ? <p className="notice">{snapshot.explanation}</p> : null}
                </>
              ) : null}
              {snapshot.phase === "finished" ? (
                <>
                  <p className="eyebrow">Round complete</p>
                  <h1 style={{ fontSize: "clamp(2.5rem, 7vw, 5rem)" }}>Results are ready.</h1>
                  <p className="lead">
                    {snapshot.participants.length} participants completed this live round.
                  </p>
                  {reportId ? (
                    <Link className="button" href={`/report/${reportId}`}>
                      Open report
                    </Link>
                  ) : (
                    <p className="notice">Finalizing the report…</p>
                  )}
                </>
              ) : null}
            </section>
            <aside className="panel">
              <h2 style={{ fontSize: "1.35rem" }}>Host controls</h2>
              {snapshot.phase === "lobby" ? <JoinAccess code={snapshot.code} editable /> : null}
              <div
                className="metric-grid"
                style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 18 }}
              >
                <div className="metric">
                  <strong>{snapshot.participants.length}</strong>
                  <span>joined</span>
                </div>
                <div className="metric">
                  <strong>{snapshot.answerCount}</strong>
                  <span>answered</span>
                </div>
              </div>
              <div className="host-controls">
                {actionsFor(snapshot).map((item) => (
                  <button
                    className={item.className}
                    disabled={
                      busy || (item.action === "start" && snapshot.participants.length === 0)
                    }
                    key={item.action}
                    onClick={() => command(item.action)}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
                {snapshot.phase === "lobby" ? (
                  <button
                    className="button-quiet"
                    disabled={busy}
                    onClick={() => command(snapshot.lobbyLocked ? "unlock_lobby" : "lock_lobby")}
                    type="button"
                  >
                    {snapshot.lobbyLocked ? "Unlock lobby" : "Lock lobby"}
                  </button>
                ) : null}
                {snapshot.phase !== "lobby" && snapshot.phase !== "finished" ? (
                  <button
                    className="button-danger"
                    disabled={busy}
                    onClick={() => window.confirm("End this session now?") && command("end")}
                    type="button"
                  >
                    End session
                  </button>
                ) : null}
              </div>
              {snapshot.settings.resultVisibility === "leaderboard" &&
              snapshot.phase !== "lobby" ? (
                <ol style={{ paddingLeft: 24, lineHeight: 1.8 }}>
                  {snapshot.participants.slice(0, 5).map((participant) => (
                    <li key={participant.id}>
                      <strong>{participant.nickname}</strong> · {participant.score}
                    </li>
                  ))}
                </ol>
              ) : null}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
