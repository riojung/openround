"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Choice, Entitlements, Question, QuestionType, QuizDraft } from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { apiFetch, humanError } from "../../../lib/api";
import { clientUuid } from "../../../lib/uuid";

interface QuizRecord {
  id: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
  currentVersionId: string | null;
}

function newChoices(type: QuestionType): Choice[] {
  return type === "true_false"
    ? [
        { id: clientUuid(), label: "True", isCorrect: true },
        { id: clientUuid(), label: "False", isCorrect: false },
      ]
    : [
        { id: clientUuid(), label: "", isCorrect: true },
        { id: clientUuid(), label: "", isCorrect: false },
        { id: clientUuid(), label: "", isCorrect: false },
        { id: clientUuid(), label: "", isCorrect: false },
      ];
}

function newQuestion(type: QuestionType): Question {
  return {
    id: clientUuid(),
    type,
    prompt: "",
    choices: newChoices(type),
    timeLimitSeconds: 20,
    basePoints: 1_000,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
}

export default function QuizEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quiz, setQuiz] = useState<QuizRecord | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [publishedQuizCount, setPublishedQuizCount] = useState(0);
  const [draft, setDraft] = useState<QuizDraft | null>(null);
  const [selected, setSelected] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [mediaUploadsEnabled, setMediaUploadsEnabled] = useState(false);
  const [mediaState, setMediaState] = useState<"idle" | "uploading" | "scanning">("idle");
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const loaded = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const latestSaveRevision = useRef(0);
  const selectedMediaId = draft?.questions[selected]?.mediaId ?? null;

  const enqueueSave = useCallback(
    (candidate: QuizDraft) => {
      const request = saveQueue.current.then(() =>
        apiFetch<{ quiz: QuizRecord }>(`/v1/quizzes/${id}`, {
          method: "PATCH",
          body: JSON.stringify(candidate),
        }),
      );
      saveQueue.current = request.then(
        () => undefined,
        () => undefined,
      );
      return request;
    },
    [id],
  );

  useEffect(() => {
    apiFetch<{ mediaUploads: boolean }>("/v1/features")
      .then(({ mediaUploads }) => setMediaUploadsEnabled(mediaUploads))
      .catch(() => setMediaUploadsEnabled(false));
  }, []);

  useEffect(() => {
    loaded.current = false;
    latestSaveRevision.current += 1;
    let active = true;
    Promise.all([
      apiFetch<{ quiz: QuizRecord }>(`/v1/quizzes/${id}`),
      apiFetch<{ entitlements: Entitlements }>("/v1/auth/me"),
      apiFetch<{ quizzes: QuizRecord[] }>("/v1/quizzes"),
    ])
      .then(([{ quiz: loadedQuiz }, account, library]) => {
        if (!active) return;
        setQuiz(loadedQuiz);
        setDraft(loadedQuiz.draft);
        setEntitlements(account.entitlements);
        setPublishedQuizCount(
          library.quizzes.filter((candidate) => candidate.status === "published").length,
        );
        loaded.current = true;
      })
      .catch((caught) => {
        if (!active) return;
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
    return () => {
      active = false;
    };
  }, [id, router]);

  useEffect(() => {
    if (!loaded.current || !draft) return;
    const revision = ++latestSaveRevision.current;
    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      void enqueueSave(draft)
        .then(({ quiz: saved }) => {
          if (revision !== latestSaveRevision.current) return;
          setQuiz(saved);
          setSaveState("saved");
        })
        .catch((caught) => {
          if (revision !== latestSaveRevision.current) return;
          setError(humanError(caught));
          setSaveState("error");
        });
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [draft, enqueueSave]);

  useEffect(() => {
    if (!selectedMediaId) {
      setMediaPreviewUrl("");
      return;
    }
    let active = true;
    apiFetch<{ downloadUrl: string }>(`/v1/media/${selectedMediaId}`)
      .then(({ downloadUrl }) => {
        if (active) setMediaPreviewUrl(downloadUrl);
      })
      .catch(() => {
        if (active) setMediaPreviewUrl("");
      });
    return () => {
      active = false;
    };
  }, [selectedMediaId]);

  function updateQuestion(updater: (question: Question) => Question) {
    setDraft((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((question, index) =>
              index === selected ? updater(question) : question,
            ),
          }
        : current,
    );
  }

  function addQuestion(type: QuestionType) {
    if (!draft) return;
    const next = [...draft.questions, newQuestion(type)];
    setDraft({ ...draft, questions: next });
    setSelected(next.length - 1);
  }

  function removeQuestion() {
    if (!draft) return;
    const next = draft.questions.filter((_, index) => index !== selected);
    setDraft({ ...draft, questions: next });
    setSelected(Math.max(0, selected - 1));
  }

  function duplicateQuestion() {
    if (!draft) return;
    const question = draft.questions[selected];
    if (!question) return;
    const copy = {
      ...question,
      id: clientUuid(),
      choices: question.choices.map((choice) => ({ ...choice, id: clientUuid() })),
    };
    const next = [...draft.questions];
    next.splice(selected + 1, 0, copy);
    setDraft({ ...draft, questions: next });
    setSelected(selected + 1);
  }

  function moveQuestion(direction: -1 | 1) {
    if (!draft) return;
    const target = selected + direction;
    if (target < 0 || target >= draft.questions.length) return;
    const next = [...draft.questions];
    [next[selected], next[target]] = [next[target]!, next[selected]!];
    setDraft({ ...draft, questions: next });
    setSelected(target);
  }

  async function publish() {
    if (!draft || saveState === "saving" || publishLimitReached) return;
    setError("");
    const revision = ++latestSaveRevision.current;
    setSaveState("saving");
    try {
      const { quiz: saved } = await enqueueSave(draft);
      if (revision === latestSaveRevision.current) setQuiz(saved);
      const published = await apiFetch<{ version: { id: string } }>(`/v1/quizzes/${id}/publish`, {
        method: "POST",
        body: "{}",
      });
      setQuiz((current) =>
        current
          ? { ...current, status: "published", currentVersionId: published.version.id }
          : current,
      );
      if (!quiz?.currentVersionId) setPublishedQuizCount((count) => count + 1);
      if (revision === latestSaveRevision.current) setSaveState("saved");
    } catch (caught) {
      setError(humanError(caught));
      if (revision === latestSaveRevision.current) setSaveState("error");
    }
  }

  async function openPreview() {
    if (!draft || saveState === "saving") return;
    setError("");
    const revision = ++latestSaveRevision.current;
    setSaveState("saving");
    try {
      const { quiz: saved } = await enqueueSave(draft);
      if (revision === latestSaveRevision.current) {
        setQuiz(saved);
        setSaveState("saved");
      }
      router.push(`/quiz/${id}/preview`);
    } catch (caught) {
      setError(humanError(caught));
      if (revision === latestSaveRevision.current) setSaveState("error");
    }
  }

  async function uploadQuestionImage(file: File | null) {
    if (!file || !draft || mediaState !== "idle") return;
    const current = draft.questions[selected];
    const altText = current?.mediaAlt?.trim();
    if (!current || !altText) {
      setError("Describe the instructional image before uploading it.");
      return;
    }
    const questionId = current.id;
    setError("");
    setMediaState("uploading");
    try {
      const ticket = await apiFetch<{
        mediaId: string;
        uploadUrl: string;
        scanStatus: "pending";
      }>("/v1/media", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          altText,
        }),
      });
      const uploaded = await fetch(ticket.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!uploaded.ok) throw new Error(`Image upload failed (${uploaded.status})`);
      setMediaState("scanning");
      const finalized = await apiFetch<{
        media: { id: string; scanStatus: "clean" | "rejected"; altText: string };
        downloadUrl?: string;
      }>(`/v1/media/${ticket.mediaId}/complete`, { method: "POST", body: "{}" });
      if (finalized.media.scanStatus !== "clean" || !finalized.downloadUrl) {
        throw new Error("The image did not pass security validation.");
      }
      setDraft((latest) =>
        latest
          ? {
              ...latest,
              questions: latest.questions.map((question) =>
                question.id === questionId
                  ? { ...question, mediaId: ticket.mediaId, mediaAlt: altText }
                  : question,
              ),
            }
          : latest,
      );
      setMediaPreviewUrl(finalized.downloadUrl);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setMediaState("idle");
    }
  }

  const question = draft?.questions[selected];
  const publishLimitReached = Boolean(
    quiz &&
    !quiz.currentVersionId &&
    entitlements?.maxPublishedQuizzes !== null &&
    entitlements?.maxPublishedQuizzes !== undefined &&
    publishedQuizCount >= entitlements.maxPublishedQuizzes,
  );

  return (
    <>
      <header className="shell topbar">
        <Brand />
        <div className="button-row">
          <span className="muted" role="status">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Save failed"
                  : ""}
          </span>
          <Link className="button-quiet small-button" href="/dashboard">
            Dashboard
          </Link>
          <button
            className="button-quiet small-button"
            disabled={!draft?.questions.length || saveState === "saving"}
            onClick={() => void openPreview()}
            type="button"
          >
            Preview
          </button>
          <button
            className="button small-button"
            disabled={!draft?.questions.length || saveState === "saving" || publishLimitReached}
            onClick={() => void publish()}
            type="button"
          >
            {publishLimitReached ? "Publish limit reached" : "Publish"}
          </button>
        </div>
      </header>
      <main className="shell page-main" id="main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">Quiz editor</p>
            <h1 style={{ fontSize: "clamp(2.4rem, 6vw, 4rem)" }}>
              {draft?.title || "Untitled quiz"}
            </h1>
          </div>
          {quiz ? <span className="status-pill">{quiz.status}</span> : null}
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {publishLimitReached ? (
          <p className="notice">
            This plan&apos;s {entitlements?.maxPublishedQuizzes} published quiz slots are in use.
            Archive a published quiz or compare plans before publishing this draft.
          </p>
        ) : null}
        {!draft ? (
          <p>Loading editor…</p>
        ) : (
          <>
            <section className="panel" style={{ marginBottom: 22 }}>
              <div className="field">
                <label htmlFor="quiz-title">Title</label>
                <input
                  className="input"
                  id="quiz-title"
                  maxLength={160}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  value={draft.title}
                />
              </div>
              <div className="field">
                <label htmlFor="quiz-description">Description</label>
                <textarea
                  className="textarea"
                  id="quiz-description"
                  maxLength={1000}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  value={draft.description}
                />
              </div>
            </section>
            <div className="editor-layout">
              <aside className="panel">
                <h2 style={{ fontSize: "1.4rem" }}>Questions</h2>
                <div className="question-list">
                  {draft.questions.map((item, index) => (
                    <button
                      aria-current={index === selected}
                      className="question-tab"
                      key={item.id}
                      onClick={() => setSelected(index)}
                      type="button"
                    >
                      <strong>{index + 1}.</strong> {item.prompt || "Untitled question"}
                    </button>
                  ))}
                </div>
                <div className="button-row" style={{ marginTop: 16 }}>
                  <button
                    className="button-quiet small-button"
                    disabled={!draft}
                    onClick={() => addQuestion("single_select")}
                    type="button"
                  >
                    Add multiple choice
                  </button>
                  <button
                    className="button-quiet small-button"
                    disabled={!draft}
                    onClick={() => addQuestion("true_false")}
                    type="button"
                  >
                    Add true or false
                  </button>
                </div>
              </aside>
              <section className="panel" aria-label="Selected question editor">
                {!question ? (
                  <div>
                    <h2 style={{ fontSize: "1.7rem" }}>Add the first question</h2>
                    <p className="muted">Choose one of the two focused launch formats.</p>
                  </div>
                ) : (
                  <>
                    <div
                      className="toolbar"
                      style={{ justifyContent: "space-between", marginBottom: 22 }}
                    >
                      <span className="status-pill">
                        {question.type === "true_false" ? "True or false" : "Single select"}
                      </span>
                      <div className="button-row">
                        <button
                          className="button-quiet small-button"
                          disabled={selected === 0}
                          onClick={() => moveQuestion(-1)}
                          type="button"
                        >
                          Move up
                        </button>
                        <button
                          className="button-quiet small-button"
                          disabled={selected === draft.questions.length - 1}
                          onClick={() => moveQuestion(1)}
                          type="button"
                        >
                          Move down
                        </button>
                        <button
                          className="button-quiet small-button"
                          onClick={duplicateQuestion}
                          type="button"
                        >
                          Duplicate
                        </button>
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor="prompt">Question</label>
                      <textarea
                        className="textarea"
                        id="prompt"
                        maxLength={500}
                        onChange={(event) =>
                          updateQuestion((item) => ({ ...item, prompt: event.target.value }))
                        }
                        value={question.prompt}
                      />
                    </div>
                    <div className="media-editor">
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label htmlFor="media-alt">Optional instructional image</label>
                        <input
                          className="input"
                          id="media-alt"
                          maxLength={300}
                          onChange={(event) =>
                            updateQuestion((item) => ({
                              ...item,
                              mediaAlt: event.target.value || null,
                            }))
                          }
                          placeholder="Describe what the image teaches"
                          value={question.mediaAlt ?? ""}
                        />
                        <input
                          accept="image/jpeg,image/png,image/webp"
                          aria-describedby="media-help"
                          disabled={!mediaUploadsEnabled || mediaState !== "idle"}
                          onChange={(event) => {
                            void uploadQuestionImage(event.target.files?.[0] ?? null);
                            event.currentTarget.value = "";
                          }}
                          type="file"
                        />
                        <small className="muted" id="media-help">
                          {mediaUploadsEnabled
                            ? "JPEG, PNG, or WebP up to 10 MB. Images are quarantined and scanned before use."
                            : "New image uploads are disabled until this operator configures malware scanning."}
                        </small>
                        {mediaState !== "idle" ? (
                          <span className="notice" role="status">
                            {mediaState === "uploading"
                              ? "Uploading to quarantine…"
                              : "Checking image safety…"}
                          </span>
                        ) : null}
                      </div>
                      {mediaPreviewUrl ? (
                        <div>
                          <img
                            alt={question.mediaAlt ?? ""}
                            className="question-media"
                            height={360}
                            src={mediaPreviewUrl}
                            width={640}
                          />
                          <button
                            className="danger-link"
                            onClick={() => {
                              updateQuestion((item) => ({
                                ...item,
                                mediaId: null,
                                mediaAlt: null,
                              }));
                              setMediaPreviewUrl("");
                            }}
                            type="button"
                          >
                            Remove image
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                      <legend className="field-label" style={{ marginBottom: 10 }}>
                        Choices and correct answer
                      </legend>
                      {question.choices.map((choice, index) => (
                        <div className="choice-row" key={choice.id}>
                          <input
                            aria-label={`Mark choice ${index + 1} correct`}
                            checked={choice.isCorrect}
                            className="choice-correct"
                            name="correct-choice"
                            onChange={() =>
                              updateQuestion((item) => ({
                                ...item,
                                choices: item.choices.map((candidate) => ({
                                  ...candidate,
                                  isCorrect: candidate.id === choice.id,
                                })),
                              }))
                            }
                            type="radio"
                          />
                          <input
                            aria-label={`Choice ${index + 1}`}
                            className="input"
                            disabled={question.type === "true_false"}
                            maxLength={180}
                            onChange={(event) =>
                              updateQuestion((item) => ({
                                ...item,
                                choices: item.choices.map((candidate) =>
                                  candidate.id === choice.id
                                    ? { ...candidate, label: event.target.value }
                                    : candidate,
                                ),
                              }))
                            }
                            value={choice.label}
                          />
                          {question.type === "single_select" && question.choices.length > 2 ? (
                            <button
                              className="danger-link"
                              onClick={() =>
                                updateQuestion((item) => ({
                                  ...item,
                                  choices: item.choices
                                    .filter((candidate) => candidate.id !== choice.id)
                                    .map((candidate, remainingIndex) => ({
                                      ...candidate,
                                      isCorrect: item.choices
                                        .filter((value) => value.id !== choice.id)
                                        .some((value) => value.isCorrect)
                                        ? candidate.isCorrect
                                        : remainingIndex === 0,
                                    })),
                                }))
                              }
                              type="button"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </fieldset>
                    {question.type === "single_select" && question.choices.length < 6 ? (
                      <button
                        className="button-quiet small-button"
                        onClick={() =>
                          updateQuestion((item) => ({
                            ...item,
                            choices: [
                              ...item.choices,
                              { id: clientUuid(), label: "", isCorrect: false },
                            ],
                          }))
                        }
                        type="button"
                      >
                        Add choice
                      </button>
                    ) : null}
                    <div className="toolbar" style={{ marginTop: 22 }}>
                      <label className="field" style={{ flex: "1 1 180px", marginBottom: 0 }}>
                        <span>Time limit</span>
                        <select
                          className="select"
                          onChange={(event) =>
                            updateQuestion((item) => ({
                              ...item,
                              timeLimitSeconds: Number(event.target.value),
                            }))
                          }
                          value={question.timeLimitSeconds}
                        >
                          {[5, 10, 20, 30, 60, 90, 120, 300].map((seconds) => (
                            <option key={seconds} value={seconds}>
                              {seconds} seconds
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field" style={{ flex: "1 1 180px", marginBottom: 0 }}>
                        <span>Base points</span>
                        <select
                          className="select"
                          onChange={(event) =>
                            updateQuestion((item) => ({
                              ...item,
                              basePoints: Number(event.target.value),
                            }))
                          }
                          value={question.basePoints}
                        >
                          {[0, 500, 1000, 2000].map((points) => (
                            <option key={points} value={points}>
                              {points}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="field" style={{ marginTop: 22 }}>
                      <label htmlFor="explanation">Explanation after reveal</label>
                      <textarea
                        className="textarea"
                        id="explanation"
                        maxLength={1000}
                        onChange={(event) =>
                          updateQuestion((item) => ({ ...item, explanation: event.target.value }))
                        }
                        value={question.explanation}
                      />
                    </div>
                    <button className="button-danger" onClick={removeQuestion} type="button">
                      Delete question
                    </button>
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </>
  );
}
