"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EventEnvelope, SessionSnapshot } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { AudiencePanel, type AudienceRealtimeUpdate } from "../../../components/audience-panel";
import { ExperiencePreferences } from "../../../components/experience-preferences";
import { Countdown } from "../../../components/countdown";
import { JoinAccess } from "../../../components/join-access";
import { QuestionMedia } from "../../../components/question-media";
import { ResponseDistributionView } from "../../../components/response-distribution";
import {
  audienceContextKey,
  createAudienceRealtimeReceipt,
  createRealtimeClient,
  withRealtimeReceipt,
} from "../../../lib/realtime";
import { experienceThemeStyle } from "../../../lib/theme";
import { playPresenterCue } from "../../../lib/sound";

type Ack<T> = { data?: T; error?: { message: string } };

export default function PresenterPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const socket = useMemo(createRealtimeClient, []);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const [error, setError] = useState("");
  const [mediaCredential, setMediaCredential] = useState("");
  const [embedded, setEmbedded] = useState(false);
  const [audienceSyncRevision, setAudienceSyncRevision] = useState(0);
  const [audienceRealtimeUpdate, setAudienceRealtimeUpdate] =
    useState<AudienceRealtimeUpdate | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    setEmbedded(window.self !== window.top);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const fragmentCredential = fragment.get("credential");
    if (fragmentCredential) {
      sessionStorage.setItem(`openround:presenter:${sessionId}`, fragmentCredential);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    const presenterToken =
      fragmentCredential ?? sessionStorage.getItem(`openround:presenter:${sessionId}`);
    if (!presenterToken) {
      setError("Presenter access must be opened from the host tab.");
      return;
    }
    setMediaCredential(presenterToken);
    const sync = () =>
      socket.emit(
        "sync.request",
        {
          sessionId,
          role: "presenter",
          hostToken: presenterToken,
          lastSeq: snapshotRef.current?.seq ?? 0,
        },
        (response: Ack<{ snapshot: SessionSnapshot }>) =>
          response.data
            ? setSnapshot(response.data.snapshot)
            : setError(response.error?.message ?? "Could not synchronize"),
      );
    const update = withRealtimeReceipt((envelope: EventEnvelope<{ snapshot: SessionSnapshot }>) => {
      playPresenterCue(envelope.payload.snapshot.experienceTheme, envelope.type);
      if (
        audienceContextKey(envelope.payload.snapshot) !== audienceContextKey(snapshotRef.current)
      ) {
        setAudienceSyncRevision((current) => current + 1);
      }
      setSnapshot(envelope.payload.snapshot);
    });
    const audienceUpdate = createAudienceRealtimeReceipt((gap, envelope) =>
      setAudienceRealtimeUpdate({ gap, envelope }),
    );
    socket.on("connect", () => {
      setAudienceSyncRevision((current) => current + 1);
      sync();
    });
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
      "audience.settings.updated",
      "audience.summary.updated",
      "chat.message.created",
      "chat.message.updated",
      "chat.message.removed",
      "chat.message.pinned",
      "chat.reaction.updated",
      "audience.event",
    ])
      socket.on(event, audienceUpdate);
    socket.connect();
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [sessionId, socket]);

  return (
    <div
      className="live-shell"
      data-corners={snapshot?.experienceTheme.tokens.corners}
      data-motion={snapshot?.experienceTheme.motion}
      data-pattern={snapshot?.experienceTheme.tokens.pattern}
      data-typography={snapshot?.experienceTheme.tokens.typography}
      style={experienceThemeStyle(snapshot?.experienceTheme)}
    >
      <header className="shell live-topbar">
        <Brand inverted name={snapshot?.brandTheme?.organizationName} />
        <div className="button-row">
          <ExperiencePreferences />
          {!embedded ? (
            <button
              className="button-quiet small-button"
              onClick={() => window.close()}
              type="button"
            >
              Close presenter
            </button>
          ) : (
            <span className="status-pill">Read-only embed</span>
          )}
        </div>
      </header>
      <main className="shell live-stage">
        <p aria-atomic="true" aria-live="polite" className="sr-only">
          {snapshot?.phase === "question_open"
            ? `Checkpoint open: ${snapshot.question?.prompt ?? "new checkpoint"}`
            : snapshot?.phase === "finished"
              ? "The live round is complete."
              : snapshot
                ? `Round status: ${snapshot.phase.replaceAll("_", " ")}`
                : "Synchronizing presenter view."}
        </p>
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
                {snapshot.roundKind === "linked_recheck"
                  ? "Linked recheck"
                  : snapshot.roundKind === "revote"
                    ? "Revote"
                    : `Checkpoint ${(snapshot.questionPosition ?? snapshot.questionIndex ?? 0) + 1} of ${snapshot.questionCount}`}
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
            {snapshot.question.choices.length > 0 ? (
              <div className="answer-grid">
                {snapshot.question.choices.map((choice, index) => {
                  const correct =
                    snapshot.correctResponse?.kind === "choice" &&
                    snapshot.correctResponse.choiceIds.includes(choice.id);
                  return (
                    <div
                      className="answer-button"
                      data-correct={correct || snapshot.correctChoiceId === choice.id || undefined}
                      key={choice.id}
                    >
                      <span aria-hidden="true">{String.fromCharCode(65 + index)}.</span>{" "}
                      {choice.label}
                    </div>
                  );
                })}
              </div>
            ) : snapshot.question.type === "numeric" ? (
              <p className="lead">
                Enter a numeric response
                {snapshot.question.unit ? ` in ${snapshot.question.unit}` : ""}
                {snapshot.correctResponse?.kind === "numeric"
                  ? `. Correct response: ${snapshot.correctResponse.value}${snapshot.question.unit ? ` ${snapshot.question.unit}` : ""}`
                  : "."}
              </p>
            ) : snapshot.question.rating ? (
              <p className="lead">
                Rate from {snapshot.question.rating.min} ({snapshot.question.rating.minLabel}) to{" "}
                {snapshot.question.rating.max} ({snapshot.question.rating.maxLabel}).
              </p>
            ) : null}
            {snapshot.phase === "intervention" && snapshot.intervention ? (
              <p className="notice">
                {snapshot.intervention.type === "peer_discussion"
                  ? "Discuss with a neighbour before responding again."
                  : snapshot.intervention.type === "example"
                    ? "The facilitator is working through an example."
                    : snapshot.intervention.type === "explain"
                      ? "The facilitator is clarifying this concept."
                      : "The round is taking a short break."}
              </p>
            ) : null}
            {snapshot.explanation ? <p className="notice">{snapshot.explanation}</p> : null}
            {snapshot.uxBeta === true && snapshot.responseDistribution ? (
              <ResponseDistributionView distribution={snapshot.responseDistribution} />
            ) : null}
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
        {snapshot && snapshot.phase !== "finished" && mediaCredential ? (
          <AudiencePanel
            realtimeUpdate={audienceRealtimeUpdate}
            role="presenter"
            sessionId={sessionId}
            syncRevision={audienceSyncRevision}
            token={mediaCredential}
          />
        ) : null}
      </main>
    </div>
  );
}
