"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChoiceDraft,
  Entitlements,
  ExperiencePresetId,
  QuestionDraft,
  QuestionType,
  QuizDraft,
  RoundCategory,
} from "@openround/contracts";
import { Brand } from "../../../components/brand";
import { DeliveryScoring } from "../../../components/editor/delivery-scoring";
import { DiagnosticDetails } from "../../../components/editor/diagnostic-details";
import { MediaEditor } from "../../../components/editor/media-editor";
import { ParticipantPreview } from "../../../components/editor/participant-preview";
import { editorTypeLabel } from "../../../components/editor/question-labels";
import { QuestionNavigator } from "../../../components/editor/question-navigator";
import { ResponseEditor } from "../../../components/editor/response-editor";
import { isChoiceQuestion, type ChoiceQuestionDraft } from "../../../components/editor/types";
import { ExperiencePicker } from "../../../components/experience-picker";
import { apiFetch, humanError } from "../../../lib/api";
import { useEditorController } from "../../../lib/editor-controller";
import { moveQuestionById, removeQuestionById } from "../../../lib/editor-structure";
import { clientUuid } from "../../../lib/uuid";

interface QuizRecord {
  id: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
  currentVersionId: string | null;
}

interface DraftGuidance {
  source: string;
  resolution: string;
  questionIndex?: number;
}

