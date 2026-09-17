"use client";

import { useCallback, useEffect, useState } from "react";
import type { QnaPage, QnaQuestion, QnaSettings } from "@openround/contracts";
import { apiFetch, humanError } from "../lib/api";

type QnaPanelProps = {
  role: "participant" | "moderator";
  sessionId: string;
  token: string;
  revision: number;
};

function statusLabel(status: QnaQuestion["status"]) {
  if (status === "pending") return "Awaiting review";
  if (status === "published") return "Open";
  if (status === "answered") return "Answered";
  if (status === "dismissed") return "Dismissed";
  return "Removed";
}

export function QnaPanel({ role, sessionId, token, revision }: QnaPanelProps) {
  const [page, setPage] = useState<QnaPage | null>(null);
  const [questionBody, setQuestionBody] = useState("");
  const [replyBodies, setReplyBodies] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const request = useCallback(
    <T,>(path: string, init: RequestInit = {}) =>
      apiFetch<T>(path, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      }),
    [token],
  );

  const load = useCallback(
    async (cursor?: string, append = false) => {
      if (!token) return;
      try {
        const query = new URLSearchParams({ limit: "30" });
        if (cursor) query.set("cursor", cursor);
        const loaded = await request<QnaPage>(
          `/v1/sessions/${sessionId}/qna/questions?${query.toString()}`,
        );
        setPage((current) =>
          append && current
            ? { ...loaded, questions: [...current.questions, ...loaded.questions] }
            : loaded,
        );
        setError("");
      } catch (caught) {
        setError(humanError(caught));
      }
    },
    [request, sessionId, token],
  );

  useEffect(() => {
    void load();
  }, [load, revision]);

  async function perform(key: string, action: () => Promise<unknown>, success = "") {
    setBusyKey(key);
    setError("");
    setNotice("");
    try {
      await action();
      if (success) setNotice(success);
      await load();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusyKey("");
    }
  }

  async function submitQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = questionBody.trim();
    if (!body) return;
    await perform(
      "new-question",
      async () => {
        await request(`/v1/sessions/${sessionId}/qna/questions`, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
        setQuestionBody("");
      },
      page?.settings.moderationMode === "pre"
        ? "Question sent for facilitator review."
        : "Question shared with the room.",
    );
  }

  async function submitReply(questionId: string) {
    const body = replyBodies[questionId]?.trim();
    if (!body) return;
    await perform(
      `reply:${questionId}`,
      async () => {
        await request(`/v1/sessions/${sessionId}/qna/questions/${questionId}/replies`, {
          method: "POST",
          body: JSON.stringify({ body }),
        });
        setReplyBodies((current) => ({ ...current, [questionId]: "" }));
      },
      role === "moderator" ? "Reply published." : "Reply submitted.",
    );
  }

  async function setVote(question: QnaQuestion) {
    await perform(`vote:${question.id}`, () =>
      request(`/v1/sessions/${sessionId}/qna/questions/${question.id}/vote`, {
        method: question.votedByMe ? "DELETE" : "POST",
      }),
    );
  }

  async function moderate(
    question: QnaQuestion,
    status: QnaQuestion["status"],
    banParticipant = false,
  ) {
    await perform(`moderate:${question.id}`, () =>
      request(`/v1/sessions/${sessionId}/qna/questions/${question.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, label: question.label, banParticipant }),
      }),
    );
  }

  async function moderateReply(replyId: string, status: "pending" | "published" | "removed") {
    await perform(`moderate-reply:${replyId}`, () =>
      request(`/v1/sessions/${sessionId}/qna/replies/${replyId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    );
  }

  async function updateSettings(update: Partial<QnaSettings>) {
    await perform("settings", async () => {
      const settings = await request<QnaSettings>(`/v1/sessions/${sessionId}/qna/settings`, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      setPage((current) => (current ? { ...current, settings } : current));
    });
  }

  const settings = page?.settings;
  const visibleQuestions = page?.questions ?? [];

  return (
    <section className="panel qna-panel" aria-labelledby={`qna-heading-${role}`}>
      <div className="qna-heading">
        <div>
          <p className="eyebrow">Audience voice</p>
          <h2 id={`qna-heading-${role}`}>Questions and answers</h2>
        </div>
        <button className="button-quiet small-button" onClick={() => void load()} type="button">
          Refresh
        </button>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="success" role="status">
          {notice}
        </p>
      ) : null}

      {role === "moderator" && settings ? (
        <fieldset className="qna-settings" disabled={busyKey === "settings"}>
          <legend>Q&amp;A controls</legend>
          <label className="checkbox-field">
            <input
              checked={settings.enabled}
              onChange={(event) => void updateSettings({ enabled: event.target.checked })}
              type="checkbox"
            />
            Enable Q&amp;A
          </label>
          <label className="field qna-setting-field">
            <span className="field-label">Public names</span>
            <select
              className="select"
              onChange={(event) =>
                void updateSettings({
                  displayMode: event.target.value as QnaSettings["displayMode"],
                })
              }
              value={settings.displayMode}
            >
              <option value="anonymous_public">Anonymous to participants</option>
              <option value="alias_public">Show participant aliases</option>
            </select>
          </label>
          <label className="field qna-setting-field">
            <span className="field-label">Moderation</span>
            <select
              className="select"
              onChange={(event) =>
                void updateSettings({
                  moderationMode: event.target.value as QnaSettings["moderationMode"],
                })
              }
              value={settings.moderationMode}
            >
              <option value="pre">Review before publishing</option>
              <option value="post">Publish immediately</option>
            </select>
          </label>
          <label className="checkbox-field">
            <input
              checked={settings.participantReplies}
              onChange={(event) =>
                void updateSettings({ participantReplies: event.target.checked })
              }
              type="checkbox"
            />
            Allow participant replies
          </label>
        </fieldset>
      ) : null}

      {role === "participant" && settings?.enabled ? (
        <form className="qna-compose" onSubmit={(event) => void submitQuestion(event)}>
          <label className="field" htmlFor="qna-question-body">
            <span className="field-label">Ask the facilitator</span>
            <textarea
              className="textarea"
              id="qna-question-body"
              maxLength={1_000}
              onChange={(event) => setQuestionBody(event.target.value)}
              placeholder="What would help you understand this better?"
              value={questionBody}
            />
          </label>
          <div className="button-row">
            <button
              className="button"
              disabled={busyKey === "new-question" || !questionBody.trim()}
              type="submit"
            >
              {busyKey === "new-question" ? "Sending…" : "Ask question"}
            </button>
            <small className="muted">
              {settings.moderationMode === "pre"
                ? "The facilitator reviews questions before the room sees them."
                : "Questions appear to the room immediately."}
            </small>
          </div>
        </form>
      ) : role === "participant" && settings ? (
        <p className="notice">The facilitator has paused Q&amp;A for this round.</p>
      ) : null}

      {!page ? <p className="muted">Loading audience questions…</p> : null}
      {page && visibleQuestions.length === 0 ? (
        <p className="qna-empty">No audience questions yet.</p>
      ) : null}
      <ol className="qna-list">
        {visibleQuestions.map((question) => (
          <li className="qna-question" key={question.id}>
            <div className="qna-question-meta">
              <span>
                <strong>{question.author.displayName}</strong> · {statusLabel(question.status)}
              </span>
              <span>{question.voteCount} votes</span>
            </div>
            <p className="qna-question-body">{question.body}</p>
            {question.label ? <span className="status-pill">{question.label}</span> : null}

            {role === "participant" && ["published", "answered"].includes(question.status) ? (
              <button
                aria-pressed={question.votedByMe}
                className="button-quiet small-button"
                disabled={busyKey === `vote:${question.id}`}
                onClick={() => void setVote(question)}
                type="button"
              >
                {question.votedByMe ? "Remove vote" : "I have this question"}
              </button>
            ) : null}

            {role === "moderator" ? (
              <div className="button-row qna-moderation-actions">
                {question.status === "pending" ? (
                  <button
                    className="button small-button"
                    disabled={busyKey === `moderate:${question.id}`}
                    onClick={() => void moderate(question, "published")}
                    type="button"
                  >
                    Publish
                  </button>
                ) : null}
                {!["dismissed", "removed"].includes(question.status) ? (
                  <button
                    className="button-quiet small-button"
                    disabled={busyKey === `moderate:${question.id}`}
                    onClick={() => void moderate(question, "dismissed")}
                    type="button"
                  >
                    Dismiss
                  </button>
                ) : null}
                {question.status !== "removed" ? (
                  <button
                    className="button-danger small-button"
                    disabled={busyKey === `moderate:${question.id}`}
                    onClick={() => void moderate(question, "removed")}
                    type="button"
                  >
                    Remove
                  </button>
                ) : null}
                {question.moderationParticipantId && question.status !== "removed" ? (
                  <button
                    className="button-danger small-button"
                    disabled={busyKey === `moderate:${question.id}`}
                    onClick={() =>
                      window.confirm("Remove this question and block this participant from Q&A?") &&
                      void moderate(question, "removed", true)
                    }
                    type="button"
                  >
                    Remove and block
                  </button>
                ) : null}
              </div>
            ) : null}

            {question.replies.length > 0 ? (
              <ul className="qna-replies" aria-label="Replies">
                {question.replies.map((reply) => (
                  <li key={reply.id}>
                    <p>
                      <strong>{reply.author.displayName}</strong> · {reply.body}
                    </p>
                    {role === "moderator" && reply.status === "pending" ? (
                      <div className="button-row">
                        <button
                          className="button-quiet small-button"
                          disabled={busyKey === `moderate-reply:${reply.id}`}
                          onClick={() => void moderateReply(reply.id, "published")}
                          type="button"
                        >
                          Publish reply
                        </button>
                        <button
                          className="button-danger small-button"
                          disabled={busyKey === `moderate-reply:${reply.id}`}
                          onClick={() => void moderateReply(reply.id, "removed")}
                          type="button"
                        >
                          Remove reply
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {(role === "moderator" ||
              (settings?.participantReplies &&
                ["published", "answered"].includes(question.status))) &&
            question.status !== "removed" ? (
              <div className="qna-reply-compose">
                <label className="field" htmlFor={`qna-reply-${question.id}`}>
                  <span className="field-label">
                    {role === "moderator" ? "Facilitator reply" : "Add a reply"}
                  </span>
                  <textarea
                    className="textarea"
                    id={`qna-reply-${question.id}`}
                    maxLength={1_000}
                    onChange={(event) =>
                      setReplyBodies((current) => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))
                    }
                    value={replyBodies[question.id] ?? ""}
                  />
                </label>
                <button
                  className="button-quiet small-button"
                  disabled={busyKey === `reply:${question.id}` || !replyBodies[question.id]?.trim()}
                  onClick={() => void submitReply(question.id)}
                  type="button"
                >
                  Reply
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {page?.nextCursor ? (
        <button
          className="button-quiet"
          onClick={() => void load(page.nextCursor ?? undefined, true)}
          type="button"
        >
          Load older questions
        </button>
      ) : null}
    </section>
  );
}
