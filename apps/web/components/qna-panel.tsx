"use client";

import { useCallback, useEffect, useState } from "react";
import type { QnaPage, QnaQuestion, QnaSettings } from "@openround/contracts";
import { apiFetch, humanError } from "../lib/api";
import { useLocale } from "./locale-provider";

type QnaPanelProps = {
  role: "participant" | "moderator";
  sessionId: string;
  token: string;
  revision: number;
};

export function QnaPanel({ role, sessionId, token, revision }: QnaPanelProps) {
  const { t } = useLocale();
  const [page, setPage] = useState<QnaPage | null>(null);
  const [questionBody, setQuestionBody] = useState("");
  const [replyBodies, setReplyBodies] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const statusLabel = (status: QnaQuestion["status"]) => t(`live.qna.status.${status}`);

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
        ? t("live.qna.questionSentForReview")
        : t("live.qna.questionShared"),
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
      role === "moderator" ? t("live.qna.replyPublished") : t("live.qna.replySubmitted"),
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
          <p className="eyebrow">{t("live.qna.eyebrow")}</p>
          <h2 id={`qna-heading-${role}`}>{t("live.qna.title")}</h2>
        </div>
        <button className="button-quiet small-button" onClick={() => void load()} type="button">
          {t("live.qna.refresh")}
        </button>
      </div>

      {error ? (
        <p className="error" lang="en-CA" role="alert">
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
          <legend>{t("live.qna.controls")}</legend>
          <label className="checkbox-field">
            <input
              checked={settings.enabled}
              onChange={(event) => void updateSettings({ enabled: event.target.checked })}
              type="checkbox"
            />
            {t("live.qna.enable")}
          </label>
          <label className="field qna-setting-field">
            <span className="field-label">{t("live.qna.publicNames")}</span>
            <select
              className="select"
              onChange={(event) =>
                void updateSettings({
                  displayMode: event.target.value as QnaSettings["displayMode"],
                })
              }
              value={settings.displayMode}
            >
              <option value="anonymous_public">{t("live.qna.anonymousToParticipants")}</option>
              <option value="alias_public">{t("live.qna.showAliases")}</option>
            </select>
          </label>
          <label className="field qna-setting-field">
            <span className="field-label">{t("live.qna.moderation")}</span>
            <select
              className="select"
              onChange={(event) =>
                void updateSettings({
                  moderationMode: event.target.value as QnaSettings["moderationMode"],
                })
              }
              value={settings.moderationMode}
            >
              <option value="pre">{t("live.qna.reviewBeforePublishing")}</option>
              <option value="post">{t("live.qna.publishImmediately")}</option>
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
            {t("live.qna.allowParticipantReplies")}
          </label>
        </fieldset>
      ) : null}

      {role === "participant" && settings?.enabled ? (
        <form className="qna-compose" onSubmit={(event) => void submitQuestion(event)}>
          <label className="field" htmlFor="qna-question-body">
            <span className="field-label">{t("live.qna.askFacilitator")}</span>
            <textarea
              className="textarea"
              id="qna-question-body"
              maxLength={1_000}
              onChange={(event) => setQuestionBody(event.target.value)}
              placeholder={t("live.qna.questionPlaceholder")}
              value={questionBody}
            />
          </label>
          <div className="button-row">
            <button
              className="button"
              disabled={busyKey === "new-question" || !questionBody.trim()}
              type="submit"
            >
              {busyKey === "new-question" ? t("live.qna.sending") : t("live.qna.askQuestion")}
            </button>
            <small className="muted">
              {settings.moderationMode === "pre"
                ? t("live.qna.reviewNotice")
                : t("live.qna.immediateNotice")}
            </small>
          </div>
        </form>
      ) : role === "participant" && settings ? (
        <p className="notice">{t("live.qna.paused")}</p>
      ) : null}

      {!page ? <p className="muted">{t("live.qna.loading")}</p> : null}
      {page && visibleQuestions.length === 0 ? (
        <p className="qna-empty">{t("live.qna.empty")}</p>
      ) : null}
      <ol className="qna-list">
        {visibleQuestions.map((question) => (
          <li className="qna-question" key={question.id}>
            <div className="qna-question-meta">
              <span>
                <strong lang="">{question.author.displayName}</strong> ·{" "}
                {statusLabel(question.status)}
              </span>
              <span>{t("live.qna.votes", { count: question.voteCount })}</span>
            </div>
            <p className="qna-question-body" lang="">
              {question.body}
            </p>
            {question.label ? (
              <span className="status-pill" lang="">
                {question.label}
              </span>
            ) : null}

            {role === "participant" && ["published", "answered"].includes(question.status) ? (
              <button
                aria-pressed={question.votedByMe}
                className="button-quiet small-button"
                disabled={busyKey === `vote:${question.id}`}
                onClick={() => void setVote(question)}
                type="button"
              >
                {question.votedByMe ? t("live.qna.removeVote") : t("live.qna.sameQuestion")}
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
                    {t("live.qna.publish")}
                  </button>
                ) : null}
                {!["dismissed", "removed"].includes(question.status) ? (
                  <button
                    className="button-quiet small-button"
                    disabled={busyKey === `moderate:${question.id}`}
                    onClick={() => void moderate(question, "dismissed")}
                    type="button"
                  >
                    {t("live.qna.dismiss")}
                  </button>
                ) : null}
                {question.status !== "removed" ? (
                  <button
                    className="button-danger small-button"
                    disabled={busyKey === `moderate:${question.id}`}
                    onClick={() => void moderate(question, "removed")}
                    type="button"
                  >
                    {t("live.qna.remove")}
                  </button>
                ) : null}
                {question.moderationParticipantId && question.status !== "removed" ? (
                  <button
                    className="button-danger small-button"
                    disabled={busyKey === `moderate:${question.id}`}
                    onClick={() =>
                      window.confirm(t("live.qna.removeAndBlockConfirm")) &&
                      void moderate(question, "removed", true)
                    }
                    type="button"
                  >
                    {t("live.qna.removeAndBlock")}
                  </button>
                ) : null}
              </div>
            ) : null}

            {question.replies.length > 0 ? (
              <ul className="qna-replies" aria-label={t("live.qna.replies")}>
                {question.replies.map((reply) => (
                  <li key={reply.id}>
                    <p>
                      <strong lang="">{reply.author.displayName}</strong> ·{" "}
                      <span lang="">{reply.body}</span>
                    </p>
                    {role === "moderator" && reply.status === "pending" ? (
                      <div className="button-row">
                        <button
                          className="button-quiet small-button"
                          disabled={busyKey === `moderate-reply:${reply.id}`}
                          onClick={() => void moderateReply(reply.id, "published")}
                          type="button"
                        >
                          {t("live.qna.publishReply")}
                        </button>
                        <button
                          className="button-danger small-button"
                          disabled={busyKey === `moderate-reply:${reply.id}`}
                          onClick={() => void moderateReply(reply.id, "removed")}
                          type="button"
                        >
                          {t("live.qna.removeReply")}
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
                    {role === "moderator" ? t("live.qna.facilitatorReply") : t("live.qna.addReply")}
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
                  {t("live.qna.reply")}
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
          {t("live.qna.loadOlder")}
        </button>
      ) : null}
    </section>
  );
}