function readableList(values: number[]) {
  if (values.length === 1) return String(values[0]);
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function guidanceForDraft(draft: QuizDraft, uxBeta: boolean): DraftGuidance | null {
  const decimalPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
  if (!draft.title.trim()) {
    return {
      source: uxBeta ? "Round title" : "Checkpoint set title",
      resolution: "Enter a title in the Title field before previewing or publishing.",
    };
  }
  if (draft.questions.length === 0) {
    return {
      source: uxBeta ? "Questions" : "Checkpoints",
      resolution: uxBeta ? "Add at least one question." : "Add at least one checkpoint.",
    };
  }
  for (const [questionIndex, question] of draft.questions.entries()) {
    const actions: string[] = [];
    if (!question.prompt.trim()) {
      actions.push(uxBeta ? "enter the question prompt" : "enter the checkpoint prompt");
    }
    if (isChoiceQuestion(question)) {
      const emptyChoices = question.choices
        .map((choice, choiceIndex) => (!choice.label.trim() ? choiceIndex + 1 : null))
        .filter((choiceIndex): choiceIndex is number => choiceIndex !== null);
      if (emptyChoices.length > 0) {
        actions.push(`fill answer choices ${readableList(emptyChoices)}`);
      }
      const correctCount = question.choices.filter((choice) => choice.isCorrect).length;
      if (question.type === "multi_select" && correctCount === 0) {
        actions.push("select at least one correct answer");
      } else if (
        question.type !== "multi_select" &&
        question.type !== "poll" &&
        correctCount !== 1
      ) {
        actions.push("select exactly one correct answer");
      } else if (question.type === "poll" && correctCount > 0) {
        actions.push("clear correct answers because polls are unscored");
      }
      const invalidMisconceptions = question.choices
        .map((choice) => choice.misconceptionKey?.trim())
        .filter(
          (key): key is string =>
            typeof key === "string" &&
            key.length > 0 &&
            !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(key),
        );
      if (invalidMisconceptions.length > 0) {
        actions.push("use valid private misconception keys");
      }
    } else if (question.type === "numeric") {
      if (!decimalPattern.test(question.correctValue.trim())) {
        actions.push("enter a decimal correct value without exponent notation");
      }
      if (
        !decimalPattern.test(question.tolerance.trim()) ||
        question.tolerance.trim().startsWith("-")
      ) {
        actions.push("enter a non-negative decimal tolerance without exponent notation");
      }
    }
    const invalidConcepts = (question.conceptKeys ?? []).filter(
      (key) => !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(key),
    );
    if (invalidConcepts.length > 0) {
      actions.push(
        `replace invalid concept ${invalidConcepts.join(", ")} with letters, numbers, dots, dashes, or underscores`,
      );
    }
    if (
      question.linkedRecheckQuestionId &&
      !draft.questions.some(
        (candidate) =>
          candidate.id === question.linkedRecheckQuestionId &&
          (candidate.delivery ?? "main") === "recheck",
      )
    ) {
      actions.push(
        uxBeta
          ? "choose an existing question marked as a recheck"
          : "choose an existing checkpoint marked as a recheck",
      );
    }
    if (question.mediaId && !question.mediaAlt?.trim()) {
      actions.push("describe the instructional image");
    }
    if (actions.length > 0) {
      const instruction = actions.join("; ");
      return {
        source: `${uxBeta ? "Question" : "Checkpoint"} ${questionIndex + 1}`,
        resolution: `${instruction[0]?.toUpperCase()}${instruction.slice(1)} before previewing or publishing.`,
        questionIndex,
      };
    }
  }
  return null;
}

function newChoices(type: ChoiceQuestionDraft["type"]): ChoiceDraft[] {
  if (type === "true_false") {
    return [
      { id: clientUuid(), label: "True", isCorrect: true },
      { id: clientUuid(), label: "False", isCorrect: false },
    ];
  }
  return [
    { id: clientUuid(), label: "", isCorrect: type !== "poll" },
    { id: clientUuid(), label: "", isCorrect: false },
    { id: clientUuid(), label: "", isCorrect: false },
    { id: clientUuid(), label: "", isCorrect: false },
  ];
}

function commonQuestion(type: QuestionType) {
  return {
    id: clientUuid(),
    type,
    prompt: "",
    purpose: type === "rating" || type === "poll" ? ("opinion" as const) : ("diagnostic" as const),
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: [],
    linkedRecheckQuestionId: null,
    timeLimitSeconds: 20,
    basePoints: type === "rating" || type === "poll" ? 0 : 1_000,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
  };
}

function newQuestion(type: QuestionType): QuestionDraft {
  const common = commonQuestion(type);
  if (type === "numeric") {
    return { ...common, type, correctValue: "", tolerance: "0", unit: null };
  }
  if (type === "rating") {
    return { ...common, type, min: 1, max: 5, minLabel: "Low", maxLabel: "High" };
  }
  return { ...common, type, choices: newChoices(type) };
}

export default function QuizEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [quiz, setQuiz] = useState<QuizRecord | null>(null);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [publishedQuizCount, setPublishedQuizCount] = useState(0);
  const {
    draft,
    selectedQuestionId,
    insertType,
    structuralUndo,
    loadDraft,
    setDraft,
    setSelectedQuestionId,
    setInsertType,
    applyStructuralChange,
    undoStructuralChange,
  } = useEditorController();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [mediaUploadsEnabled, setMediaUploadsEnabled] = useState(false);
  const [roundExperiencesAvailable, setRoundExperiencesAvailable] = useState(false);
  const [uxBeta, setUxBeta] = useState(false);
  const [mediaState, setMediaState] = useState<"idle" | "uploading" | "scanning">("idle");
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [validationAction, setValidationAction] = useState<"preview" | "publish" | null>(null);
  const loaded = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const latestSaveRevision = useRef(0);
  const initialInsertHandled = useRef(false);
  const initialInsertNeedsFocus = useRef(false);
  const selectedIndex = draft
    ? Math.max(
        0,
        draft.questions.findIndex((question) => question.id === selectedQuestionId),
      )
    : 0;
  const selectedMediaId = draft?.questions[selectedIndex]?.mediaId ?? null;

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
      apiFetch<{
        entitlements: Entitlements;
        productFeatures: { roundExperiences: boolean; uxBeta: boolean };
      }>("/v1/auth/me"),
      apiFetch<{ quizzes: QuizRecord[] }>("/v1/quizzes"),
    ])
      .then(([{ quiz: loadedQuiz }, account, library]) => {
        if (!active) return;
        setQuiz(loadedQuiz);
        loadDraft(loadedQuiz.draft);
        setEntitlements(account.entitlements);
        setRoundExperiencesAvailable(account.productFeatures.roundExperiences);
        setUxBeta(account.productFeatures.uxBeta);
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
  }, [id, loadDraft, router]);

  useEffect(() => {
    if (!loaded.current || !draft || initialInsertHandled.current) return;
    const requestedType = searchParams.get("insert");
    const supportedTypes: QuestionType[] = [
      "single_select",
      "true_false",
      "multi_select",
      "numeric",
      "rating",
      "poll",
    ];
    initialInsertHandled.current = true;
    if (
      uxBeta &&
      draft.questions.length === 0 &&
      supportedTypes.includes(requestedType as QuestionType)
    ) {
      const inserted = newQuestion(requestedType as QuestionType);
      setDraft({ ...draft, questions: [inserted] });
      setSelectedQuestionId(inserted.id);
      initialInsertNeedsFocus.current = true;
    }
    if (requestedType) router.replace(`/quiz/${id}`);
  }, [draft, id, router, searchParams, uxBeta]);

  useEffect(() => {
    if (!initialInsertNeedsFocus.current || !selectedQuestionId) return;
    window.setTimeout(() => {
      if (!initialInsertNeedsFocus.current) return;
      document.getElementById("prompt")?.focus();
      initialInsertNeedsFocus.current = false;
    }, 0);
  }, [draft, selectedQuestionId]);

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
    if (draft && !guidanceForDraft(draft, uxBeta)) setValidationAction(null);
  }, [draft, uxBeta]);

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

  function updateQuestion(updater: (question: QuestionDraft) => QuestionDraft) {
    setDraft((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((question) =>
              question.id === selectedQuestionId ? updater(question) : question,
            ),
          }
        : current,
    );
  }

  function updateChoiceQuestion(updater: (question: ChoiceQuestionDraft) => ChoiceQuestionDraft) {
    updateQuestion((current) => (isChoiceQuestion(current) ? updater(current) : current));
  }

  function applyQuestionStructuralChange(nextQuestion: QuestionDraft, message: string) {
    if (!draft || !selectedQuestionId) return;
    const undo = { draft, selectedQuestionId, message };
    applyStructuralChange(
      {
        ...draft,
        questions: draft.questions.map((candidate) =>
          candidate.id === selectedQuestionId ? nextQuestion : candidate,
        ),
      },
      selectedQuestionId,
      undo,
    );
  }

  function addQuestion(type: QuestionType) {
    if (!draft) return;
    const inserted = newQuestion(type);
    const next = [...draft.questions, inserted];
    setDraft({ ...draft, questions: next });
    setSelectedQuestionId(inserted.id);
  }

  function removeQuestion() {
    if (!draft) return;
    const removedId = draft.questions[selectedIndex]?.id;
    if (!removedId) return;
    const undo = {
      draft,
      selectedQuestionId,
      message: "Question deleted.",
    };
    const next = removeQuestionById(draft, removedId);
    applyStructuralChange(next, next.questions[Math.max(0, selectedIndex - 1)]?.id ?? null, undo);
  }

  function duplicateQuestion() {
    if (!draft) return;
    const question = draft.questions[selectedIndex];
    if (!question) return;
    const copy: QuestionDraft = {
      ...question,
      id: clientUuid(),
      ...(isChoiceQuestion(question)
        ? { choices: question.choices.map((choice) => ({ ...choice, id: clientUuid() })) }
        : {}),
      linkedRecheckQuestionId: null,
    };
    const next = [...draft.questions];
    next.splice(selectedIndex + 1, 0, copy);
    setDraft({ ...draft, questions: next });
    setSelectedQuestionId(copy.id);
  }

  function addLinkedRecheck() {
    if (!draft) return;
    const source = draft.questions[selectedIndex];
    if (!source || source.type === "poll" || source.type === "rating") return;
    const recheck = newQuestion(source.type);
    const linked: QuestionDraft = {
      ...recheck,
      delivery: "recheck",
      purpose: source.purpose ?? "diagnostic",
      confidence: source.confidence ?? "off",
      conceptKeys: source.conceptKeys ?? [],
      prompt: "",
    };
    const next = draft.questions.map((question) =>
      question.id === source.id ? { ...question, linkedRecheckQuestionId: linked.id } : question,
    );
    next.splice(selectedIndex + 1, 0, linked);
    setDraft({ ...draft, questions: next });
    setSelectedQuestionId(linked.id);
  }

  function moveQuestion(direction: -1 | 1) {
    if (!draft) return;
    const target = selectedIndex + direction;
    if (target < 0 || target >= draft.questions.length) return;
    const undo = {
      draft,
      selectedQuestionId,
      message: "Question moved.",
    };
    applyStructuralChange(
      moveQuestionById(draft, selectedQuestionId ?? "", direction),
      selectedQuestionId,
      undo,
    );
  }

  async function publish() {
    if (!draft || saveState === "saving" || publishLimitReached) return;
    const guidance = guidanceForDraft(draft, uxBeta);
    if (guidance) {
      setValidationAction("publish");
      if (guidance.questionIndex !== undefined) {
        setSelectedQuestionId(draft.questions[guidance.questionIndex]?.id ?? null);
      }
      return;
    }
    setValidationAction(null);
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
    const guidance = guidanceForDraft(draft, uxBeta);
    if (guidance) {
      setValidationAction("preview");
      if (guidance.questionIndex !== undefined) {
        setSelectedQuestionId(draft.questions[guidance.questionIndex]?.id ?? null);
      }
      return;
    }
    setValidationAction(null);
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
    const current = draft.questions[selectedIndex];
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

  const question = draft?.questions[selectedIndex];
  const linkedRecheck =
    question?.linkedRecheckQuestionId && draft
      ? draft.questions.find((candidate) => candidate.id === question.linkedRecheckQuestionId)
      : null;
  const draftGuidance = draft ? guidanceForDraft(draft, uxBeta) : null;
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
            <p className="eyebrow">{uxBeta ? "Round editor" : "Checkpoint set editor"}</p>
            <h1 style={{ fontSize: "clamp(2.4rem, 6vw, 4rem)" }}>
              {draft?.title || (uxBeta ? "Untitled Round" : "Untitled checkpoint set")}
            </h1>
          </div>
          {quiz ? <span className="status-pill">{quiz.status}</span> : null}
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {draftGuidance ? (
          <div
            className={`${validationAction ? "error" : "notice"} validation-guidance`}
            role={validationAction ? "alert" : undefined}
          >
            <strong>
              {validationAction
                ? `Cannot ${validationAction} this ${uxBeta ? "Round" : "checkpoint set"} yet`
                : "Draft checklist"}
            </strong>
            <p>
              <strong>Source:</strong> {draftGuidance.source}
            </p>
            <p>
              <strong>How to fix:</strong> {draftGuidance.resolution}
            </p>
            <small>
              Your in-progress draft is still saved automatically. Only preview and publishing
              require every {uxBeta ? "question" : "checkpoint"} to be complete.
            </small>
            {draftGuidance.questionIndex !== undefined &&
            draftGuidance.questionIndex !== selectedIndex ? (
              <button
                className="button-quiet small-button"
                onClick={() =>
                  setSelectedQuestionId(draft?.questions[draftGuidance.questionIndex!]?.id ?? null)
                }
                type="button"
              >
                Edit {uxBeta ? "question" : "checkpoint"} {draftGuidance.questionIndex + 1}
              </button>
            ) : null}
          </div>
        ) : null}
        {publishLimitReached ? (
          <p className="notice">
            This plan&apos;s {entitlements?.maxPublishedQuizzes} published{" "}
            {uxBeta ? "Round" : "checkpoint set"} slots are in use. Archive a published set or
            compare plans before publishing this draft.
          </p>
        ) : null}
        {uxBeta && structuralUndo ? (
          <div className="undo-toast" role="status">
            <span>{structuralUndo.message}</span>
            <button
              className="button-quiet small-button"
              onClick={undoStructuralChange}
              type="button"
            >
              Undo
            </button>
          </div>
        ) : null}
        {!draft ? (
          <p>Loading editor…</p>
        ) : (
          <>
            <section className="panel" style={{ marginBottom: 22 }}>
              <div className="field">
                <label htmlFor="quiz-title">Title</label>
                <input
                  aria-invalid={!draft.title.trim()}
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
              {roundExperiencesAvailable ? (
                <ExperiencePicker
                  category={draft.category ?? "general"}
                  onCategoryChange={(category: RoundCategory) => setDraft({ ...draft, category })}
                  onPresetChange={(preset: ExperiencePresetId) =>
                    setDraft({ ...draft, experiencePreset: { id: preset, version: 1 } })
                  }
                  presetId={draft.experiencePreset?.id ?? "focus"}
                />
              ) : (
                <p className="notice">
                  Round Experiences are not enabled for this workspace. Existing presentation
                  metadata is preserved and new sessions use Focus.
                </p>
              )}
            </section>
            <div className="editor-layout">
              <QuestionNavigator
                draft={draft}
                insertType={insertType}
                onAddQuestion={addQuestion}
                onInsertTypeChange={setInsertType}
                onSelectQuestion={setSelectedQuestionId}
                selectedQuestionId={selectedQuestionId}
                uxBeta={uxBeta}
              />
              <section
                className="panel"
                aria-label={uxBeta ? "Selected question editor" : "Selected checkpoint editor"}
              >
                {!question ? (
                  <div>
                    <h2 style={{ fontSize: "1.7rem" }}>
                      Add the first {uxBeta ? "question" : "checkpoint"}
                    </h2>
                    <p className="muted">Choose a response format for the signal you need.</p>
                  </div>
                ) : (
                  <>
                    <div
                      className="toolbar"
                      style={{ justifyContent: "space-between", marginBottom: 22 }}
                    >
                      <span className="status-pill">
                        {editorTypeLabel(question.type, uxBeta)}
                        {(question.delivery ?? "main") === "recheck" ? " · linked recheck" : ""}
                      </span>
                      <div className="button-row">
                        <button
                          className="button-quiet small-button"
                          disabled={selectedIndex === 0}
                          onClick={() => moveQuestion(-1)}
                          type="button"
                        >
                          Move up
                        </button>
                        <button
                          className="button-quiet small-button"
                          disabled={selectedIndex === draft.questions.length - 1}
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
                        {(question.delivery ?? "main") === "main" &&
                        question.type !== "poll" &&
                        question.type !== "rating" &&
                        !question.linkedRecheckQuestionId ? (
                          <button
                            className="button-quiet small-button"
                            onClick={addLinkedRecheck}
                            type="button"
                          >
                            {uxBeta ? "Add a recheck for this concept" : "Add linked recheck"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor="prompt">
                        {uxBeta ? "Question prompt" : "Checkpoint prompt"}
                      </label>
                      <textarea
                        aria-invalid={!question.prompt.trim()}
                        className="textarea"
                        id="prompt"
                        maxLength={500}
                        onChange={(event) =>
                          updateQuestion((item) => ({ ...item, prompt: event.target.value }))
                        }
                        value={question.prompt}
                      />
                    </div>
                    {uxBeta && linkedRecheck ? (
                      <div className="recheck-pair">
                        <span aria-hidden="true">↳</span>
                        <div>
                          <strong>Paired recheck</strong>
                          <p>{linkedRecheck.prompt || "Untitled recheck question"}</p>
                        </div>
                      </div>
                    ) : null}
                    <DiagnosticDetails
                      onUpdateQuestion={updateQuestion}
                      question={question}
                      questions={draft.questions}
                      uxBeta={uxBeta}
                    />
                    <MediaEditor
                      mediaPreviewUrl={mediaPreviewUrl}
                      mediaState={mediaState}
                      mediaUploadsEnabled={mediaUploadsEnabled}
                      onRemoveImage={() => {
                        applyQuestionStructuralChange(
                          { ...question, mediaId: null, mediaAlt: null },
                          "Image removed.",
                        );
                        setMediaPreviewUrl("");
                      }}
                      onUpdateQuestion={updateQuestion}
                      onUploadImage={(file) => void uploadQuestionImage(file)}
                      question={question}
                      uxBeta={uxBeta}
                    />
                    <ResponseEditor
                      onStructuralChange={applyQuestionStructuralChange}
                      onUpdateChoiceQuestion={updateChoiceQuestion}
                      onUpdateQuestion={updateQuestion}
                      question={question}
                      uxBeta={uxBeta}
                    />
                    <DeliveryScoring onUpdateQuestion={updateQuestion} question={question} />
                    {question.sourceCitations?.length ? (
                      <details className="notice source-citations">
                        <summary>Source evidence for this generated draft</summary>
                        <p>
                          These citations support the original assistant proposal. Recheck them if
                          you change the {uxBeta ? "question" : "checkpoint"} or answer.
                        </p>
                        <ul>
                          {question.sourceCitations.map((citation) => (
                            <li
                              key={`${citation.sourceDigest}-${citation.locator}-${citation.excerpt}`}
                            >
                              <strong>
                                {citation.sourceName} · {citation.locator}:
                              </strong>{" "}
                              “{citation.excerpt}”
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {uxBeta ? (
                      <section
                        aria-label="Live participant preview"
                        className="participant-preview-disclosure"
                      >
                        <ParticipantPreview question={question} />
                      </section>
                    ) : null}
                    <button className="button-danger" onClick={removeQuestion} type="button">
                      Delete {uxBeta ? "question" : "checkpoint"}
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
