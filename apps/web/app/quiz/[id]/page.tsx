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
import { BuilderCommandBar } from "../../../components/editor/builder-command-bar";
import { DeliveryScoring } from "../../../components/editor/delivery-scoring";
import { DiagnosticDetails } from "../../../components/editor/diagnostic-details";
import { MediaEditor } from "../../../components/editor/media-editor";
import { ParticipantPreview } from "../../../components/editor/participant-preview";
import {
  QuestionInspector,
  type InspectorTab,
} from "../../../components/editor/question-inspector";
import { editorTypeLabel } from "../../../components/editor/question-labels";
import { QuestionNavigator } from "../../../components/editor/question-navigator";
import { QuestionReusePicker } from "../../../components/editor/question-reuse-picker";
import { ReadinessSummary } from "../../../components/editor/readiness-summary";
import { ResponseEditor } from "../../../components/editor/response-editor";
import builderStyles from "../../../components/editor/round-builder.module.css";
import { isChoiceQuestion, type ChoiceQuestionDraft } from "../../../components/editor/types";
import { ExperiencePicker } from "../../../components/experience-picker";
import { ApiClientError, apiFetch, humanError } from "../../../lib/api";
import {
  clearBuilderRecovery,
  loadBuilderRecovery,
  saveBuilderRecovery,
  type BuilderRecoverySnapshot,
} from "../../../lib/builder-recovery";
import { useEditorController } from "../../../lib/editor-controller";
import { moveQuestionById, removeQuestionById } from "../../../lib/editor-structure";
import {
  cloneQuestionReuseSelections,
  type QuestionReuseSelection,
  type QuestionReuseSource,
} from "../../../lib/question-reuse";
import { roundReadinessIssues, type RoundReadinessIssue } from "../../../lib/round-readiness";
import { retryWithBackoff } from "../../../lib/retry";
import { clientUuid } from "../../../lib/uuid";
import { recordAuthoringEvent } from "../../../components/workspace/product-events";

