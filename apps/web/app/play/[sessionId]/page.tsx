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
import {
  AudiencePanel,
  enqueueAudienceRealtimeUpdate,
  type AudienceRealtimeBatch,
} from "../../../components/audience-panel";
import { ExperiencePreferences } from "../../../components/experience-preferences";
import { Countdown } from "../../../components/countdown";
import { ParticipantAvatar, ParticipantIdentity } from "../../../components/participant-avatar";
import { QuestionMedia } from "../../../components/question-media";
import { QnaPanel } from "../../../components/qna-panel";
import {
  audienceContextKey,
  createAudienceRealtimeReceipt,
  createRealtimeClient,
  withRealtimeReceipt,
} from "../../../lib/realtime";
import { experienceThemeStyle } from "../../../lib/theme";
import { clientUuid } from "../../../lib/uuid";
import {
  participantProgressStage,
  participantRevealState,
  participantResponseControlsDisabled,
  participantResponseView,
  type LocalResponseReceipt,
} from "../../../lib/participant-response";
import {
  createAckRecoveryController,
  PARTICIPANT_ACK_CHECKING_MESSAGE,
  PARTICIPANT_ACK_TIMEOUT_MESSAGE,
  participantSubmissionRecovery,
  type AckRecoveryController,
} from "../../../lib/realtime-mutation-recovery";

type Ack<T> = { data?: T; error?: { code: string; message: string } };
type ParticipantSubmission = {
  idempotencyKey: string;
  roundId: string;
  response: ResponsePayload;
  confidence: ConfidenceValue | null;
};

const ACK_TIMEOUT_MS = 10_000;
const SYNC_GRACE_MS = 5_000;

