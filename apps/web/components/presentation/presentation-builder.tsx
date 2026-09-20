"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type SetStateAction,
} from "react";
import type {
  ContentSlideLayout,
  PresentationBlockDraft,
  PresentationDraft,
  QuestionDraft,
  QuestionType,
} from "@openround/contracts";
import { ApiClientError, apiFetch, humanError } from "../../lib/api";
import {
  clearBuilderRecovery,
  loadBuilderRecovery,
  saveBuilderRecovery,
  type BuilderRecoverySnapshot,
} from "../../lib/builder-recovery";
import {
  changePresentationQuestionType,
  createContentBlock,
  createQuestionBlock,
  duplicatePresentationBlock,
  movePresentationBlock,
  presentationReadiness,
  removePresentationBlock,
} from "../../lib/presentation-builder";
import { RecoverableOperationQueue } from "../../lib/recoverable-operation-queue";
import { retryWithBackoff } from "../../lib/retry";
import { AuthoringAssistant } from "../authoring-assistant";
import { ResponseEditor } from "../editor/response-editor";
import { MediaEditor } from "../editor/media-editor";
import { isChoiceQuestion } from "../editor/types";
import { questionTypeOptions, responseTypeLabel } from "../workspace/workspace-model";
import { recordAuthoringEvent } from "../workspace/product-events";
import styles from "./presentation-builder.module.css";

interface PresentationRecord {
  id: string;
  title: string;
  description: string;
  status: "draft" | "published" | "archived";
  draft: PresentationDraft;
  draftRevision: number;
  currentVersionId: string | null;
  updatedAt: string;
  hasUnpublishedChanges: boolean;
}

interface RoundSource {
  id: string;
  title: string;
  currentVersionId: string | null;
}

interface PublishedRoundQuestionSource {
  versionId: string;
  questions: QuestionDraft[];
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";
type InspectorTab =
  | "build"
  | "diagnose"
  | "recover"
  | "content"
  | "layout"
  | "media"
  | "notes"
  | "accessibility"
  | "readiness";

const HISTORY_LIMIT = 40;
const TEXT_EDIT_COALESCE_MS = 750;
const slideLayouts: Array<{ id: ContentSlideLayout; label: string }> = [
  { id: "title", label: "Title" },
  { id: "title_body", label: "Title + body" },
  { id: "media", label: "Media" },
  { id: "quote", label: "Quote" },
  { id: "section", label: "Section" },
  { id: "callout", label: "Callout" },
];

function blockLabel(block: PresentationBlockDraft, index: number) {
  if (block.kind === "content") return block.title.trim() || `Content slide ${index + 1}`;
  return block.question.prompt.trim() || `Question ${index + 1}`;
}

function blockKindLabel(block: PresentationBlockDraft) {
  if (block.kind === "content") return "Content";
  return `${(block.question.delivery ?? "main") === "recheck" ? "Recheck" : "Question"} · ${responseTypeLabel(block.question.type)}`;
}

function updateBlock(
  draft: PresentationDraft,
  blockId: string,
  updater: (block: PresentationBlockDraft) => PresentationBlockDraft,
) {
  return {
    ...draft,
    blocks: draft.blocks.map((block) => (block.id === blockId ? updater(block) : block)),
  };
}

const modalFocusable =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusModal(container: HTMLElement | null) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const first = container?.querySelector<HTMLElement>(modalFocusable) ?? container;
  first?.focus();
  return () => previous?.focus();
}

function handleModalKeyDown(event: KeyboardEvent<HTMLElement>, onClose: () => void) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(modalFocusable)].filter(
    (element) => element.offsetParent !== null,
  );
  if (focusable.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }
  const first = focusable[0]!;
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function AuthenticatedMedia({ mediaId, altText }: { mediaId: string; altText: string | null }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    void apiFetch<{ downloadUrl: string }>(`/v1/media/${mediaId}`)
      .then(({ downloadUrl }) => {
        if (active) setSource(downloadUrl);
      })
      .catch(() => {
        if (active) setSource("");
      });
    return () => {
      active = false;
    };
  }, [mediaId]);
  return source ? (
    <img alt={altText ?? ""} className={styles.builderMedia} src={source} />
  ) : (
    <div className={styles.mediaPlaceholder} role="status">
      Loading instructional image…
    </div>
  );
}

