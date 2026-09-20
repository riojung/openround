import {
  PresentationContentSchema,
  type ContentSlideDraft,
  type ContentSlideLayout,
  type InteractiveQuestionBlockDraft,
  type PresentationBlockDraft,
  type PresentationDraft,
  type QuestionDraft,
  type QuestionType,
} from "@openround/contracts";
import { clientUuid } from "./uuid";

export interface PresentationIssue {
  blockId: string | null;
  field: string;
  message: string;
}

function choiceSet(
  type: Extract<QuestionType, "single_select" | "true_false" | "multi_select" | "poll">,
) {
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

export function createPresentationQuestion(type: QuestionType): QuestionDraft {
  const common = {
    id: clientUuid(),
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
  if (type === "numeric") {
    return { ...common, type, correctValue: "", tolerance: "0", unit: null };
  }
  if (type === "rating") {
    return { ...common, type, min: 1, max: 5, minLabel: "Low", maxLabel: "High" };
  }
  return { ...common, type, choices: choiceSet(type) };
}

export function createContentBlock(layout: ContentSlideLayout = "title_body"): ContentSlideDraft {
  return {
    id: clientUuid(),
    kind: "content",
    layout,
    title: "",
    body: "",
    mediaId: null,
    mediaAlt: null,
    speakerNotes: "",
  };
}

export function createQuestionBlock(
  type: QuestionType = "single_select",
): InteractiveQuestionBlockDraft {
  return { id: clientUuid(), kind: "question", question: createPresentationQuestion(type) };
}

export function changePresentationQuestionType(
  draft: PresentationDraft,
  blockId: string,
  type: QuestionType,
): PresentationDraft {
  const selected = draft.blocks.find(
    (block): block is InteractiveQuestionBlockDraft =>
      block.id === blockId && block.kind === "question",
  );
  if (!selected || selected.question.type === type) return draft;

  const previous = selected.question;
  const opinionOnly = type === "poll" || type === "rating";
  const next: QuestionDraft = {
    ...createPresentationQuestion(type),
    id: previous.id,
    prompt: previous.prompt,
    explanation: previous.explanation,
    delivery: opinionOnly ? "main" : previous.delivery,
    conceptKeys: previous.conceptKeys,
    purpose: opinionOnly ? "opinion" : previous.purpose,
    confidence: opinionOnly ? "off" : previous.confidence,
    linkedRecheckQuestionId: opinionOnly ? null : previous.linkedRecheckQuestionId,
    mediaId: previous.mediaId,
    mediaAlt: previous.mediaAlt,
    sourceCitations: previous.sourceCitations,
  };
  const detachedRecheck = opinionOnly && (previous.delivery ?? "main") === "recheck";
  const detachedTargetId = opinionOnly ? previous.linkedRecheckQuestionId : null;
  const detachedTargetHasAnotherSource =
    detachedTargetId !== null && detachedTargetId !== undefined
      ? draft.blocks.some(
          (block) =>
            block.kind === "question" &&
            block.question.id !== previous.id &&
            block.question.linkedRecheckQuestionId === detachedTargetId,
        )
      : false;

  return {
    ...draft,
    blocks: draft.blocks.map((block) => {
      if (block.id === blockId) return { ...selected, question: next };
      if (
        detachedRecheck &&
        block.kind === "question" &&
        block.question.linkedRecheckQuestionId === previous.id
      ) {
        return {
          ...block,
          question: { ...block.question, linkedRecheckQuestionId: null },
        };
      }
      if (
        detachedTargetId &&
        !detachedTargetHasAnotherSource &&
        block.kind === "question" &&
        block.question.id === detachedTargetId
      ) {
        return {
          ...block,
          question: { ...block.question, delivery: "main" },
        };
      }
      return block;
    }),
  };
}

export function movePresentationBlock(
  draft: PresentationDraft,
  blockId: string,
  direction: -1 | 1,
): PresentationDraft {
  const source = draft.blocks.findIndex((block) => block.id === blockId);
  const target = source + direction;
  if (source < 0 || target < 0 || target >= draft.blocks.length) return draft;
  const blocks = [...draft.blocks];
  [blocks[source], blocks[target]] = [blocks[target]!, blocks[source]!];
  return { ...draft, blocks };
}

export function removePresentationBlock(
  draft: PresentationDraft,
  blockId: string,
): PresentationDraft {
  const removed = draft.blocks.find((block) => block.id === blockId);
  const removedQuestionId = removed?.kind === "question" ? removed.question.id : null;
  return {
    ...draft,
    blocks: draft.blocks
      .filter((block) => block.id !== blockId)
      .map((block) =>
        removedQuestionId &&
        block.kind === "question" &&
        block.question.linkedRecheckQuestionId === removedQuestionId
          ? {
              ...block,
              question: { ...block.question, linkedRecheckQuestionId: null },
            }
          : block,
      ),
  };
}

export function duplicatePresentationBlock(block: PresentationBlockDraft): PresentationBlockDraft {
  if (block.kind === "content") return { ...block, id: clientUuid() };
  const choiceIds = new Map<string, string>();
  const question = structuredClone(block.question);
  question.id = clientUuid();
  question.linkedRecheckQuestionId = null;
  if ("choices" in question) {
    question.choices = question.choices.map((choice) => {
      const id = clientUuid();
      choiceIds.set(choice.id, id);
      return { ...choice, id };
    });
  }
  return { id: clientUuid(), kind: "question", question };
}

export function presentationReadiness(draft: PresentationDraft): PresentationIssue[] {
  const issues: PresentationIssue[] = [];
  if (!draft.title.trim()) {
    issues.push({ blockId: null, field: "title", message: "Give this presentation a title." });
  }
  if (draft.blocks.length === 0) {
    issues.push({ blockId: null, field: "blocks", message: "Add at least one slide." });
  }
  if (!draft.blocks.some((block) => block.kind === "question")) {
    issues.push({
      blockId: null,
      field: "blocks",
      message: "Add at least one interactive question before publishing.",
    });
  }

  const questions = new Map(
    draft.blocks.flatMap((block) =>
      block.kind === "question" ? [[block.question.id, block.question] as const] : [],
    ),
  );
  for (const block of draft.blocks) {
    if (block.kind === "content") {
      if (!block.title.trim() && !block.body.trim() && !block.mediaId) {
        issues.push({ blockId: block.id, field: "title", message: "Add content to this slide." });
      }
      if (block.mediaId && !block.mediaAlt?.trim()) {
        issues.push({
          blockId: block.id,
          field: "mediaAlt",
          message: "Add alternative text for the slide image.",
        });
      }
      continue;
    }

    const question = block.question;
    if (!question.prompt.trim()) {
      issues.push({ blockId: block.id, field: "prompt", message: "Write the question prompt." });
    }
    if ("choices" in question) {
      if (question.choices.some((choice) => !choice.label.trim())) {
        issues.push({
          blockId: block.id,
          field: "choices",
          message: "Complete every answer choice.",
        });
      }
      const correct = question.choices.filter((choice) => choice.isCorrect).length;
      if (question.type !== "poll" && correct === 0) {
        issues.push({
          blockId: block.id,
          field: "choices",
          message: "Mark at least one correct answer.",
        });
      }
      if (question.type !== "poll" && question.type !== "multi_select" && correct > 1) {
        issues.push({
          blockId: block.id,
          field: "choices",
          message: "Mark exactly one correct answer.",
        });
      }
    } else if (question.type === "numeric" && !question.correctValue.trim()) {
      issues.push({
        blockId: block.id,
        field: "correctValue",
        message: "Enter the correct numeric value.",
      });
    }
    if (question.mediaId && !question.mediaAlt?.trim()) {
      issues.push({
        blockId: block.id,
        field: "mediaAlt",
        message: "Add alternative text for the question image.",
      });
    }
    if (question.linkedRecheckQuestionId) {
      const recheck = questions.get(question.linkedRecheckQuestionId);
      if (!recheck || (recheck.delivery ?? "main") !== "recheck") {
        issues.push({
          blockId: block.id,
          field: "linkedRecheckQuestionId",
          message: "Choose a valid recheck question.",
        });
      }
    }
  }
  const strict = PresentationContentSchema.safeParse(draft);
  if (!strict.success) {
    for (const issue of strict.error.issues) {
      const blockIndex = issue.path[0] === "blocks" ? Number(issue.path[1]) : -1;
      const blockId = Number.isInteger(blockIndex) ? (draft.blocks[blockIndex]?.id ?? null) : null;
      const field = [...issue.path].reverse().find((segment) => typeof segment === "string");
      if (
        issues.some(
          (existing) => existing.blockId === blockId && existing.message === issue.message,
        )
      ) {
        continue;
      }
      issues.push({
        blockId,
        field: typeof field === "string" ? field : "artifact",
        message: issue.message,
      });
    }
  }
  return issues;
}