export default function PlayerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const socket = useMemo(createRealtimeClient, []);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [acknowledged, setAcknowledged] = useState<AnswerAck | null>(null);
  const [localReceipt, setLocalReceipt] = useState<LocalResponseReceipt | null>(null);
  const [retryableSubmission, setRetryableSubmission] = useState<ParticipantSubmission | null>(
    null,
  );
  const [mediaCredential, setMediaCredential] = useState("");
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>([]);
  const [numericValue, setNumericValue] = useState("");
  const [ratingValue, setRatingValue] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceValue | null>(null);
  const [qnaRevision, setQnaRevision] = useState(0);
  const [audienceSyncRevision, setAudienceSyncRevision] = useState(0);
  const [audienceRealtimeBatch, setAudienceRealtimeBatch] = useState<AudienceRealtimeBatch | null>(
    null,
  );
  const audiencePanelKey = useMemo(
    () =>
      mediaCredential ? `${sessionId}:participant:${clientUuid()}` : `${sessionId}:participant`,
    [mediaCredential, sessionId],
  );
  const confidenceRef = useRef<HTMLFieldSetElement>(null);
  const syncParticipantRef = useRef<() => void>(() => undefined);
  const submissionRecoveryRef = useRef<AckRecoveryController<ParticipantSubmission> | null>(null);

  if (!submissionRecoveryRef.current) {
    submissionRecoveryRef.current = createAckRecoveryController({
      acknowledgementTimeoutMs: ACK_TIMEOUT_MS,
      reconciliationTimeoutMs: SYNC_GRACE_MS,
      onPendingChange: setSubmitting,
      onReconciliationRequested: () => {
        setError(PARTICIPANT_ACK_CHECKING_MESSAGE);
        syncParticipantRef.current();
      },
      onExpired: ({ context }) => {
        const current = snapshotRef.current;
        if (current?.roundId === context.roundId && current.phase === "question_open") {
          setRetryableSubmission(context);
          setError(PARTICIPANT_ACK_TIMEOUT_MESSAGE);
        } else {
          setRetryableSubmission(null);
          setLocalReceipt(null);
          setError("OpenRound could not confirm that response before the question closed.");
        }
      },
    });
  }

  function clearPendingSubmission(idempotencyKey?: string) {
    return Boolean(submissionRecoveryRef.current?.settle(idempotencyKey));
  }

  function resetResponse() {
    clearPendingSubmission();
    setAcknowledged(null);
    setLocalReceipt(null);
    setRetryableSubmission(null);
    setSelectedChoiceIds([]);
    setNumericValue("");
    setRatingValue(null);
    setConfidence(null);
    setError("");
  }

  function reconcilePendingSubmission(nextSnapshot: SessionSnapshot) {
    const pending = submissionRecoveryRef.current?.current();
    if (!pending) {
      if (nextSnapshot.myResponse) {
        setRetryableSubmission(null);
        setError((current) =>
          current === PARTICIPANT_ACK_TIMEOUT_MESSAGE ||
          current === PARTICIPANT_ACK_CHECKING_MESSAGE
            ? ""
            : current,
        );
      }
      return;
    }
    const resolution = participantSubmissionRecovery(pending.context.roundId, nextSnapshot);
    if (resolution !== "saved") return;
    if (!clearPendingSubmission(pending.id)) return;
    setRetryableSubmission(null);
    setError("");
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
          if (response.data) {
            const nextSnapshot = response.data.snapshot;
            if (nextSnapshot.roundId !== snapshotRef.current?.roundId) resetResponse();
            else reconcilePendingSubmission(nextSnapshot);
            setSnapshot(nextSnapshot);
          }
        },
      );
    };
    syncParticipantRef.current = sync;
    const update = withRealtimeReceipt((envelope: EventEnvelope<{ snapshot: SessionSnapshot }>) => {
      if (
        audienceContextKey(envelope.payload.snapshot) !== audienceContextKey(snapshotRef.current)
      ) {
        setAudienceSyncRevision((current) => current + 1);
      }
      const nextSnapshot = envelope.payload.snapshot;
      if (nextSnapshot.roundId !== snapshotRef.current?.roundId) resetResponse();
      else reconcilePendingSubmission(nextSnapshot);
      setSnapshot(nextSnapshot);
    });
    const qnaUpdate = withRealtimeReceipt(() => setQnaRevision((current) => current + 1));
    const audienceUpdate = createAudienceRealtimeReceipt((gap, envelope) => {
      setAudienceRealtimeBatch((current) =>
        enqueueAudienceRealtimeUpdate(current, { gap, envelope }),
      );
      if (envelope.type.startsWith("qna.")) setQnaRevision((current) => current + 1);
    });
    socket.on("connect", () => {
      setConnected(true);
      setError((current) =>
        current === PARTICIPANT_ACK_TIMEOUT_MESSAGE || current === PARTICIPANT_ACK_CHECKING_MESSAGE
          ? current
          : "",
      );
      setAudienceSyncRevision((current) => current + 1);
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
      submissionRecoveryRef.current?.dispose();
      syncParticipantRef.current = () => undefined;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [sessionId, socket]);

  function sendSubmission(submission: ParticipantSubmission) {
    if (!connected) {
      setError("Wait for the connection to recover before submitting your response.");
      return;
    }
    const participantToken = sessionStorage.getItem(`openround:participant:${sessionId}`);
    if (!participantToken) return;
    const attemptId = clientUuid();
    if (!submissionRecoveryRef.current?.begin(attemptId, submission)) return;
    setError("");
    setAcknowledged(null);
    setRetryableSubmission(null);
    setLocalReceipt({ response: submission.response, confidence: submission.confidence });
    socket.emit(
      "answer.submit",
      {
        sessionId,
        roundId: submission.roundId,
        response: submission.response,
        confidence: submission.confidence ?? undefined,
        participantToken,
        idempotencyKey: submission.idempotencyKey,
      },
      (response: Ack<AnswerAck>) => {
        if (!clearPendingSubmission(attemptId)) return;
        if (response.error) {
          setRetryableSubmission(null);
          setLocalReceipt(null);
          setError(response.error.message);
        } else if (response.data) {
          setAcknowledged(response.data);
          if (response.data.accepted) {
            setRetryableSubmission(null);
            setError("");
          } else {
            setRetryableSubmission(null);
            setLocalReceipt(null);
            setError(
              response.data.code === "ANSWER_LATE"
                ? "Time expired before the server received that answer."
                : "That answer was not accepted.",
            );
          }
        } else {
          setRetryableSubmission(submission);
          setError(PARTICIPANT_ACK_TIMEOUT_MESSAGE);
        }
      },
    );
  }

  function submitResponse(response: ResponsePayload, selectedConfidence = confidence) {
    if (
      !snapshot?.roundId ||
      acknowledged?.accepted ||
      snapshot.myResponse ||
      submitting ||
      retryableSubmission
    )
      return;
    if (snapshot.question?.confidence === "required" && selectedConfidence === null) {
      setError("Choose how sure you are before submitting your response.");
      confidenceRef.current?.focus();
      return;
    }
    sendSubmission({
      idempotencyKey: `${sessionId}:${snapshot.roundId}:${clientUuid()}`,
      roundId: snapshot.roundId,
      response,
      confidence: selectedConfidence ?? null,
    });
  }

  function retrySubmission() {
    if (!retryableSubmission || submitting || snapshot?.myResponse) return;
    if (snapshot?.roundId !== retryableSubmission.roundId || snapshot.phase !== "question_open") {
      resetResponse();
      setError("That question is no longer accepting responses.");
      return;
    }
    sendSubmission(retryableSubmission);
  }

  function chooseChoice(choiceId: string) {
    const question = snapshot?.question;
    if (
      !question ||
      snapshot.phase !== "question_open" ||
      acknowledged?.accepted ||
      snapshot.myResponse ||
      submitting ||
      retryableSubmission
    )
      return;
    if (question.type === "multi_select") {
      setSelectedChoiceIds((current) =>
        current.includes(choiceId)
          ? current.filter((selected) => selected !== choiceId)
          : [...current, choiceId],
      );
      setError("");
      return;
    }
    setSelectedChoiceIds([choiceId]);
    setError("");
    if (snapshot.uxBeta !== true && question.confidence === "off") {
      submitResponse(
        question.type === "poll"
          ? { kind: "poll", choiceIds: [choiceId] }
          : { kind: "choice", choiceIds: [choiceId] },
      );
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
  const revealed = snapshot ? participantRevealState(snapshot).revealed : false;
  const durableResponse = participantResponseView(
    snapshot?.myResponse,
    snapshot?.myConfidence,
    acknowledged,
    localReceipt,
  );
  const retryResponse = retryableSubmission?.response;
  const retryChoiceIds =
    retryResponse?.kind === "choice" || retryResponse?.kind === "poll"
      ? retryResponse.choiceIds
      : [];
  const displayedChoiceIds = retryableSubmission
    ? retryChoiceIds
    : durableResponse.choiceIds.length
      ? durableResponse.choiceIds
      : selectedChoiceIds;
  const responseSaved = durableResponse.saved;
  const displayedNumericValue = retryableSubmission
    ? retryResponse?.kind === "numeric"
      ? retryResponse.value
      : ""
    : durableResponse.saved
      ? durableResponse.numericValue
      : numericValue;
  const displayedRatingValue = retryableSubmission
    ? retryResponse?.kind === "rating"
      ? retryResponse.value
      : null
    : durableResponse.saved
      ? durableResponse.ratingValue
      : ratingValue;
  const displayedConfidence = retryableSubmission
    ? retryableSubmission.confidence
    : (durableResponse.confidence ?? confidence);
  const responseControlsDisabled = participantResponseControlsDisabled({
    questionOpen: snapshot?.phase === "question_open",
    saved: responseSaved,
    submitting: submitting || Boolean(retryableSubmission),
  });
  const uxBeta = snapshot?.uxBeta === true;
  const progressStage =
    snapshot && uxBeta ? participantProgressStage(snapshot, responseSaved) : null;
  const progressSteps = [
    ["waiting", "Waiting"],
    ["answering", "Answering"],
    ["saved", "Saved"],
    ["discussing", "Discussing"],
    ["reviewing", "Reviewing"],
    ["rechecking", "Rechecking"],
    ["complete", "Complete"],
  ] as const;
  const legacyNeedsSubmit = Boolean(
    snapshot?.question &&
    (snapshot.question.type === "multi_select" ||
      snapshot.question.type === "numeric" ||
      snapshot.question.type === "rating" ||
      snapshot.question.confidence !== "off"),
  );

  return (
    <div
      className="live-shell"
      data-corners={snapshot?.experienceTheme.tokens.corners}
      data-motion={snapshot?.experienceTheme.motion}
      data-pattern={snapshot?.experienceTheme.tokens.pattern}
      data-typography={snapshot?.experienceTheme.tokens.typography}
      data-ux-beta={uxBeta}
      style={experienceThemeStyle(snapshot?.experienceTheme)}
    >
      <header className="shell live-topbar">
        <Brand inverted name={snapshot?.brandTheme?.organizationName} />
        <div className="button-row">
          <ExperiencePreferences />
          <span
            aria-label="Connection status"
            className="connection"
            data-connected={connected}
            role="status"
          >
            <span className="connection-dot" aria-hidden="true" />
            {connected ? "Connected" : "Reconnecting…"}
          </span>
        </div>
      </header>
      <main className="shell live-stage">
        {progressStage ? (
          <ol aria-label="Round progress" className="participant-progress">
            {progressSteps.map(([stage, label]) => (
              <li aria-current={progressStage === stage ? "step" : undefined} key={stage}>
                {label}
              </li>
            ))}
          </ol>
        ) : null}
        <p aria-atomic="true" aria-live="polite" className="sr-only">
          {snapshot?.phase === "question_open"
            ? `${uxBeta ? "Question" : "Checkpoint"} open: ${snapshot.question?.prompt ?? (uxBeta ? "new question" : "new checkpoint")}`
            : snapshot?.phase === "finished"
              ? "The live round is complete."
              : snapshot
                ? `Round status: ${snapshot.phase.replaceAll("_", " ")}`
                : "Connecting to the live round."}
        </p>
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
            <div className="participant-hero-identity">
              <ParticipantAvatar avatarId={myRow?.avatarId} size="large" />
              <h1 style={{ fontSize: "clamp(2.6rem, 10vw, 5rem)" }}>
                {myRow?.nickname ?? "Ready"}
              </h1>
            </div>
            <p className="lead">The facilitator will start when everyone is ready.</p>
            <p className="muted">
              {snapshot.participants.length} participant
              {snapshot.participants.length === 1 ? "" : "s"} joined
            </p>
          </section>
        ) : null}
        {snapshot?.question && snapshot.phase !== "finished" ? (
          <section className="live-card" data-testid="participant-task">
            <div className="page-heading" style={{ alignItems: "center", marginBottom: 20 }}>
              <span className="status-pill">
                {snapshot.roundKind === "main" ? (uxBeta ? "Question" : "Checkpoint") : "Recheck"}{" "}
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
              <p className="notice">
                The facilitator paused this {uxBeta ? "question" : "checkpoint"}.
              </p>
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
                  const revealState = participantRevealState(snapshot, selected);
                  return (
                    <button
                      aria-pressed={selected}
                      className="answer-button"
                      data-correct={revealState.selectedCorrect || undefined}
                      data-incorrect={revealState.selectedIncorrect || undefined}
                      data-selected={selected || undefined}
                      disabled={responseControlsDisabled}
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
                  disabled={responseControlsDisabled}
                  inputMode="decimal"
                  onChange={(event) => {
                    setNumericValue(event.target.value);
                    setError("");
                  }}
                  value={displayedNumericValue}
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
                      aria-pressed={displayedRatingValue === value}
                      className="answer-button"
                      data-selected={displayedRatingValue === value || undefined}
                      disabled={responseControlsDisabled}
                      key={value}
                      onClick={() => {
                        setRatingValue(value);
                        setError("");
                      }}
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
                disabled={responseControlsDisabled}
                ref={confidenceRef}
                style={{ border: 0, padding: 0 }}
                tabIndex={-1}
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
                      aria-pressed={displayedConfidence === value}
                      className="button-quiet"
                      data-selected={displayedConfidence === value || undefined}
                      key={value}
                      onClick={() => {
                        setConfidence(value as ConfidenceValue);
                        setError("");
                      }}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {snapshot.phase === "question_open" &&
            !responseSaved &&
            (uxBeta || legacyNeedsSubmit || retryableSubmission) ? (
              retryableSubmission ? (
                <div className="participant-submit-bar" data-testid="response-status">
                  <p className="muted">
                    Your original response is unchanged. Retry uses the same save request so it
                    cannot create a second answer.
                  </p>
                  <button
                    className="button"
                    disabled={submitting || !connected}
                    onClick={retrySubmission}
                    type="button"
                  >
                    {submitting ? "Saving…" : "Retry saving response"}
                  </button>
                </div>
              ) : uxBeta ? (
                <div className="participant-submit-bar" data-testid="response-status">
                  <p className="muted">
                    Review your response before submitting. It cannot be changed.
                  </p>
                  <button
                    className="button"
                    disabled={submitting || !connected}
                    onClick={submitSelectedResponse}
                    type="button"
                  >
                    {submitting ? "Saving…" : "Submit response"}
                  </button>
                </div>
              ) : (
                <button
                  className="button"
                  disabled={submitting}
                  onClick={submitSelectedResponse}
                  type="button"
                >
                  {submitting ? "Saving…" : "Submit response"}
                </button>
              )
            ) : null}
            {responseSaved && !revealed ? (
              <p aria-label="Response save status" className="success" role="status">
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
                        ? `Review this ${uxBeta ? "question" : "checkpoint"}`
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
            {myRow ? (
              <p>
                <ParticipantIdentity
                  avatarId={myRow.avatarId}
                  nickname={myRow.nickname}
                  size="medium"
                />
              </p>
            ) : null}
            <p className="lead">Your final score is {myRow?.score ?? 0}.</p>
          </section>
        ) : null}
        {snapshot && mediaCredential && uxBeta ? (
          <details
            className="audience-tray"
            data-testid="audience-tray"
            key={snapshot.roundId ?? snapshot.phase}
          >
            <summary>Open Pulse, Q&amp;A, and chat</summary>
            <p className="muted">
              These optional tools never affect whether your response is saved.
            </p>
            {snapshot.phase !== "finished" ? (
              <AudiencePanel
                key={audiencePanelKey}
                realtimeBatch={audienceRealtimeBatch}
                role="participant"
                sessionId={sessionId}
                syncRevision={audienceSyncRevision}
                token={mediaCredential}
              />
            ) : null}
            <QnaPanel
              revision={qnaRevision}
              role="participant"
              sessionId={sessionId}
              token={mediaCredential}
            />
          </details>
        ) : null}
        {snapshot && mediaCredential && !uxBeta ? (
          <>
            {snapshot.phase !== "finished" ? (
              <AudiencePanel
                key={audiencePanelKey}
                realtimeBatch={audienceRealtimeBatch}
                role="participant"
                sessionId={sessionId}
                syncRevision={audienceSyncRevision}
                token={mediaCredential}
              />
            ) : null}
            <QnaPanel
              revision={qnaRevision}
              role="participant"
              sessionId={sessionId}
              token={mediaCredential}
            />
          </>
        ) : null}
      </main>
    </div>
  );
}
