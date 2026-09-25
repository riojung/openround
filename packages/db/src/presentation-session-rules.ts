import type {
  PresentationSessionCreateInput,
  PresentationSessionRecord,
  PresentationSessionResponseRecord,
  PresentationSessionTransitionInput,
} from "./presentation-session-types.js";

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function normalizeSession(input: PresentationSessionCreateInput): PresentationSessionRecord {
  const settings = input.settings ?? { timeMode: "timed" as const };
  let questionOpenedAt = input.questionOpenedAt ?? null;
  let questionClosesAt = input.questionClosesAt ?? null;
  if (input.phase === "question_open" && questionOpenedAt === null) {
    questionOpenedAt = input.updatedAt;
  }
  if (input.phase === "question_open" && settings.timeMode === "flex") {
    questionClosesAt = null;
  } else if (input.phase === "question_open" && questionClosesAt === null) {
    const block = input.content.blocks[input.currentBlockIndex];
    if (block?.kind === "question" && questionOpenedAt) {
      questionClosesAt = new Date(
        questionOpenedAt.getTime() + block.question.timeLimitSeconds * 1_000,
      );
    }
  }
  return {
    ...input,
    settings,
    trustMode: input.trustMode ?? "learning",
    eventSeq: input.eventSeq ?? 0,
    questionOpenedAt,
    questionClosesAt,
  };
}

export function transitionWindow(
  session: PresentationSessionRecord,
  input: PresentationSessionTransitionInput,
  occurredAt: Date,
) {
  if (input.phase !== "question_open") {
    return { questionOpenedAt: null, questionClosesAt: null };
  }
  const questionOpenedAt = input.questionOpenedAt ?? occurredAt;
  if (session.settings.timeMode === "flex") {
    return { questionOpenedAt, questionClosesAt: null };
  }
  if (input.questionClosesAt instanceof Date) {
    return { questionOpenedAt, questionClosesAt: input.questionClosesAt };
  }
  const block = session.content.blocks[input.currentBlockIndex];
  return {
    questionOpenedAt,
    questionClosesAt:
      block?.kind === "question"
        ? new Date(questionOpenedAt.getTime() + block.question.timeLimitSeconds * 1_000)
        : null,
  };
}

export function responseWindowOpen(
  session: PresentationSessionRecord,
  response: PresentationSessionResponseRecord,
  expectedSessionRevision: number,
) {
  if (
    session.status !== "active" ||
    session.phase !== "question_open" ||
    session.revision !== expectedSessionRevision ||
    response.submittedAt >= session.liveExpiresAt
  ) {
    return false;
  }
  const block = session.content.blocks[session.currentBlockIndex];
  if (
    block?.kind !== "question" ||
    block.id !== response.blockId ||
    block.question.id !== response.questionId ||
    session.questionOpenedAt === null ||
    response.submittedAt < session.questionOpenedAt
  ) {
    return false;
  }
  return (
    session.questionClosesAt === null ||
    response.submittedAt.getTime() <= session.questionClosesAt.getTime()
  );
}