interface QuizRecord {
  id: string;
  status: "draft" | "published" | "archived";
  draft: QuizDraft;
  draftRevision: number;
  publishedDraftRevision?: number | null;
  currentVersionId: string | null;
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
  const [questionReuseSources, setQuestionReuseSources] = useState<QuestionReuseSource[]>([]);
  const [questionReuseOpen, setQuestionReuseOpen] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const {
    draft,
    selectedQuestionId,
    insertType,
    structuralUndo,
    structuralRedo,
    loadDraft,
    setDraft,
    setSelectedQuestionId,
    setInsertType,
    applyStructuralChange,
    undoStructuralChange,
    redoStructuralChange,
  } = useEditorController();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "conflict">(
    "idle",
  );
  const [recoverySnapshot, setRecoverySnapshot] =
    useState<BuilderRecoverySnapshot<QuizDraft> | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [mediaUploadsEnabled, setMediaUploadsEnabled] = useState(false);
  const [roundExperiencesAvailable, setRoundExperiencesAvailable] = useState(false);
  const [uxBeta, setUxBeta] = useState(false);
  const [practiceAssignmentsAvailable, setPracticeAssignmentsAvailable] = useState(false);
  const [mediaState, setMediaState] = useState<"idle" | "uploading" | "scanning">("idle");
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [validationAction, setValidationAction] = useState<"preview" | "publish" | null>(null);
  const [questionMapCollapsed, setQuestionMapCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("build");
  const loaded = useRef(false);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const latestSaveRevision = useRef(0);
  const serverRevision = useRef(0);
  const lastSavedJson = useRef("");
  const initialInsertHandled = useRef(false);
  const initialInsertNeedsFocus = useRef(false);
  const firstBlockTracked = useRef(false);
  const previousBlockCount = useRef<number | null>(null);
  const selectedIndex = draft
    ? Math.max(
        0,
        draft.questions.findIndex((question) => question.id === selectedQuestionId),
      )
    : 0;
  const selectedMediaId = draft?.questions[selectedIndex]?.mediaId ?? null;
  const recoveryKey = `round:${id}`;

  const enqueueSave = useCallback(
    (candidate: QuizDraft) => {
      const mutationId = clientUuid();
      const request = saveQueue.current.then(async () => {
        const expectedRevision = serverRevision.current;
        const result = await retryWithBackoff(() => {
          if (!uxBeta) {
            return apiFetch<{ quiz: QuizRecord }>(`/v1/quizzes/${id}`, {
              method: "PATCH",
              body: JSON.stringify({
                draft: candidate,
                expectedDraftRevision: expectedRevision,
              }),
            });
          }
          return apiFetch<{ quiz: QuizRecord }>(`/v1/quizzes/${id}/draft`, {
            method: "PUT",
            body: JSON.stringify({
              draft: candidate,
              expectedRevision,
              mutationId,
              schemaVersion: 1,
            }),
          });
        });
        serverRevision.current = result.quiz.draftRevision;
        lastSavedJson.current = JSON.stringify(candidate);
        return result;
      });
      saveQueue.current = request.then(
        () => undefined,
        () => undefined,
      );
      return request;
    },
    [id, uxBeta],
  );

  useEffect(() => {
    apiFetch<{ mediaUploads: boolean }>("/v1/features")
      .then(({ mediaUploads }) => setMediaUploadsEnabled(mediaUploads))
      .catch(() => setMediaUploadsEnabled(false));
  }, []);

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 1040px)");
    const syncLayout = (matches: boolean) => {
      setQuestionMapCollapsed(matches);
      setInspectorCollapsed(matches);
    };
    syncLayout(compact.matches);
    const onChange = (event: MediaQueryListEvent) => syncLayout(event.matches);
    compact.addEventListener("change", onChange);
    return () => compact.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    loaded.current = false;
    latestSaveRevision.current += 1;
    setRecoverySnapshot(null);
    setSaveConflict(false);
    firstBlockTracked.current = false;
    previousBlockCount.current = null;
    let active = true;
    Promise.all([
      apiFetch<{ quiz: QuizRecord }>(`/v1/quizzes/${id}`),
      apiFetch<{
        creator: { role: "owner" | "editor" | "viewer" };
        entitlements: Entitlements;
        productFeatures: {
          roundExperiences: boolean;
          uxBeta: boolean;
          builderV2: boolean;
          practiceAssignments?: boolean;
        };
      }>("/v1/auth/me"),
      apiFetch<{ quizzes: QuizRecord[] }>("/v1/quizzes"),
      loadBuilderRecovery<QuizDraft>(recoveryKey),
    ])
      .then(([{ quiz: loadedQuiz }, account, library, localRecovery]) => {
        if (!active) return;
        setQuiz(loadedQuiz);
        previousBlockCount.current = loadedQuiz.draft.questions.length;
        firstBlockTracked.current = loadedQuiz.draft.questions.length > 0;
        loadDraft(loadedQuiz.draft);
        serverRevision.current = loadedQuiz.draftRevision ?? 0;
        lastSavedJson.current = JSON.stringify(loadedQuiz.draft);
        setSaveState("saved");
        setEntitlements(account.entitlements);
        setCanEdit(account.creator.role === "owner" || account.creator.role === "editor");
        setRoundExperiencesAvailable(account.productFeatures.roundExperiences);
        setUxBeta(account.productFeatures.uxBeta && account.productFeatures.builderV2);
        setPracticeAssignmentsAvailable(Boolean(account.productFeatures.practiceAssignments));
        setPublishedQuizCount(
          library.quizzes.filter((candidate) => candidate.status === "published").length,
        );
        setQuestionReuseSources(
          library.quizzes
            .filter(
              (candidate) =>
                candidate.id !== loadedQuiz.id &&
                candidate.draft.questions.some(
                  (question) => (question.delivery ?? "main") === "main",
                ),
            )
            .map((candidate) => ({
              id: candidate.id,
              title: candidate.draft.title,
              draft: { questions: candidate.draft.questions },
            })),
        );
        setQuestionReuseOpen(false);
        if (
          localRecovery &&
          JSON.stringify(localRecovery.draft) !== JSON.stringify(loadedQuiz.draft)
        ) {
          setRecoverySnapshot(localRecovery);
        } else if (localRecovery) {
          void clearBuilderRecovery(recoveryKey);
        }
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
  }, [id, loadDraft, recoveryKey, router]);

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
    const count = draft.questions.length;
    if (!firstBlockTracked.current && previousBlockCount.current === 0 && count > 0) {
      firstBlockTracked.current = true;
      recordAuthoringEvent("first_block_created", "round");
    }
    previousBlockCount.current = count;
  }, [draft]);

  useEffect(() => {
    if (!loaded.current || !draft || !canEdit) return;
    const serialized = JSON.stringify(draft);
    if (serialized === lastSavedJson.current) return;
    void saveBuilderRecovery(recoveryKey, serverRevision.current, draft);
    if (saveConflict) return;
    const revision = ++latestSaveRevision.current;
    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      void enqueueSave(draft)
        .then(({ quiz: saved }) => {
          if (revision !== latestSaveRevision.current) return;
          setQuiz(saved);
          setSaveState("saved");
          setError("");
          void clearBuilderRecovery(recoveryKey);
        })
        .catch((caught) => {
          if (revision !== latestSaveRevision.current) return;
          if (caught instanceof ApiClientError && caught.code === "STALE_DRAFT") {
            recordAuthoringEvent("draft_conflict", "round");
            setSaveConflict(true);
            setSaveState("conflict");
            setError("");
            return;
          }
          recordAuthoringEvent("draft_save_failed", "round");
          setError(humanError(caught));
          setSaveState("error");
        });
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [canEdit, draft, enqueueSave, recoveryKey, saveConflict]);

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (saveState !== "saving" && saveState !== "error" && saveState !== "conflict") return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [saveState]);

  useEffect(() => {
    if (draft && roundReadinessIssues(draft, uxBeta).length === 0) setValidationAction(null);
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
    applyStructuralChange({ ...draft, questions: [...draft.questions, inserted] }, inserted.id, {
      draft,
      selectedQuestionId,
      message: "Question added.",
    });
    setInspectorTab("build");
  }

  function openQuestionReuse() {
    setQuestionReuseOpen(true);
    window.setTimeout(() => {
      document
        .querySelector<HTMLInputElement>(
          '[data-testid="question-reuse-picker"] input[type="search"]',
        )
        ?.focus();
    }, 0);
  }

  function closeQuestionReuse() {
    setQuestionReuseOpen(false);
    window.setTimeout(() => document.getElementById("open-private-question-bank")?.focus(), 0);
  }

  function reuseQuestions(selections: QuestionReuseSelection[]) {
    if (!draft) return;
    const cloned = cloneQuestionReuseSelections(questionReuseSources, selections, clientUuid);
    if (cloned.includedQuestionCount === 0) return;
    if (draft.questions.length + cloned.includedQuestionCount > 200) {
      setError("Select fewer questions so this Round stays within the 200-question limit.");
      return;
    }
    setError("");
    applyStructuralChange(
      { ...draft, questions: [...draft.questions, ...cloned.questions] },
      cloned.firstQuestionId,
      {
        draft,
        selectedQuestionId,
        message: `${cloned.includedQuestionCount} ${
          cloned.includedQuestionCount === 1 ? "question" : "questions"
        } reused.`,
      },
    );
    setQuestionReuseOpen(false);
    window.setTimeout(() => document.getElementById("prompt")?.focus(), 0);
  }

  function removeQuestion(questionId = selectedQuestionId) {
    if (!draft) return;
    const removedIndex = draft.questions.findIndex((candidate) => candidate.id === questionId);
    const removedId = draft.questions[removedIndex]?.id;
    if (!removedId) return;
    const undo = {
      draft,
      selectedQuestionId,
      message: "Question deleted.",
    };
    const next = removeQuestionById(draft, removedId);
    applyStructuralChange(next, next.questions[Math.max(0, removedIndex - 1)]?.id ?? null, undo);
  }

  function duplicateQuestion(questionId = selectedQuestionId) {
    if (!draft) return;
    const sourceIndex = draft.questions.findIndex((candidate) => candidate.id === questionId);
    const question = draft.questions[sourceIndex];
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
    next.splice(sourceIndex + 1, 0, copy);
    applyStructuralChange({ ...draft, questions: next }, copy.id, {
      draft,
      selectedQuestionId,
      message: "Question duplicated.",
    });
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
    applyStructuralChange({ ...draft, questions: next }, linked.id, {
      draft,
      selectedQuestionId,
      message: "Recheck question added.",
    });
    setInspectorTab("recover");
  }

  function moveQuestion(questionId: string, direction: -1 | 1) {
    if (!draft) return;
    const sourceIndex = draft.questions.findIndex((candidate) => candidate.id === questionId);
    const target = sourceIndex + direction;
    if (target < 0 || target >= draft.questions.length) return;
    const undo = {
      draft,
      selectedQuestionId,
      message: "Question moved.",
    };
    applyStructuralChange(moveQuestionById(draft, questionId, direction), questionId, undo);
  }

  function restoreRecoverySnapshot() {
    if (!recoverySnapshot) return;
    loadDraft(recoverySnapshot.draft);
    setRecoverySnapshot(null);
    setError("");
    setSaveState("idle");
  }

  function dismissRecoverySnapshot() {
    setRecoverySnapshot(null);
    void clearBuilderRecovery(recoveryKey);
  }

  async function reloadLatestDraft() {
    setSaveState("saving");
    setError("");
    try {
      const { quiz: latest } = await apiFetch<{ quiz: QuizRecord }>(`/v1/quizzes/${id}`);
      serverRevision.current = latest.draftRevision ?? 0;
      lastSavedJson.current = JSON.stringify(latest.draft);
      setQuiz(latest);
      loadDraft(latest.draft);
      setSaveConflict(false);
      setSaveState("saved");
      await clearBuilderRecovery(recoveryKey);
    } catch (caught) {
      setError(humanError(caught));
      setSaveState("error");
    }
  }

  function preserveLocalCopy() {
    if (!draft) return;
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${draft.title.trim() || "untitled-round"}-local-copy.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function duplicateLocalDraft() {
    if (!draft) return;
    setError("");
    try {
      const title = `${draft.title.trim() || "Untitled Round"} — recovered copy`;
      const { quiz: created } = await apiFetch<{ quiz: QuizRecord }>("/v1/quizzes", {
        method: "POST",
        body: JSON.stringify({ title, description: draft.description ?? "" }),
      });
      await apiFetch<{ quiz: QuizRecord }>(`/v1/quizzes/${created.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          draft: { ...draft, title },
          expectedDraftRevision: created.draftRevision ?? 0,
        }),
      });
      await clearBuilderRecovery(recoveryKey);
      router.push(`/quiz/${created.id}`);
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  async function publish() {
    if (!draft || saveState === "saving" || publishLimitReached) return;
    const guidance = roundReadinessIssues(draft, uxBeta)[0];
    if (guidance) {
      recordAuthoringEvent("publish_blocked", "round");
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
    let draftSaved = false;
    try {
      const { quiz: saved } = await enqueueSave(draft);
      draftSaved = true;
      if (revision === latestSaveRevision.current) setQuiz(saved);
      const published = await apiFetch<{ version: { id: string } }>(`/v1/quizzes/${id}/publish`, {
        method: "POST",
        body: JSON.stringify({ expectedDraftRevision: saved.draftRevision }),
      });
      setQuiz((current) =>
        current
          ? { ...current, status: "published", currentVersionId: published.version.id }
          : current,
      );
      if (!quiz?.currentVersionId) setPublishedQuizCount((count) => count + 1);
      if (revision === latestSaveRevision.current) {
        setSaveState("saved");
        void clearBuilderRecovery(recoveryKey);
      }
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "STALE_DRAFT") {
        recordAuthoringEvent("draft_conflict", "round");
        setSaveConflict(true);
        setSaveState("conflict");
        return;
      }
      if (caught instanceof ApiClientError && caught.status === 422) {
        recordAuthoringEvent("publish_blocked", "round");
      } else if (!draftSaved) {
        recordAuthoringEvent("draft_save_failed", "round");
      }
      setError(humanError(caught));
      if (revision === latestSaveRevision.current) setSaveState("error");
    }
  }

  async function openPreview() {
    if (!draft || saveState === "saving") return;
    const guidance = roundReadinessIssues(draft, uxBeta)[0];
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
      if (caught instanceof ApiClientError && caught.code === "STALE_DRAFT") {
        recordAuthoringEvent("draft_conflict", "round");
        setSaveConflict(true);
        setSaveState("conflict");
        return;
      }
      recordAuthoringEvent("draft_save_failed", "round");
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

  function focusReadinessIssue(issue: RoundReadinessIssue) {
    if (issue.questionId) {
      setSelectedQuestionId(issue.questionId);
      setQuestionMapCollapsed(true);
      window.setTimeout(() => document.getElementById("prompt")?.focus(), 0);
      return;
    }
    window.setTimeout(() => document.getElementById("quiz-title")?.focus(), 0);
  }

  const question = draft?.questions[selectedIndex];
  const linkedRecheck =
    question?.linkedRecheckQuestionId && draft
      ? draft.questions.find((candidate) => candidate.id === question.linkedRecheckQuestionId)
      : null;
  const readinessIssues = draft ? roundReadinessIssues(draft, uxBeta) : [];
  const issueQuestionIds = new Set(
    readinessIssues.flatMap((issue) => (issue.questionId ? [issue.questionId] : [])),
  );
  const publishLimitReached = Boolean(
    quiz &&
    !quiz.currentVersionId &&
    entitlements?.maxPublishedQuizzes !== null &&
    entitlements?.maxPublishedQuizzes !== undefined &&
    publishedQuizCount >= entitlements.maxPublishedQuizzes,
  );

  if (!uxBeta) {
    const draftGuidance = readinessIssues[0];

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
                  : saveState === "conflict"
                    ? "Edit conflict"
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
            {practiceAssignmentsAvailable &&
            quiz?.status === "published" &&
            quiz.currentVersionId ? (
              <Link className="button-quiet small-button" href={`/quiz/${id}/assign`}>
                Assign practice
              </Link>
            ) : null}
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
              <p className="eyebrow">Checkpoint set editor</p>
              <h1 style={{ fontSize: "clamp(2.4rem, 6vw, 4rem)" }}>
                {draft?.title || "Untitled checkpoint set"}
              </h1>
            </div>
            {quiz ? <span className="status-pill">{quiz.status}</span> : null}
          </div>
          {recoverySnapshot ? (
            <section className="notice" role="status">
              <strong>Unsaved local work is available</strong>
              <p>
                This browser preserved changes from{" "}
                {new Date(recoverySnapshot.savedAt).toLocaleString()}.
              </p>
              <div className="button-row">
                <button
                  className="button small-button"
                  onClick={restoreRecoverySnapshot}
                  type="button"
                >
                  Restore local work
                </button>
                <button
                  className="button-quiet small-button"
                  onClick={dismissRecoverySnapshot}
                  type="button"
                >
                  Use server draft
                </button>
              </div>
            </section>
          ) : null}
          {saveConflict ? (
            <section className="error" role="alert">
              <strong>A newer server edit prevented this save</strong>
              <p>
                Your local work is preserved. Reload the current server draft, download your local
                copy, or duplicate it as a new checkpoint set.
              </p>
              <div className="button-row">
                <button
                  className="button small-button"
                  onClick={() => void reloadLatestDraft()}
                  type="button"
                >
                  Reload current
                </button>
                <button
                  className="button-quiet small-button"
                  onClick={preserveLocalCopy}
                  type="button"
                >
                  Preserve local copy
                </button>
                <button
                  className="button-quiet small-button"
                  onClick={() => void duplicateLocalDraft()}
                  type="button"
                >
                  Duplicate as new
                </button>
              </div>
            </section>
          ) : null}
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
                  ? `Cannot ${validationAction} this checkpoint set yet`
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
                require every checkpoint to be complete.
              </small>
              {draftGuidance.questionIndex !== undefined &&
              draftGuidance.questionIndex !== selectedIndex ? (
                <button
                  className="button-quiet small-button"
                  onClick={() =>
                    setSelectedQuestionId(
                      draft?.questions[draftGuidance.questionIndex!]?.id ?? null,
                    )
                  }
                  type="button"
                >
                  Edit checkpoint {draftGuidance.questionIndex + 1}
                </button>
              ) : null}
            </div>
          ) : null}
          {publishLimitReached ? (
            <p className="notice">
              This plan&apos;s {entitlements?.maxPublishedQuizzes} published checkpoint set slots
              are in use. Archive a published set or compare plans before publishing this draft.
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
                  canReuseQuestions={canEdit}
                  draft={draft}
                  insertType={insertType}
                  onAddQuestion={addQuestion}
                  onInsertTypeChange={setInsertType}
                  onOpenQuestionReuse={openQuestionReuse}
                  onSelectQuestion={setSelectedQuestionId}
                  questionReuseOpen={questionReuseOpen}
                  selectedQuestionId={selectedQuestionId}
                  uxBeta={false}
                />
                <section className="panel" aria-label="Selected checkpoint editor">
                  {!question ? (
                    <div>
                      <h2 style={{ fontSize: "1.7rem" }}>Add the first checkpoint</h2>
                      <p className="muted">Choose a response format for the signal you need.</p>
                    </div>
                  ) : (
                    <>
                      <div
                        className="toolbar"
                        style={{ justifyContent: "space-between", marginBottom: 22 }}
                      >
                        <span className="status-pill">
                          {editorTypeLabel(question.type, false)}
                          {(question.delivery ?? "main") === "recheck" ? " · linked recheck" : ""}
                        </span>
                        <div className="button-row">
                          <button
                            className="button-quiet small-button"
                            disabled={selectedIndex === 0}
                            onClick={() => moveQuestion(question.id, -1)}
                            type="button"
                          >
                            Move up
                          </button>
                          <button
                            className="button-quiet small-button"
                            disabled={selectedIndex === draft.questions.length - 1}
                            onClick={() => moveQuestion(question.id, 1)}
                            type="button"
                          >
                            Move down
                          </button>
                          <button
                            className="button-quiet small-button"
                            onClick={() => duplicateQuestion(question.id)}
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
                              Add linked recheck
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="field">
                        <label htmlFor="prompt">Checkpoint prompt</label>
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
                      <DiagnosticDetails
                        onUpdateQuestion={updateQuestion}
                        question={question}
                        questions={draft.questions}
                        uxBeta={false}
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
                        uxBeta={false}
                      />
                      <ResponseEditor
                        onStructuralChange={applyQuestionStructuralChange}
                        onUpdateChoiceQuestion={updateChoiceQuestion}
                        onUpdateQuestion={updateQuestion}
                        question={question}
                        uxBeta={false}
                      />
                      <DeliveryScoring onUpdateQuestion={updateQuestion} question={question} />
                      {question.sourceCitations?.length ? (
                        <details className="notice source-citations">
                          <summary>Source evidence for this generated draft</summary>
                          <p>
                            These citations support the original assistant proposal. Recheck them if
                            you change the checkpoint or answer.
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
                      <button
                        className="button-danger"
                        onClick={() => removeQuestion(question.id)}
                        type="button"
                      >
                        Delete checkpoint
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

  return (
    <div className={builderStyles.builder}>
      <BuilderCommandBar
        assignHref={
          practiceAssignmentsAvailable && quiz?.status === "published" && quiz.currentVersionId
            ? `/quiz/${id}/assign`
            : undefined
        }
        canRedo={Boolean(structuralRedo)}
        canUndo={Boolean(structuralUndo)}
        inspectorOpen={!inspectorCollapsed}
        onPreview={() => void openPreview()}
        onPublish={() => void publish()}
        onRedo={redoStructuralChange}
        onTitleChange={(title) => draft && setDraft({ ...draft, title })}
        onToggleInspector={() => setInspectorCollapsed((current) => !current)}
        onToggleQuestionMap={() => setQuestionMapCollapsed((current) => !current)}
        onUndo={undoStructuralChange}
        previewDisabled={!draft?.questions.length || saveState === "saving"}
        publishDisabled={!draft?.questions.length || saveState === "saving" || publishLimitReached}
        publishLabel={publishLimitReached ? "Publish limit reached" : "Publish"}
        questionMapOpen={!questionMapCollapsed}
        saveState={saveState}
        status={quiz?.status}
        title={draft?.title ?? ""}
      />
      <main id="main">
        <h1 className="sr-only">
          {draft?.title || (uxBeta ? "Untitled Round" : "Untitled checkpoint set")}
        </h1>
        {recoverySnapshot ? (
          <section className={builderStyles.recoveryBanner} role="status">
            <div>
              <strong>Unsaved local work is available</strong>
              <p className="muted">
                This browser preserved changes from{" "}
                {new Date(recoverySnapshot.savedAt).toLocaleString()}.
              </p>
            </div>
            <div className={builderStyles.bannerActions}>
              <button
                className="button small-button"
                onClick={restoreRecoverySnapshot}
                type="button"
              >
                Restore local work
              </button>
              <button
                className="button-quiet small-button"
                onClick={dismissRecoverySnapshot}
                type="button"
              >
                Use server draft
              </button>
            </div>
          </section>
        ) : null}
        {saveConflict ? (
          <section className={builderStyles.conflictBanner} role="alert">
            <div>
              <strong>A newer server edit prevented this save</strong>
              <p className="muted">
                Your local work is preserved. Reload the current server draft, download your local
                copy, or duplicate it as a new Round. OpenRound will not merge changes
                automatically.
              </p>
            </div>
            <div className={builderStyles.bannerActions}>
              <button
                className="button small-button"
                onClick={() => void reloadLatestDraft()}
                type="button"
              >
                Reload current
              </button>
              <button
                className="button-quiet small-button"
                onClick={preserveLocalCopy}
                type="button"
              >
                Preserve local copy
              </button>
              <button
                className="button-quiet small-button"
                onClick={() => void duplicateLocalDraft()}
                type="button"
              >
                Duplicate as new
              </button>
            </div>
          </section>
        ) : null}
        {!draft ? (
          <p className={builderStyles.emptyCanvas}>Loading editor…</p>
        ) : (
          <>
            {uxBeta && canEdit && questionReuseOpen ? (
              <div className={builderStyles.reuseOverlay}>
                <QuestionReusePicker
                  currentQuestionCount={draft.questions.length}
                  onCancel={closeQuestionReuse}
                  onReuse={reuseQuestions}
                  sources={questionReuseSources}
                />
              </div>
            ) : null}
            <div
              className={builderStyles.workspace}
              data-inspector-collapsed={inspectorCollapsed}
              data-map-collapsed={questionMapCollapsed}
            >
              <QuestionNavigator
                canReuseQuestions={canEdit}
                collapsed={questionMapCollapsed}
                draft={draft}
                insertType={insertType}
                issueQuestionIds={issueQuestionIds}
                onAddQuestion={addQuestion}
                onDeleteQuestion={removeQuestion}
                onDuplicateQuestion={duplicateQuestion}
                onInsertTypeChange={setInsertType}
                onMoveQuestion={moveQuestion}
                onOpenQuestionReuse={openQuestionReuse}
                onSelectQuestion={(questionId) => {
                  setSelectedQuestionId(questionId);
                  if (window.matchMedia("(max-width: 760px)").matches) {
                    setQuestionMapCollapsed(true);
                  }
                }}
                onToggleCollapsed={() => setQuestionMapCollapsed((current) => !current)}
                questionReuseOpen={questionReuseOpen}
                selectedQuestionId={selectedQuestionId}
                uxBeta={uxBeta}
              />
              <section className={builderStyles.canvasColumn}>
                <div className={builderStyles.alertStack}>
                  {error ? (
                    <p className="error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  {publishLimitReached ? (
                    <p className="notice">
                      This plan&apos;s {entitlements?.maxPublishedQuizzes} published{" "}
                      {uxBeta ? "Round" : "checkpoint set"} slots are in use. Archive a published
                      set or compare plans before publishing this draft.
                    </p>
                  ) : null}
                </div>
                <ReadinessSummary
                  action={validationAction}
                  entityLabel={uxBeta ? "Round" : "checkpoint set"}
                  issues={readinessIssues}
                  onSelectIssue={focusReadinessIssue}
                />
                <section
                  aria-label={uxBeta ? "Selected question editor" : "Selected checkpoint editor"}
                  className={builderStyles.canvas}
                >
                  {!question ? (
                    <div className={builderStyles.emptyCanvas}>
                      <div>
                        <p className="eyebrow">Start building</p>
                        <h2>Add the first {uxBeta ? "question" : "checkpoint"}</h2>
                        <p className="muted">Choose a response format from the question map.</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <header className={builderStyles.canvasHeader}>
                        <div className={builderStyles.canvasMeta}>
                          <span className="status-pill">
                            {editorTypeLabel(question.type, uxBeta)}
                            {(question.delivery ?? "main") === "recheck" ? " · recheck" : ""}
                          </span>
                          <span className="muted">
                            {selectedIndex + 1} of {draft.questions.length}
                          </span>
                        </div>
                        <div className="button-row">
                          <button
                            className="button-quiet small-button"
                            onClick={() => duplicateQuestion(question.id)}
                            type="button"
                          >
                            Duplicate
                          </button>
                          <button
                            className="danger-link"
                            onClick={() => removeQuestion(question.id)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      </header>
                      <div className={builderStyles.canvasBody}>
                        <div className={builderStyles.promptField}>
                          <label className="sr-only" htmlFor="prompt">
                            {uxBeta ? "Question prompt" : "Checkpoint prompt"}
                          </label>
                          <textarea
                            aria-invalid={!question.prompt.trim()}
                            className={builderStyles.promptInput}
                            id="prompt"
                            maxLength={500}
                            onChange={(event) =>
                              updateQuestion((item) => ({ ...item, prompt: event.target.value }))
                            }
                            placeholder={
                              uxBeta ? "Type your question" : "Type your checkpoint prompt"
                            }
                            value={question.prompt}
                          />
                        </div>
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
                        <div className={builderStyles.canvasSection}>
                          <div className={builderStyles.canvasSectionHeading}>
                            <h2>Response</h2>
                            <span className="muted">Mark the correct answer where applicable</span>
                          </div>
                          <ResponseEditor
                            onStructuralChange={applyQuestionStructuralChange}
                            onUpdateChoiceQuestion={updateChoiceQuestion}
                            onUpdateQuestion={updateQuestion}
                            question={question}
                            uxBeta={uxBeta}
                          />
                        </div>
                        {uxBeta ? (
                          <details className={builderStyles.settingsDisclosure}>
                            <summary>Participant preview</summary>
                            <ParticipantPreview question={question} />
                          </details>
                        ) : null}
                      </div>
                    </>
                  )}
                </section>
              </section>
              <QuestionInspector
                activeTab={inspectorTab}
                build={
                  question ? (
                    <>
                      <h3>Question delivery</h3>
                      <p className={builderStyles.inspectorIntro}>
                        Tune timing, scoring, and the explanation shown after reveal.
                      </p>
                      <DeliveryScoring onUpdateQuestion={updateQuestion} question={question} />
                      <details className={builderStyles.settingsDisclosure}>
                        <summary>Round settings</summary>
                        <label className="field" htmlFor="quiz-description">
                          <span>Description</span>
                          <textarea
                            className="textarea"
                            id="quiz-description"
                            maxLength={1000}
                            onChange={(event) =>
                              setDraft({ ...draft, description: event.target.value })
                            }
                            value={draft.description}
                          />
                        </label>
                        {roundExperiencesAvailable ? (
                          <ExperiencePicker
                            category={draft.category ?? "general"}
                            onCategoryChange={(category: RoundCategory) =>
                              setDraft({ ...draft, category })
                            }
                            onPresetChange={(preset: ExperiencePresetId) =>
                              setDraft({
                                ...draft,
                                experiencePreset: { id: preset, version: 1 },
                              })
                            }
                            presetId={draft.experiencePreset?.id ?? "focus"}
                          />
                        ) : (
                          <p className="notice">
                            Round Experiences are not enabled for this workspace. Existing metadata
                            is preserved and new sessions use Focus.
                          </p>
                        )}
                      </details>
                    </>
                  ) : (
                    <p className={builderStyles.inspectorIntro}>
                      Add a question to see build settings.
                    </p>
                  )
                }
                collapsed={inspectorCollapsed}
                diagnose={
                  question ? (
                    <>
                      <h3>Diagnostic signal</h3>
                      <p className={builderStyles.inspectorIntro}>
                        Capture confidence, concepts, and misconception evidence for useful reports.
                      </p>
                      <DiagnosticDetails
                        onUpdateQuestion={updateQuestion}
                        question={question}
                        questions={draft.questions}
                        uxBeta={uxBeta}
                      />
                      {question.sourceCitations?.length ? (
                        <details className="notice source-citations">
                          <summary>Source evidence</summary>
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
                    </>
                  ) : null
                }
                onTabChange={setInspectorTab}
                onToggle={() => setInspectorCollapsed((current) => !current)}
                recover={
                  question ? (
                    <>
                      <h3>Recovery path</h3>
                      <p className={builderStyles.inspectorIntro}>
                        Pair a second question to verify whether the concept recovered after
                        support.
                      </p>
                      {linkedRecheck ? (
                        <div className={builderStyles.recoveryCard}>
                          <strong>Paired recheck</strong>
                          <p>{linkedRecheck.prompt || "Untitled recheck question"}</p>
                          <button
                            className="button-quiet small-button"
                            onClick={() => setSelectedQuestionId(linkedRecheck.id)}
                            type="button"
                          >
                            Open recheck
                          </button>
                        </div>
                      ) : (question.delivery ?? "main") === "recheck" ? (
                        <div className={builderStyles.recoveryCard}>
                          <strong>This is a recheck question</strong>
                          <p>Use Diagnose to connect it to a main question.</p>
                        </div>
                      ) : question.type !== "poll" && question.type !== "rating" ? (
                        <button className="button" onClick={addLinkedRecheck} type="button">
                          Add a recheck for this concept
                        </button>
                      ) : (
                        <p className="notice">Polls and ratings do not use scored rechecks.</p>
                      )}
                    </>
                  ) : null
                }
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
