"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ConfidenceValue, FollowupSnapshot, ResponsePayload } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { Countdown } from "../../../components/countdown";
import { QuestionMedia } from "../../../components/question-media";
import { API_URL, ApiClientError, humanError } from "../../../lib/api";
import { shouldReplaceSavedAttempt } from "../../../lib/followup-resume";
import { clientUuid } from "../../../lib/uuid";

async function followupFetch<T>(path: string, token: string, init: RequestInit = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new ApiClientError(
      body?.error?.message ?? `Request failed (${response.status}).`,
      body?.error?.code,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export default function FollowupPage() {
  const { id } = useParams<{ id: string }>();
  const [snapshot, setSnapshot] = useState<FollowupSnapshot | null>(null);
  const [attemptToken, setAttemptToken] = useState("");
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>([]);
  const [numericValue, setNumericValue] = useState("");
  const [ratingValue, setRatingValue] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<ConfidenceValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const accessKey = `openround:followup-access:${id}`;
    const attemptKey = `openround:followup-attempt:${id}`;
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    if (fragmentToken) {
      sessionStorage.setItem(accessKey, fragmentToken);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    const accessToken = fragmentToken || sessionStorage.getItem(accessKey) || "";
    const savedAttemptToken = sessionStorage.getItem(attemptKey) || "";

    const start = async () => {
      if (!accessToken) {
        throw new Error(
          "This follow-up link is missing its private access token. Ask the facilitator for a new link.",
        );
      }
      const clientAttemptToken = `${clientUuid()}${clientUuid()}`;
      const result = await followupFetch<{
        attemptToken: string;
        snapshot: FollowupSnapshot;
      }>(`/v1/followups/${id}/start`, accessToken, {
        method: "POST",
        body: JSON.stringify({ attemptToken: clientAttemptToken }),
      });
      sessionStorage.setItem(attemptKey, result.attemptToken);
      return result;
    };

    const load = async () => {
      try {
        let result: { attemptToken: string; snapshot: FollowupSnapshot };
        if (savedAttemptToken) {
          try {
            const resumed = await followupFetch<{ snapshot: FollowupSnapshot }>(
              `/v1/followups/${id}/snapshot`,
              savedAttemptToken,
            );
            result = { attemptToken: savedAttemptToken, snapshot: resumed.snapshot };
          } catch (caught) {
            if (!shouldReplaceSavedAttempt(caught)) throw caught;
            sessionStorage.removeItem(attemptKey);
            result = await start();
          }
        } else result = await start();
        if (!cancelled) {
          setAttemptToken(result.attemptToken);
          setSnapshot(result.snapshot);
          setError("");
        }
      } catch (caught) {
        if (!cancelled) setError(humanError(caught));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    setSelectedChoiceIds([]);
    setNumericValue("");
    setRatingValue(null);
    setConfidence(null);
  }, [snapshot?.question?.id]);

  function chooseChoice(choiceId: string) {
    if (!snapshot?.question || snapshot.phase !== "question_open" || busy) return;
    if (snapshot.question.type === "multi_select") {
      setSelectedChoiceIds((current) =>
        current.includes(choiceId)
          ? current.filter((selected) => selected !== choiceId)
          : [...current, choiceId],
      );
    } else setSelectedChoiceIds([choiceId]);
  }

  function response(): ResponsePayload | null {
    const question = snapshot?.question;
    if (!question) return null;
    if (["single_select", "true_false", "multi_select"].includes(question.type)) {
      return selectedChoiceIds.length ? { kind: "choice", choiceIds: selectedChoiceIds } : null;
    }
    if (question.type === "poll") {
      return selectedChoiceIds.length === 1 ? { kind: "poll", choiceIds: selectedChoiceIds } : null;
    }
    if (question.type === "numeric") {
      return numericValue.trim()
        ? { kind: "numeric", value: numericValue, unit: question.unit ?? undefined }
        : null;
    }
    return ratingValue === null ? null : { kind: "rating", value: ratingValue };
  }

  async function submit() {
    const answer = response();
    if (!snapshot?.question || !answer || !attemptToken) {
      setError("Complete the response before submitting.");
      return;
    }
    if (snapshot.question.confidence === "required" && confidence === null) {
      setError("Choose how sure you are before submitting.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await followupFetch<{ snapshot: FollowupSnapshot }>(
        `/v1/followups/${id}/answers`,
        attemptToken,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: `${snapshot.attemptId}:${snapshot.question.id}:${clientUuid()}`,
            response: answer,
            ...(confidence === null ? {} : { confidence }),
          }),
        },
      );
      setSnapshot(result.snapshot);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    if (!attemptToken) return;
    setBusy(true);
    setError("");
    try {
      const result = await followupFetch<{ snapshot: FollowupSnapshot }>(
        `/v1/followups/${id}/advance`,
        attemptToken,
        { method: "POST", body: "{}" },
      );
      setSnapshot(result.snapshot);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  const displayedChoiceIds =
    snapshot?.response?.kind === "choice" || snapshot?.response?.kind === "poll"
      ? snapshot.response.choiceIds
      : selectedChoiceIds;
  const revealed = snapshot?.phase === "answer_reveal";

  return (
    <div className="live-shell">
      <header className="shell live-topbar">
        <Brand inverted />
        {snapshot ? (
          <span className="status-pill">
            {snapshot.timeMode === "flex" ? "No countdown" : `${snapshot.timeMultiplier}× time`}
          </span>
        ) : null}
      </header>
      <main className="shell live-stage" aria-live="polite">
        {error ? (
          <section className="live-card">
            <p className="error" role="alert">
              {error}
            </p>
            {!snapshot ? (
              <Link className="button-quiet" href="/">
                Return home
              </Link>
            ) : null}
          </section>
        ) : null}
        {!snapshot && !error ? (
          <section className="live-card">
            <p>Opening your private follow-up…</p>
          </section>
        ) : null}
        {snapshot?.status === "completed" ? (
          <section className="live-card">
            <p className="eyebrow">Follow-up complete</p>
            <h1>Thanks for checking your understanding.</h1>
            <p className="lead">Your responses were saved without creating an account.</p>
          </section>
        ) : null}
        {snapshot?.question && snapshot.status === "in_progress" ? (
          <section className="live-card">
            <div className="page-heading" style={{ alignItems: "center", marginBottom: 20 }}>
              <span className="status-pill">
                Checkpoint {(snapshot.questionIndex ?? 0) + 1} of {snapshot.questionCount}
              </span>
              {snapshot.phase === "question_open" && snapshot.deadline ? (
                <Countdown deadline={snapshot.deadline} />
              ) : null}
            </div>
            <p className="eyebrow">{snapshot.title}</p>
            <h1 style={{ fontSize: "clamp(2rem, 7vw, 4rem)" }}>{snapshot.question.prompt}</h1>
            <QuestionMedia
              altText={snapshot.question.mediaAlt}
              credential={attemptToken}
              mediaId={snapshot.question.mediaId}
              mode="followup"
              sessionId={id}
            />
            {["single_select", "true_false", "multi_select", "poll"].includes(
              snapshot.question.type,
            ) ? (
              <div className="answer-grid" aria-label="Response choices">
                {snapshot.question.choices.map((choice, index) => {
                  const selected = displayedChoiceIds.includes(choice.id);
                  const correct =
                    revealed &&
                    snapshot.correctResponse?.kind === "choice" &&
                    snapshot.correctResponse.choiceIds.includes(choice.id);
                  return (
                    <button
                      aria-pressed={selected}
                      className="answer-button"
                      data-correct={correct || undefined}
                      data-incorrect={(revealed && selected && !correct) || undefined}
                      data-selected={selected || undefined}
                      disabled={snapshot.phase !== "question_open" || busy}
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
                  disabled={snapshot.phase !== "question_open" || busy}
                  inputMode="decimal"
                  onChange={(event) => setNumericValue(event.target.value)}
                  value={
                    snapshot.response?.kind === "numeric" ? snapshot.response.value : numericValue
                  }
                />
              </label>
            ) : snapshot.question.rating ? (
              <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                <legend className="field-label">Choose a rating</legend>
                <div className="answer-grid">
                  {Array.from(
                    { length: snapshot.question.rating.max - snapshot.question.rating.min + 1 },
                    (_, index) => snapshot.question!.rating!.min + index,
                  ).map((value) => (
                    <button
                      aria-pressed={ratingValue === value}
                      className="answer-button"
                      data-selected={ratingValue === value || undefined}
                      disabled={snapshot.phase !== "question_open" || busy}
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
            {snapshot.question.confidence !== "off" && snapshot.phase === "question_open" ? (
              <fieldset className="field" style={{ border: 0, padding: 0 }}>
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
            {snapshot.phase === "question_open" ? (
              <button
                className="button"
                disabled={busy}
                onClick={() => void submit()}
                type="button"
              >
                {busy ? "Saving…" : "Submit response"}
              </button>
            ) : null}
            {revealed ? (
              <div className={snapshot.correct === true ? "success" : "notice"}>
                <strong>
                  {snapshot.question.purpose === "opinion"
                    ? "Response recorded"
                    : snapshot.correct
                      ? "Correct"
                      : "Review this checkpoint"}
                </strong>
                {snapshot.explanation ? <div>{snapshot.explanation}</div> : null}
                {snapshot.feedback ? <div>{snapshot.feedback}</div> : null}
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void advance()}
                  style={{ marginTop: 16 }}
                  type="button"
                >
                  {snapshot.questionIndex === snapshot.questionCount - 1
                    ? "Finish follow-up"
                    : "Next checkpoint"}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