function PresentationPreview({
  draft,
  onClose,
}: {
  draft: PresentationDraft;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const block = draft.blocks[index];
  useEffect(() => focusModal(dialogRef.current), []);
  return (
    <div
      ref={dialogRef}
      className={styles.previewBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Presentation preview"
      onKeyDown={(event) => handleModalKeyDown(event, onClose)}
      tabIndex={-1}
    >
      <div className={styles.previewStage}>
        <div className={styles.previewBar}>
          <strong>{draft.title || "Untitled presentation"}</strong>
          <span>{draft.blocks.length ? `${index + 1} / ${draft.blocks.length}` : "No slides"}</span>
          <button className={styles.iconButton} onClick={onClose} type="button">
            Close preview
          </button>
        </div>
        <div className={styles.previewCanvas}>
          {!block ? (
            <p>Add a slide to preview this presentation.</p>
          ) : block.kind === "content" ? (
            <article className={`${styles.previewContent} ${styles[`layout_${block.layout}`]}`}>
              <span className={styles.previewEyebrow}>{block.layout.replace("_", " ")}</span>
              <h1>{block.title || "Untitled slide"}</h1>
              {block.body ? <p>{block.body}</p> : null}
              {block.mediaId ? (
                <AuthenticatedMedia altText={block.mediaAlt} mediaId={block.mediaId} />
              ) : null}
            </article>
          ) : (
            <article className={styles.previewQuestion}>
              <span className={styles.previewEyebrow}>Audience question</span>
              <h1>{block.question.prompt || "Untitled question"}</h1>
              {"choices" in block.question ? (
                <div className={styles.previewChoices}>
                  {block.question.choices.map((choice, choiceIndex) => (
                    <div key={choice.id}>
                      <span>{String.fromCharCode(65 + choiceIndex)}</span>
                      {choice.label || `Answer ${choiceIndex + 1}`}
                    </div>
                  ))}
                </div>
              ) : block.question.type === "numeric" ? (
                <div className={styles.previewAnswer}>Participants enter a number</div>
              ) : (
                <div className={styles.previewAnswer}>
                  {block.question.min} — {block.question.max}
                </div>
              )}
            </article>
          )}
        </div>
        <div className={styles.previewControls}>
          <button
            disabled={index === 0}
            onClick={() => setIndex((value) => value - 1)}
            type="button"
          >
            Previous
          </button>
          <button
            disabled={index >= draft.blocks.length - 1}
            onClick={() => setIndex((value) => value + 1)}
            type="button"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export function PresentationBuilder({ presentationId }: { presentationId: string }) {
  const router = useRouter();
  const recoveryKey = `presentation:${presentationId}`;
  const [record, setRecord] = useState<PresentationRecord | null>(null);
  const [draft, setDraft] = useState<PresentationDraft | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("build");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [recovery, setRecovery] = useState<BuilderRecoverySnapshot<PresentationDraft> | null>(null);
  const [undoStack, setUndoStack] = useState<PresentationDraft[]>([]);
  const [redoStack, setRedoStack] = useState<PresentationDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [roundSources, setRoundSources] = useState<RoundSource[]>([]);
  const [roundImportOpen, setRoundImportOpen] = useState(false);
  const [sourceImportOpen, setSourceImportOpen] = useState(false);
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [publishedRound, setPublishedRound] = useState<PublishedRoundQuestionSource | null>(null);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);
  const [importingQuestions, setImportingQuestions] = useState(false);
  const [mediaUploadsEnabled, setMediaUploadsEnabled] = useState(false);
  const [mediaState, setMediaState] = useState<"idle" | "uploading" | "scanning">("idle");
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState("");
  const revisionRef = useRef(0);
  const lastSavedJson = useRef("");
  const latestDraftJson = useRef("");
  const saveQueue = useRef(new RecoverableOperationQueue());
  const lastHistoryCommit = useRef<{ key: string; at: number } | null>(null);
  const roundImportDialogRef = useRef<HTMLDivElement>(null);
  const sourceImportDialogRef = useRef<HTMLDivElement>(null);
  const firstBlockTracked = useRef(false);
  const previousBlockCount = useRef<number | null>(null);

  const selectedBlock = draft?.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const selectedMediaId =
    selectedBlock?.kind === "content"
      ? selectedBlock.mediaId
      : selectedBlock?.kind === "question"
        ? selectedBlock.question.mediaId
        : null;
  const issues = useMemo(() => (draft ? presentationReadiness(draft) : []), [draft]);
  const issuesByBlock = useMemo(() => {
    const map = new Map<string, number>();
    for (const issue of issues) {
      if (issue.blockId) map.set(issue.blockId, (map.get(issue.blockId) ?? 0) + 1);
    }
    return map;
  }, [issues]);

  useEffect(() => {
    firstBlockTracked.current = false;
    previousBlockCount.current = null;
    let active = true;
    void Promise.all([
      apiFetch<{ presentation: PresentationRecord }>(`/v1/presentations/${presentationId}`),
      loadBuilderRecovery<PresentationDraft>(recoveryKey),
    ])
      .then(([response, local]) => {
        if (!active) return;
        setRecord(response.presentation);
        previousBlockCount.current = response.presentation.draft.blocks.length;
        firstBlockTracked.current = response.presentation.draft.blocks.length > 0;
        setDraft(response.presentation.draft);
        setSelectedBlockId(response.presentation.draft.blocks[0]?.id ?? null);
        revisionRef.current = response.presentation.draftRevision;
        lastSavedJson.current = JSON.stringify(response.presentation.draft);
        latestDraftJson.current = lastSavedJson.current;
        if (local && JSON.stringify(local.draft) !== lastSavedJson.current) setRecovery(local);
        setLoaded(true);
      })
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
    return () => {
      active = false;
    };
  }, [presentationId, recoveryKey, router]);

  useEffect(() => {
    if (!loaded || !draft) return;
    const count = draft.blocks.length;
    if (!firstBlockTracked.current && previousBlockCount.current === 0 && count > 0) {
      firstBlockTracked.current = true;
      recordAuthoringEvent("first_block_created", "presentation");
    }
    previousBlockCount.current = count;
  }, [draft, loaded]);

  useEffect(() => {
    void apiFetch<{ quizzes: RoundSource[] }>("/v1/quizzes")
      .then(({ quizzes }) => setRoundSources(quizzes.filter((quiz) => quiz.currentVersionId)))
      .catch(() => setRoundSources([]));
  }, []);

  useEffect(() => {
    if (!roundImportOpen) return;
    return focusModal(roundImportDialogRef.current);
  }, [roundImportOpen]);

  useEffect(() => {
    if (!sourceImportOpen) return;
    return focusModal(sourceImportDialogRef.current);
  }, [sourceImportOpen]);

  useEffect(() => {
    void apiFetch<{ mediaUploads: boolean }>("/v1/features")
      .then(({ mediaUploads }) => setMediaUploadsEnabled(mediaUploads))
      .catch(() => setMediaUploadsEnabled(false));
  }, []);

  useEffect(() => {
    if (!selectedMediaId) {
      setMediaPreviewUrl("");
      return;
    }
    let active = true;
    void apiFetch<{ downloadUrl: string }>(`/v1/media/${selectedMediaId}`)
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

  useEffect(() => {
    if (!selectedBlock) return;
    const contentTabs: InspectorTab[] = [
      "content",
      "layout",
      "media",
      "notes",
      "accessibility",
      "readiness",
    ];
    const questionTabs: InspectorTab[] = ["build", "diagnose", "recover", "readiness"];
    if (selectedBlock.kind === "content" && !contentTabs.includes(inspectorTab)) {
      setInspectorTab("content");
    }
    if (selectedBlock.kind === "question" && !questionTabs.includes(inspectorTab)) {
      setInspectorTab("build");
    }
  }, [inspectorTab, selectedBlock]);

  useEffect(() => {
    if (!selectedRoundId) {
      setPublishedRound(null);
      setSelectedQuestionIds([]);
      return;
    }
    let active = true;
    void apiFetch<{
      quiz: RoundSource;
      currentVersion: { id: string; content: { questions: QuestionDraft[] } } | null;
    }>(`/v1/quizzes/${selectedRoundId}`)
      .then(({ currentVersion }) => {
        if (!active) return;
        setPublishedRound(
          currentVersion
            ? { versionId: currentVersion.id, questions: currentVersion.content.questions }
            : null,
        );
        setSelectedQuestionIds([]);
      })
      .catch((caught) => {
        if (active) setError(humanError(caught));
      });
    return () => {
      active = false;
    };
  }, [selectedRoundId]);

  const commit = useCallback(
    (value: SetStateAction<PresentationDraft>, historyKey?: string) => {
      setDraft((current) => {
        if (!current) return current;
        const next = typeof value === "function" ? value(current) : value;
        if (next === current || JSON.stringify(next) === JSON.stringify(current)) return current;
        const now = Date.now();
        const previousHistoryCommit = lastHistoryCommit.current;
        const coalescesWithPreviousEdit =
          historyKey !== undefined &&
          previousHistoryCommit?.key === historyKey &&
          now - previousHistoryCommit.at <= TEXT_EDIT_COALESCE_MS;
        if (!coalescesWithPreviousEdit) {
          setUndoStack((history) => [...history, current].slice(-HISTORY_LIMIT));
        }
        lastHistoryCommit.current = historyKey ? { key: historyKey, at: now } : null;
        setRedoStack([]);
        latestDraftJson.current = JSON.stringify(next);
        setSaveState("dirty");
        void saveBuilderRecovery(recoveryKey, revisionRef.current, next).catch(() => undefined);
        return next;
      });
    },
    [recoveryKey],
  );

  const enqueueSave = useCallback(
    (candidate: PresentationDraft): Promise<void> => {
      const serialized = JSON.stringify(candidate);
      if (serialized === lastSavedJson.current) return Promise.resolve();
      const mutationId = crypto.randomUUID();
      setSaveState("saving");
      void saveBuilderRecovery(recoveryKey, revisionRef.current, candidate).catch(() => undefined);
      const queued = saveQueue.current.enqueue(async () => {
        const response = await retryWithBackoff(() =>
          apiFetch<{ presentation: PresentationRecord }>(
            `/v1/presentations/${presentationId}/draft`,
            {
              method: "PUT",
              body: JSON.stringify({
                draft: candidate,
                expectedRevision: revisionRef.current,
                mutationId,
                schemaVersion: 1,
              }),
            },
          ),
        );
        revisionRef.current = response.presentation.draftRevision;
        lastSavedJson.current = serialized;
        setRecord(response.presentation);
        setSaveState("saved");
        setError("");
        if (latestDraftJson.current === serialized) {
          await clearBuilderRecovery(recoveryKey).catch(() => undefined);
        }
      });
      void queued.catch((caught) => {
        const conflict =
          caught instanceof ApiClientError &&
          (caught.code === "STALE_DRAFT" || caught.status === 409 || caught.status === 412);
        recordAuthoringEvent(conflict ? "draft_conflict" : "draft_save_failed", "presentation");
        setSaveState(conflict ? "conflict" : "error");
        setError(humanError(caught));
      });
      return queued;
    },
    [presentationId, recoveryKey],
  );

  useEffect(() => {
    if (!loaded || !draft) return;
    const serialized = JSON.stringify(draft);
    if (serialized === lastSavedJson.current) return;
    setSaveState("dirty");
    const timer = window.setTimeout(() => void enqueueSave(draft), 700);
    return () => window.clearTimeout(timer);
  }, [draft, enqueueSave, loaded]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        saveState === "dirty" ||
        saveState === "saving" ||
        saveState === "error" ||
        saveState === "conflict"
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  function guardBuilderExit(event: MouseEvent<HTMLAnchorElement>) {
    if (!draft) return;
    const needsRecovery =
      latestDraftJson.current !== lastSavedJson.current ||
      saveState === "dirty" ||
      saveState === "saving" ||
      saveState === "error" ||
      saveState === "conflict";
    if (!needsRecovery) return;
    void saveBuilderRecovery(recoveryKey, revisionRef.current, draft).catch(() => undefined);
    if (
      !window.confirm(
        "This Presentation still has changes that are pending, failed, or conflicted. A recovery copy has been kept on this device. Leave the Builder?",
      )
    ) {
      event.preventDefault();
    }
  }

  function moveInspectorTab(event: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = inspectorTabs.findIndex(({ id }) => id === inspectorTab);
    const nextIndex =
      event.key === "ArrowRight"
        ? (currentIndex + 1) % inspectorTabs.length
        : event.key === "ArrowLeft"
          ? (currentIndex - 1 + inspectorTabs.length) % inspectorTabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? inspectorTabs.length - 1
              : null;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = inspectorTabs[nextIndex];
    if (!next) return;
    setInspectorTab(next.id);
    window.requestAnimationFrame(() =>
      document.getElementById(`inspector-tab-${next.id}`)?.focus(),
    );
  }

  function updateSelected(
    updater: (block: PresentationBlockDraft) => PresentationBlockDraft,
    historyField?: string,
  ) {
    if (!selectedBlockId) return;
    commit(
      (current) => updateBlock(current, selectedBlockId, updater),
      historyField ? `${selectedBlockId}:${historyField}` : undefined,
    );
  }

  function updateQuestion(
    updater: (question: QuestionDraft) => QuestionDraft,
    historyField?: string,
  ) {
    updateSelected(
      (block) =>
        block.kind === "question" ? { ...block, question: updater(block.question) } : block,
      historyField ? `question:${historyField}` : undefined,
    );
  }

  function addBlock(block: PresentationBlockDraft) {
    commit((current) => {
      const selectedIndex = current.blocks.findIndex((item) => item.id === selectedBlockId);
      const blocks = [...current.blocks];
      blocks.splice(selectedIndex < 0 ? blocks.length : selectedIndex + 1, 0, block);
      return { ...current, blocks };
    });
    setSelectedBlockId(block.id);
    setInspectorTab(block.kind === "content" ? "content" : "build");
  }

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous || !draft) return;
    setRedoStack((history) => [...history, draft].slice(-HISTORY_LIMIT));
    setUndoStack((history) => history.slice(0, -1));
    lastHistoryCommit.current = null;
    setDraft(previous);
    latestDraftJson.current = JSON.stringify(previous);
    setSaveState("dirty");
    void saveBuilderRecovery(recoveryKey, revisionRef.current, previous).catch(() => undefined);
    if (!previous.blocks.some((block) => block.id === selectedBlockId)) {
      setSelectedBlockId(previous.blocks[0]?.id ?? null);
    }
  }

  function redo() {
    const next = redoStack.at(-1);
    if (!next || !draft) return;
    setUndoStack((history) => [...history, draft].slice(-HISTORY_LIMIT));
    setRedoStack((history) => history.slice(0, -1));
    lastHistoryCommit.current = null;
    setDraft(next);
    latestDraftJson.current = JSON.stringify(next);
    setSaveState("dirty");
    void saveBuilderRecovery(recoveryKey, revisionRef.current, next).catch(() => undefined);
  }

  async function reloadLatestDraft(preferredBlockId?: string) {
    setSaveState("saving");
    setError("");
    try {
      const response = await apiFetch<{ presentation: PresentationRecord }>(
        `/v1/presentations/${presentationId}`,
      );
      setRecord(response.presentation);
      setDraft(response.presentation.draft);
      setSelectedBlockId(
        preferredBlockId &&
          response.presentation.draft.blocks.some((block) => block.id === preferredBlockId)
          ? preferredBlockId
          : (response.presentation.draft.blocks[0]?.id ?? null),
      );
      setUndoStack([]);
      setRedoStack([]);
      lastHistoryCommit.current = null;
      revisionRef.current = response.presentation.draftRevision;
      lastSavedJson.current = JSON.stringify(response.presentation.draft);
      latestDraftJson.current = lastSavedJson.current;
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
    link.download = `${draft.title.trim() || "untitled-presentation"}-local-copy.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function duplicateLocalDraft() {
    if (!draft) return;
    setError("");
    try {
      const title = `${draft.title.trim() || "Untitled Presentation"} — recovered copy`;
      const created = await apiFetch<{ presentation: PresentationRecord }>("/v1/presentations", {
        method: "POST",
        body: JSON.stringify({ title, description: draft.description ?? "" }),
      });
      await apiFetch<{ presentation: PresentationRecord }>(
        `/v1/presentations/${created.presentation.id}/draft`,
        {
          method: "PUT",
          body: JSON.stringify({
            draft: { ...draft, title },
            expectedRevision: created.presentation.draftRevision,
            mutationId: crypto.randomUUID(),
            schemaVersion: 1,
          }),
        },
      );
      await clearBuilderRecovery(recoveryKey);
      router.push(`/presentation/${created.presentation.id}`);
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  async function uploadSelectedImage(file: File | null) {
    if (!file || !selectedBlock || mediaState !== "idle") return;
    const altText =
      selectedBlock.kind === "content"
        ? selectedBlock.mediaAlt?.trim()
        : selectedBlock.question.mediaAlt?.trim();
    if (!altText) {
      setError("Describe the instructional image before uploading it.");
      return;
    }
    const blockId = selectedBlock.id;
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
        media: { id: string; scanStatus: "clean" | "rejected" };
        downloadUrl?: string;
      }>(`/v1/media/${ticket.mediaId}/complete`, { method: "POST", body: "{}" });
      if (finalized.media.scanStatus !== "clean" || !finalized.downloadUrl) {
        throw new Error("The image did not pass security validation.");
      }
      commit((current) =>
        updateBlock(current, blockId, (block) =>
          block.kind === "content"
            ? { ...block, mediaId: ticket.mediaId, mediaAlt: altText }
            : {
                ...block,
                question: { ...block.question, mediaId: ticket.mediaId, mediaAlt: altText },
              },
        ),
      );
      setMediaPreviewUrl(finalized.downloadUrl);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setMediaState("idle");
    }
  }

  function removeSelectedImage() {
    if (!selectedBlock) return;
    updateSelected((block) =>
      block.kind === "content"
        ? { ...block, mediaId: null, mediaAlt: null }
        : { ...block, question: { ...block.question, mediaId: null, mediaAlt: null } },
    );
    setMediaPreviewUrl("");
  }

  function openRoundImport() {
    const first = roundSources[0]?.id ?? "";
    setSelectedRoundId((current) => current || first);
    setRoundImportOpen(true);
    setError("");
  }

  async function openSourceImport() {
    if (!draft) return;
    setError("");
    try {
      await enqueueSave(draft);
      const serialized = JSON.stringify(draft);
      if (lastSavedJson.current !== serialized || latestDraftJson.current !== serialized) {
        throw new Error("Save this Presentation before inserting source proposals.");
      }
      setSourceImportOpen(true);
    } catch (caught) {
      setError(humanError(caught));
    }
  }

  function toggleImportedQuestion(questionId: string) {
    setSelectedQuestionIds((current) =>
      current.includes(questionId)
        ? current.filter((candidate) => candidate !== questionId)
        : [...current, questionId],
    );
  }

  async function importRoundQuestions() {
    if (!draft || !publishedRound || !selectedQuestionIds.length) return;
    setImportingQuestions(true);
    setError("");
    try {
      await enqueueSave(draft);
      const serialized = JSON.stringify(draft);
      if (lastSavedJson.current !== serialized || latestDraftJson.current !== serialized) {
        throw new Error("Save this Presentation before importing questions.");
      }
      const response = await apiFetch<{
        presentation: PresentationRecord;
        insertedBlockIds: string[];
      }>(`/v1/presentations/${presentationId}/blocks/import`, {
        method: "POST",
        body: JSON.stringify({
          sourceQuizVersionId: publishedRound.versionId,
          questionIds: selectedQuestionIds,
          afterBlockId: selectedBlockId,
          expectedRevision: revisionRef.current,
          mutationId: crypto.randomUUID(),
        }),
      });
      if (draft) setUndoStack((history) => [...history, draft].slice(-HISTORY_LIMIT));
      setRedoStack([]);
      lastHistoryCommit.current = null;
      setRecord(response.presentation);
      setDraft(response.presentation.draft);
      revisionRef.current = response.presentation.draftRevision;
      lastSavedJson.current = JSON.stringify(response.presentation.draft);
      latestDraftJson.current = lastSavedJson.current;
      setSelectedBlockId(response.insertedBlockIds[0] ?? selectedBlockId);
      setRoundImportOpen(false);
      setSelectedQuestionIds([]);
      setSaveState("saved");
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setImportingQuestions(false);
    }
  }

  async function publish() {
    if (!draft) return;
    if (issues.length) {
      recordAuthoringEvent("publish_blocked", "presentation");
      setInspectorOpen(true);
      setInspectorTab("readiness");
      setError("Resolve the readiness issues before publishing.");
      return;
    }
    setError("");
    try {
      await enqueueSave(draft);
      const serialized = JSON.stringify(draft);
      if (lastSavedJson.current !== serialized || latestDraftJson.current !== serialized) {
        throw new Error("Save the latest Presentation changes before publishing.");
      }
      const response = await apiFetch<{ presentation: PresentationRecord }>(
        `/v1/presentations/${presentationId}/publish`,
        {
          method: "POST",
          body: JSON.stringify({ expectedDraftRevision: revisionRef.current }),
        },
      );
      setRecord(response.presentation);
      setSaveState("saved");
    } catch (caught) {
      if (
        caught instanceof ApiClientError &&
        (caught.code === "STALE_DRAFT" || caught.status === 409 || caught.status === 412)
      ) {
        recordAuthoringEvent("draft_conflict", "presentation");
      } else if (caught instanceof ApiClientError && caught.status === 422) {
        recordAuthoringEvent("publish_blocked", "presentation");
      }
      setError(humanError(caught));
    }
  }

  if (!draft || !record) {
    return (
      <main className={styles.loading}>
        <div className={styles.loadingMark} aria-hidden="true" />
        <p>{error || "Opening presentation builder…"}</p>
      </main>
    );
  }

  const questionBlocks = draft.blocks.flatMap((block) =>
    block.kind === "question" ? [block.question] : [],
  );
  const inspectorTabs: Array<{ id: InspectorTab; label: string }> =
    selectedBlock?.kind === "content"
      ? [
          { id: "content", label: "Content" },
          { id: "layout", label: "Layout" },
          { id: "media", label: "Media" },
          { id: "notes", label: "Notes" },
          { id: "accessibility", label: "Access" },
          { id: "readiness", label: `Ready ${issues.length ? `(${issues.length})` : "✓"}` },
        ]
      : [
          { id: "build", label: "Build" },
          { id: "diagnose", label: "Diagnose" },
          { id: "recover", label: "Recover" },
          { id: "readiness", label: `Ready ${issues.length ? `(${issues.length})` : "✓"}` },
        ];

  return (
    <div className={styles.builder}>
      <a className={styles.skipLink} href="#presentation-canvas">
        Skip to slide canvas
      </a>
      <header className={styles.commandBar}>
        <h1 className="sr-only">Presentation Builder: {draft.title}</h1>
        <div className={styles.commandStart}>
          <Link
            className={styles.exitLink}
            href="/library?type=presentations"
            onClick={guardBuilderExit}
          >
            ← Library
          </Link>
          <button
            aria-expanded={mapOpen}
            className={styles.iconButton}
            onClick={() => setMapOpen((value) => !value)}
            type="button"
          >
            {mapOpen ? "Hide map" : "Show map"}
          </button>
        </div>
        <label className={styles.titleField}>
          <span className="sr-only">Presentation title</span>
          <input
            maxLength={160}
            onChange={(event) =>
              commit((current) => ({ ...current, title: event.target.value }), "presentation:title")
            }
            placeholder="Untitled presentation"
            value={draft.title}
          />
        </label>
        <div className={styles.commandActions}>
          <span className={`${styles.saveStatus} ${styles[`save_${saveState}`]}`} role="status">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "dirty"
                ? "Unsaved"
                : saveState === "error"
                  ? "Save failed"
                  : saveState === "conflict"
                    ? "Newer version exists"
                    : "Saved"}
          </span>
          <button disabled={!undoStack.length} onClick={undo} type="button">
            Undo
          </button>
          <button disabled={!redoStack.length} onClick={redo} type="button">
            Redo
          </button>
          <button onClick={() => setPreviewOpen(true)} type="button">
            Preview
          </button>
          <button className={styles.publishButton} onClick={() => void publish()} type="button">
            {record.status === "published" && !record.hasUnpublishedChanges
              ? "Published"
              : "Publish"}
          </button>
          <button
            aria-expanded={inspectorOpen}
            className={styles.iconButton}
            onClick={() => setInspectorOpen((value) => !value)}
            type="button"
          >
            {inspectorOpen ? "Hide inspector" : "Open inspector"}
          </button>
        </div>
      </header>

      {recovery ? (
        <div className={styles.recoveryBanner} role="status">
          <span>
            A newer local edit from {new Date(recovery.savedAt).toLocaleString()} is available.
          </span>
          <button
            onClick={() => {
              commit(recovery.draft);
              setRecovery(null);
            }}
            type="button"
          >
            Restore local copy
          </button>
          <button
            onClick={() => {
              void clearBuilderRecovery(recoveryKey);
              setRecovery(null);
            }}
            type="button"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {draft.sourceDisclosure ? (
        <div className={styles.sourceBanner} role="note">
          <span>
            <strong>Grounded source:</strong> {draft.sourceDisclosure.sourceName} · generated by{" "}
            {draft.sourceDisclosure.provider} / {draft.sourceDisclosure.model}. Verify citations
            before publishing.
          </span>
          {draft.sourceDisclosure.conversionNotes?.length ? (
            <ul>
              {draft.sourceDisclosure.conversionNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className={styles.errorBanner} role="alert">
          <span>{error}</span>
          {saveState === "error" ? (
            <button onClick={() => void enqueueSave(draft)} type="button">
              Retry save
            </button>
          ) : null}
          {saveState === "conflict" ? (
            <>
              <button onClick={() => void reloadLatestDraft()} type="button">
                Reload current
              </button>
              <button onClick={preserveLocalCopy} type="button">
                Preserve local copy
              </button>
              <button onClick={() => void duplicateLocalDraft()} type="button">
                Duplicate as new
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <div
        className={`${styles.workspace} ${mapOpen ? "" : styles.mapClosed} ${inspectorOpen ? "" : styles.inspectorClosed}`}
      >
        <aside className={styles.map} aria-label="Presentation map">
          <div className={styles.mapHeader}>
            <div>
              <span className={styles.eyebrow}>Presentation map</span>
              <strong>{draft.blocks.length} blocks</strong>
            </div>
            <button onClick={() => setMapOpen(false)} type="button" aria-label="Collapse map">
              ‹
            </button>
          </div>
          <ol className={styles.blockList}>
            {draft.blocks.map((block, index) => (
              <li key={block.id}>
                <button
                  aria-current={selectedBlockId === block.id ? "step" : undefined}
                  className={selectedBlockId === block.id ? styles.blockActive : styles.blockButton}
                  onClick={() => setSelectedBlockId(block.id)}
                  type="button"
                >
                  <span className={styles.blockNumber}>{index + 1}</span>
                  <span className={styles.blockText}>
                    <small>{blockKindLabel(block)}</small>
                    <strong>{blockLabel(block, index)}</strong>
                  </span>
                  {issuesByBlock.has(block.id) ? (
                    <span
                      className={styles.issueBadge}
                      aria-label={`${issuesByBlock.get(block.id)} issues`}
                    >
                      {issuesByBlock.get(block.id)}
                    </span>
                  ) : (
                    <span className={styles.readyBadge} aria-label="Ready">
                      ✓
                    </span>
                  )}
                </button>
                {block.kind === "question" && block.question.linkedRecheckQuestionId ? (
                  <span className={styles.recoveryLink}>↳ paired recovery</span>
                ) : null}
              </li>
            ))}
          </ol>
          <div className={styles.addActions}>
            <button onClick={() => addBlock(createContentBlock())} type="button">
              + Content slide
            </button>
            <button onClick={() => addBlock(createQuestionBlock())} type="button">
              + Question
            </button>
            <button disabled={!roundSources.length} onClick={openRoundImport} type="button">
              + From published Round
            </button>
            <button onClick={() => void openSourceImport()} type="button">
              + From trusted source
            </button>
          </div>
        </aside>

        <main className={styles.canvasArea} id="presentation-canvas">
          {!mapOpen ? (
            <button
              className={styles.floatingMapButton}
              onClick={() => setMapOpen(true)}
              type="button"
            >
              Open map
            </button>
          ) : null}
          {!selectedBlock ? (
            <section className={styles.emptyCanvas}>
              <span className={styles.emptyGlyph}>✦</span>
              <h1>Build an interactive story</h1>
              <p>Add a content slide to explain, or a question to hear from the room.</p>
              <div>
                <button onClick={() => addBlock(createContentBlock())} type="button">
                  Add content slide
                </button>
                <button onClick={() => addBlock(createQuestionBlock())} type="button">
                  Add audience question
                </button>
                <button disabled={!roundSources.length} onClick={openRoundImport} type="button">
                  Reuse from a Round
                </button>
                <button onClick={() => void openSourceImport()} type="button">
                  Insert trusted source
                </button>
              </div>
            </section>
          ) : selectedBlock.kind === "content" ? (
            <section
              className={`${styles.slideCanvas} ${styles[`canvas_${selectedBlock.layout}`]}`}
            >
              <span className={styles.canvasEyebrow}>{selectedBlock.layout.replace("_", " ")}</span>
              <input
                aria-label="Slide title"
                className={styles.canvasTitle}
                maxLength={160}
                onChange={(event) =>
                  updateSelected(
                    (block) =>
                      block.kind === "content" ? { ...block, title: event.target.value } : block,
                    "title",
                  )
                }
                placeholder="Give this moment a clear title"
                value={selectedBlock.title}
              />
              <textarea
                aria-label="Slide body"
                className={styles.canvasBody}
                maxLength={4000}
                onChange={(event) =>
                  updateSelected(
                    (block) =>
                      block.kind === "content" ? { ...block, body: event.target.value } : block,
                    "body",
                  )
                }
                placeholder={
                  selectedBlock.layout === "quote"
                    ? "Add the quote or reflection prompt"
                    : "Add the context your audience needs"
                }
                value={selectedBlock.body}
              />
              {selectedBlock.mediaId ? (
                <div className={styles.canvasMedia}>
                  <AuthenticatedMedia
                    altText={selectedBlock.mediaAlt}
                    mediaId={selectedBlock.mediaId}
                  />
                </div>
              ) : null}
            </section>
          ) : (
            <section className={styles.questionCanvas}>
              <div className={styles.questionMeta}>
                <span>Interactive question</span>
                <span>{selectedBlock.question.timeLimitSeconds} seconds</span>
              </div>
              <textarea
                aria-label="Question prompt"
                className={styles.questionPrompt}
                maxLength={500}
                onChange={(event) =>
                  updateQuestion(
                    (question) => ({ ...question, prompt: event.target.value }),
                    "prompt",
                  )
                }
                placeholder="What do you want the room to think about?"
                value={selectedBlock.question.prompt}
              />
              {selectedBlock.question.mediaId ? (
                <div className={styles.canvasMedia}>
                  <AuthenticatedMedia
                    altText={selectedBlock.question.mediaAlt}
                    mediaId={selectedBlock.question.mediaId}
                  />
                </div>
              ) : null}
              <div className={styles.responseSurface}>
                <ResponseEditor
                  onStructuralChange={(question) => updateQuestion(() => question)}
                  onUpdateChoiceQuestion={(updater) =>
                    updateQuestion(
                      (question) => (isChoiceQuestion(question) ? updater(question) : question),
                      "response",
                    )
                  }
                  onUpdateQuestion={(updater) => updateQuestion(updater, "response")}
                  question={selectedBlock.question}
                  uxBeta
                />
              </div>
            </section>
          )}
          {selectedBlock ? (
            <div className={styles.canvasToolbar} aria-label="Selected block actions">
              <button
                disabled={draft.blocks[0]?.id === selectedBlock.id}
                onClick={() =>
                  commit((current) => movePresentationBlock(current, selectedBlock.id, -1))
                }
                type="button"
              >
                Move earlier
              </button>
              <button
                disabled={draft.blocks.at(-1)?.id === selectedBlock.id}
                onClick={() =>
                  commit((current) => movePresentationBlock(current, selectedBlock.id, 1))
                }
                type="button"
              >
                Move later
              </button>
              <button
                onClick={() => {
                  const copy = duplicatePresentationBlock(selectedBlock);
                  addBlock(copy);
                }}
                type="button"
              >
                Duplicate
              </button>
              <button
                className={styles.dangerButton}
                onClick={() => {
                  const index = draft.blocks.findIndex((block) => block.id === selectedBlock.id);
                  const remaining = draft.blocks.filter((block) => block.id !== selectedBlock.id);
                  commit((current) => removePresentationBlock(current, selectedBlock.id));
                  setSelectedBlockId(remaining[Math.min(index, remaining.length - 1)]?.id ?? null);
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          ) : null}
        </main>

        <aside className={styles.inspector} aria-label="Block inspector">
          <div
            className={styles.inspectorTabs}
            role="tablist"
            aria-label="Inspector sections"
            onKeyDown={moveInspectorTab}
          >
            {inspectorTabs.map((tab) => (
              <button
                id={`inspector-tab-${tab.id}`}
                aria-controls="inspector-panel"
                aria-selected={inspectorTab === tab.id}
                className={
                  inspectorTab === tab.id ? styles.inspectorTabActive : styles.inspectorTab
                }
                key={tab.id}
                onClick={() => setInspectorTab(tab.id)}
                role="tab"
                tabIndex={inspectorTab === tab.id ? 0 : -1}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div
            id="inspector-panel"
            className={styles.inspectorBody}
            role="tabpanel"
            aria-labelledby={`inspector-tab-${inspectorTab}`}
            tabIndex={0}
          >
            {inspectorTab === "readiness" ? (
              <section>
                <p className={styles.eyebrow}>Publish readiness</p>
                <h2>{issues.length ? `${issues.length} things to resolve` : "Ready to publish"}</h2>
                {issues.length ? (
                  <ul className={styles.issueList}>
                    {issues.map((issue, index) => (
                      <li key={`${issue.blockId}-${issue.field}-${index}`}>
                        <button
                          onClick={() => {
                            const issueBlock = draft.blocks.find(
                              (block) => block.id === issue.blockId,
                            );
                            if (issue.blockId) setSelectedBlockId(issue.blockId);
                            setInspectorTab(
                              issueBlock?.kind === "content"
                                ? issue.field === "mediaAlt"
                                  ? "accessibility"
                                  : "content"
                                : "build",
                            );
                          }}
                          type="button"
                        >
                          <span>Needs attention</span>
                          {issue.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className={styles.readyPanel}>
                    <span>✓</span>
                    <p>Every block has the information needed for a safe live session.</p>
                  </div>
                )}
              </section>
            ) : !selectedBlock ? (
              <p>Select a block to edit its properties.</p>
            ) : selectedBlock.kind === "content" ? (
              <section>
                <p className={styles.eyebrow}>Content slide</p>
                <h2>{inspectorTabs.find((tab) => tab.id === inspectorTab)?.label}</h2>
                {inspectorTab === "content" ? (
                  <>
                    <label className={styles.field}>
                      <span>Slide title</span>
                      <input
                        maxLength={160}
                        onChange={(event) =>
                          updateSelected(
                            (block) =>
                              block.kind === "content"
                                ? { ...block, title: event.target.value }
                                : block,
                            "title",
                          )
                        }
                        value={selectedBlock.title}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Body</span>
                      <textarea
                        maxLength={4000}
                        onChange={(event) =>
                          updateSelected(
                            (block) =>
                              block.kind === "content"
                                ? { ...block, body: event.target.value }
                                : block,
                            "body",
                          )
                        }
                        value={selectedBlock.body}
                      />
                    </label>
                  </>
                ) : inspectorTab === "layout" ? (
                  <>
                    <label className={styles.field}>
                      <span>Structured layout</span>
                      <select
                        onChange={(event) =>
                          updateSelected((block) =>
                            block.kind === "content"
                              ? { ...block, layout: event.target.value as ContentSlideLayout }
                              : block,
                          )
                        }
                        value={selectedBlock.layout}
                      >
                        {slideLayouts.map((layout) => (
                          <option key={layout.id} value={layout.id}>
                            {layout.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className={styles.helpText}>
                      Layouts adapt automatically for the host, audience, and mobile screens.
                    </p>
                  </>
                ) : inspectorTab === "media" ? (
                  <>
                    <label className={styles.field}>
                      <span>Image alternative text</span>
                      <textarea
                        maxLength={300}
                        onChange={(event) =>
                          updateSelected(
                            (block) =>
                              block.kind === "content"
                                ? { ...block, mediaAlt: event.target.value || null }
                                : block,
                            "mediaAlt",
                          )
                        }
                        placeholder="Describe what this image teaches"
                        value={selectedBlock.mediaAlt ?? ""}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Instructional image</span>
                      <input
                        accept="image/jpeg,image/png,image/webp"
                        disabled={!mediaUploadsEnabled || mediaState !== "idle"}
                        onChange={(event) => {
                          void uploadSelectedImage(event.target.files?.[0] ?? null);
                          event.currentTarget.value = "";
                        }}
                        type="file"
                      />
                    </label>
                    <p className={styles.helpText}>
                      {mediaUploadsEnabled
                        ? "JPEG, PNG, or WebP up to 10 MB. Uploads are quarantined and scanned."
                        : "Uploads are unavailable until malware scanning is configured."}
                    </p>
                    {mediaState !== "idle" ? (
                      <p className={styles.helpText} role="status">
                        {mediaState === "uploading"
                          ? "Uploading to quarantine…"
                          : "Checking image safety…"}
                      </p>
                    ) : null}
                    {mediaPreviewUrl ? (
                      <div className={styles.inspectorMedia}>
                        <img alt={selectedBlock.mediaAlt ?? ""} src={mediaPreviewUrl} />
                        <button
                          className={styles.dangerButton}
                          onClick={removeSelectedImage}
                          type="button"
                        >
                          Remove image
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : inspectorTab === "notes" ? (
                  <label className={styles.field}>
                    <span>Speaker notes</span>
                    <textarea
                      maxLength={2000}
                      onChange={(event) =>
                        updateSelected(
                          (block) =>
                            block.kind === "content"
                              ? { ...block, speakerNotes: event.target.value }
                              : block,
                          "speakerNotes",
                        )
                      }
                      placeholder="Private facilitation cues"
                      value={selectedBlock.speakerNotes}
                    />
                  </label>
                ) : (
                  <>
                    <label className={styles.field}>
                      <span>Image alternative text</span>
                      <textarea
                        disabled={!selectedBlock.mediaId}
                        maxLength={300}
                        onChange={(event) =>
                          updateSelected(
                            (block) =>
                              block.kind === "content"
                                ? { ...block, mediaAlt: event.target.value || null }
                                : block,
                            "mediaAlt",
                          )
                        }
                        placeholder="Describe the instructional image"
                        value={selectedBlock.mediaAlt ?? ""}
                      />
                    </label>
                    <p className={styles.helpText}>
                      Slide titles remain the primary heading. OpenRound preserves reading order
                      across host, participant, tablet, and mobile layouts.
                    </p>
                  </>
                )}
              </section>
            ) : (
              <section>
                <p className={styles.eyebrow}>Interactive block</p>
                <h2>
                  {inspectorTab === "build"
                    ? "Build"
                    : inspectorTab === "diagnose"
                      ? "Diagnose"
                      : "Recover"}
                </h2>
                {inspectorTab === "build" ? (
                  <>
                    <label className={styles.field}>
                      <span>Response type</span>
                      <select
                        onChange={(event) => {
                          const type = event.target.value as QuestionType;
                          commit((current) =>
                            changePresentationQuestionType(current, selectedBlock.id, type),
                          );
                        }}
                        value={selectedBlock.question.type}
                      >
                        {questionTypeOptions.map((option) => (
                          <option key={option.type} value={option.type}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>Time limit</span>
                      <select
                        onChange={(event) =>
                          updateQuestion((question) => ({
                            ...question,
                            timeLimitSeconds: Number(event.target.value),
                          }))
                        }
                        value={selectedBlock.question.timeLimitSeconds}
                      >
                        {[5, 10, 20, 30, 60, 90, 120, 300].map((seconds) => (
                          <option key={seconds} value={seconds}>
                            {seconds} seconds
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>Points</span>
                      <select
                        disabled={
                          selectedBlock.question.type === "poll" ||
                          selectedBlock.question.type === "rating"
                        }
                        onChange={(event) =>
                          updateQuestion((question) => ({
                            ...question,
                            basePoints: Number(event.target.value),
                          }))
                        }
                        value={selectedBlock.question.basePoints}
                      >
                        {[0, 500, 1000, 2000].map((points) => (
                          <option key={points} value={points}>
                            {points}
                          </option>
                        ))}
                      </select>
                    </label>
                    <MediaEditor
                      mediaPreviewUrl={mediaPreviewUrl}
                      mediaState={mediaState}
                      mediaUploadsEnabled={mediaUploadsEnabled}
                      onRemoveImage={removeSelectedImage}
                      onUpdateQuestion={(updater) => updateQuestion(updater, "media")}
                      onUploadImage={(file) => void uploadSelectedImage(file)}
                      question={selectedBlock.question}
                      uxBeta
                    />
                  </>
                ) : inspectorTab === "diagnose" ? (
                  <>
                    <label className={styles.field}>
                      <span>Purpose</span>
                      <select
                        onChange={(event) =>
                          updateQuestion((question) => ({
                            ...question,
                            purpose: event.target.value as "diagnostic" | "practice" | "opinion",
                          }))
                        }
                        value={selectedBlock.question.purpose ?? "diagnostic"}
                      >
                        <option value="diagnostic">Diagnostic</option>
                        <option value="practice">Practice</option>
                        <option value="opinion">Opinion</option>
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>Confidence prompt</span>
                      <select
                        disabled={
                          selectedBlock.question.type === "poll" ||
                          selectedBlock.question.type === "rating"
                        }
                        onChange={(event) =>
                          updateQuestion((question) => ({
                            ...question,
                            confidence: event.target.value as "off" | "optional" | "required",
                          }))
                        }
                        value={selectedBlock.question.confidence ?? "off"}
                      >
                        <option value="off">Off</option>
                        <option value="optional">Optional</option>
                        <option value="required">Required</option>
                      </select>
                    </label>
                    <label className={styles.field}>
                      <span>Concept keys</span>
                      <input
                        onChange={(event) =>
                          updateQuestion(
                            (question) => ({
                              ...question,
                              conceptKeys: event.target.value
                                .split(",")
                                .map((value) => value.trim())
                                .filter(Boolean),
                            }),
                            "conceptKeys",
                          )
                        }
                        placeholder="onboarding, policy-scope"
                        value={(selectedBlock.question.conceptKeys ?? []).join(", ")}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className={styles.field}>
                      <span>Delivery role</span>
                      <select
                        onChange={(event) =>
                          updateQuestion((question) => ({
                            ...question,
                            delivery: event.target.value as "main" | "recheck",
                            linkedRecheckQuestionId:
                              event.target.value === "recheck"
                                ? null
                                : question.linkedRecheckQuestionId,
                          }))
                        }
                        value={selectedBlock.question.delivery ?? "main"}
                      >
                        <option value="main">Main diagnostic</option>
                        <option value="recheck">Recovery recheck</option>
                      </select>
                    </label>
                    {(selectedBlock.question.delivery ?? "main") === "main" ? (
                      <label className={styles.field}>
                        <span>Paired recheck</span>
                        <select
                          onChange={(event) =>
                            updateQuestion((question) => ({
                              ...question,
                              linkedRecheckQuestionId: event.target.value || null,
                            }))
                          }
                          value={selectedBlock.question.linkedRecheckQuestionId ?? ""}
                        >
                          <option value="">No paired recheck</option>
                          {questionBlocks
                            .filter(
                              (question) =>
                                question.id !== selectedBlock.question.id &&
                                (question.delivery ?? "main") === "recheck",
                            )
                            .map((question) => (
                              <option key={question.id} value={question.id}>
                                {question.prompt || "Untitled recheck"}
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : null}
                    <label className={styles.field}>
                      <span>Reveal explanation</span>
                      <textarea
                        maxLength={1000}
                        onChange={(event) =>
                          updateQuestion(
                            (question) => ({
                              ...question,
                              explanation: event.target.value,
                            }),
                            "explanation",
                          )
                        }
                        placeholder="What should the facilitator reinforce?"
                        value={selectedBlock.question.explanation}
                      />
                    </label>
                  </>
                )}
              </section>
            )}
          </div>
        </aside>
      </div>
      {previewOpen ? (
        <PresentationPreview draft={draft} onClose={() => setPreviewOpen(false)} />
      ) : null}
      {roundImportOpen ? (
        <div
          ref={roundImportDialogRef}
          className={styles.previewBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="round-import-title"
          onKeyDown={(event) => handleModalKeyDown(event, () => setRoundImportOpen(false))}
          tabIndex={-1}
        >
          <section className={styles.importDialog}>
            <div>
              <p className={styles.eyebrow}>Independent question copies</p>
              <h2 id="round-import-title">Insert from a published Round</h2>
              <p className={styles.helpText}>
                OpenRound creates fresh block, question, and answer IDs. Recovery links are remapped
                only when both linked questions are selected.
              </p>
            </div>
            <label className={styles.field}>
              <span>Source Round</span>
              <select
                onChange={(event) => setSelectedRoundId(event.target.value)}
                value={selectedRoundId}
              >
                {roundSources.map((round) => (
                  <option key={round.id} value={round.id}>
                    {round.title}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className={styles.importQuestions}>
              <legend>Questions to copy</legend>
              {!publishedRound ? <p>Loading the published version…</p> : null}
              {publishedRound?.questions.map((question) => (
                <label key={question.id}>
                  <input
                    checked={selectedQuestionIds.includes(question.id)}
                    onChange={() => toggleImportedQuestion(question.id)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{question.prompt || "Untitled question"}</strong>
                    <small>
                      {responseTypeLabel(question.type)} · {question.delivery ?? "main"}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className={styles.importActions}>
              <button
                disabled={!selectedQuestionIds.length || importingQuestions}
                onClick={() => void importRoundQuestions()}
                type="button"
              >
                {importingQuestions
                  ? "Copying…"
                  : `Insert ${selectedQuestionIds.length || "selected"}`}
              </button>
              <button
                onClick={() => {
                  setRoundImportOpen(false);
                  setSelectedQuestionIds([]);
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {sourceImportOpen ? (
        <div
          ref={sourceImportDialogRef}
          className={styles.previewBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="source-import-title"
          onKeyDown={(event) => handleModalKeyDown(event, () => setSourceImportOpen(false))}
          tabIndex={-1}
        >
          <section className={`${styles.importDialog} ${styles.sourceImportDialog}`}>
            <div className={styles.sourceImportHeading}>
              <div>
                <p className={styles.eyebrow}>Review before insertion</p>
                <h2 id="source-import-title">Insert from a trusted source</h2>
                <p className={styles.helpText}>
                  Create a proposal, choose the cited content and Recovery questions you want, then
                  confirm once. Nothing is inserted while the proposal is processing.
                </p>
              </div>
              <button onClick={() => setSourceImportOpen(false)} type="button">
                Close
              </button>
            </div>
            <AuthoringAssistant
              artifactType="presentation"
              canEdit
              insertionTarget={{
                presentationId,
                expectedRevision: revisionRef.current,
                afterBlockId: selectedBlockId,
                onInserted: (insertedBlockIds) => {
                  setSourceImportOpen(false);
                  void reloadLatestDraft(insertedBlockIds[0]);
                },
              }}
              plain
              terminology="round"
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
