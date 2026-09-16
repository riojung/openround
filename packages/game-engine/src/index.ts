import type {
  BrandTheme,
  HostAction,
  ParticipantView,
  PublicQuestion,
  Question,
  QuizDraft,
  SessionPhase,
  SessionSettings,
  SessionSnapshot,
} from "@openround/contracts";

export interface EngineParticipant {
  id: string;
  nickname: string;
  score: number;
  correctCount: number;
  acceptedResponseMs: number;
  connected: boolean;
  kicked: boolean;
}

export interface EngineAnswer {
  answerId: string;
  participantId: string;
  roundId: string;
  choiceId: string;
  acceptedAtMs: number;
  responseMs: number;
  score: number;
  correct: boolean;
  idempotencyKey: string;
}

export interface GameState {
  sessionId: string;
  code: string;
  quiz: QuizDraft;
  version: number;
  seq: number;
  phase: SessionPhase;
  questionIndex: number | null;
  roundId: string | null;
  openedAtMs: number | null;
  deadlineMs: number | null;
  pausedRemainingMs: number | null;
  pausedFrom: Exclude<SessionPhase, "paused"> | null;
  lobbyLocked: boolean;
  settings: SessionSettings;
  brandTheme: BrandTheme | null;
  participants: Record<string, EngineParticipant>;
  answers: Record<string, EngineAnswer>;
  rounds: Record<string, { questionId: string; position: number }>;
  processedCommands: Record<string, number>;
}

export type EngineEventType =
  | "lobby.updated"
  | "question.open"
  | "question.locked"
  | "question.reveal"
  | "leaderboard.updated"
  | "game.finished"
  | "session.snapshot";

export interface EngineEvent {
  type: EngineEventType;
  seq: number;
}

export interface TransitionResult {
  state: GameState;
  events: EngineEvent[];
  duplicate?: boolean;
}

export class EngineError extends Error {
  constructor(
    public readonly code:
      | "STALE_VERSION"
      | "CONFLICT"
      | "NOT_FOUND"
      | "SESSION_LOCKED"
      | "ANSWER_LATE"
      | "ANSWER_INVALID",
    message: string,
  ) {
    super(message);
  }
}

export function createGameState(input: {
  sessionId: string;
  code: string;
  quiz: QuizDraft;
  settings: SessionSettings;
  brandTheme?: BrandTheme | null;
}): GameState {
  return {
    sessionId: input.sessionId,
    code: input.code,
    quiz: input.quiz,
    version: 0,
    seq: 0,
    phase: "lobby",
    questionIndex: null,
    roundId: null,
    openedAtMs: null,
    deadlineMs: null,
    pausedRemainingMs: null,
    pausedFrom: null,
    lobbyLocked: false,
    settings: input.settings,
    brandTheme: input.brandTheme ?? null,
    participants: {},
    answers: {},
    rounds: {},
    processedCommands: {},
  };
}

export function calculateScore(input: {
  correct: boolean;
  basePoints: number;
  elapsedMs: number;
  limitMs: number;
  mode: SessionSettings["scoringMode"];
}): number {
  if (!input.correct) return 0;
  if (input.mode === "accuracy") return input.basePoints;
  const remainingFraction = Math.max(0, 1 - input.elapsedMs / input.limitMs);
  return Math.round(input.basePoints * (0.6 + 0.4 * remainingFraction));
}

function nextState(
  state: GameState,
  patch: Partial<GameState>,
  eventTypes: EngineEventType[],
): TransitionResult {
  const version = state.version + 1;
  let seq = state.seq;
  const events = eventTypes.map((type) => ({ type, seq: ++seq }));
  return { state: { ...state, ...patch, version, seq }, events };
}

function openQuestion(state: GameState, index: number, nowMs: number, roundId: string) {
  const question = state.quiz.questions[index];
  if (!question) throw new EngineError("NOT_FOUND", "Question does not exist");
  return nextState(
    state,
    {
      phase: "question_open",
      questionIndex: index,
      roundId,
      openedAtMs: nowMs,
      deadlineMs: nowMs + question.timeLimitSeconds * 1_000,
      pausedRemainingMs: null,
      pausedFrom: null,
      rounds: {
        ...state.rounds,
        [roundId]: { questionId: question.id, position: index },
      },
    },
    ["question.open"],
  );
}

export function applyHostCommand(
  state: GameState,
  input: {
    commandId: string;
    expectedVersion: number;
    action: HostAction;
    participantId?: string;
    nowMs: number;
    newRoundId: () => string;
  },
): TransitionResult {
  if (state.processedCommands[input.commandId] !== undefined) {
    return { state, events: [], duplicate: true };
  }
  if (input.expectedVersion !== state.version) {
    throw new EngineError("STALE_VERSION", "Session state changed; synchronize and retry");
  }

  let result: TransitionResult;
  switch (input.action) {
    case "start":
      if (state.phase !== "lobby" || state.quiz.questions.length === 0) {
        throw new EngineError("CONFLICT", "The session cannot start from its current state");
      }
      result = openQuestion(state, 0, input.nowMs, input.newRoundId());
      break;
    case "pause": {
      if (state.phase !== "question_open" || state.deadlineMs === null) {
        throw new EngineError("CONFLICT", "Only an open question can be paused");
      }
      result = nextState(
        state,
        {
          phase: "paused",
          pausedFrom: "question_open",
          pausedRemainingMs: Math.max(0, state.deadlineMs - input.nowMs),
          deadlineMs: null,
        },
        ["session.snapshot"],
      );
      break;
    }
    case "resume": {
      if (state.phase !== "paused" || state.pausedRemainingMs === null) {
        throw new EngineError("CONFLICT", "The session is not paused");
      }
      result = nextState(
        state,
        {
          phase: state.pausedFrom ?? "question_open",
          deadlineMs: input.nowMs + state.pausedRemainingMs,
          pausedRemainingMs: null,
          pausedFrom: null,
        },
        ["session.snapshot"],
      );
      break;
    }
    case "lock":
      if (state.phase !== "question_open" && state.phase !== "paused") {
        throw new EngineError("CONFLICT", "Only an active question can be locked");
      }
      result = nextState(
        state,
        { phase: "question_locked", deadlineMs: null, pausedRemainingMs: null, pausedFrom: null },
        ["question.locked"],
      );
      break;
    case "reveal":
      if (state.phase !== "question_locked") {
        throw new EngineError("CONFLICT", "Lock the question before revealing the answer");
      }
      result = nextState(state, { phase: "question_reveal" }, ["question.reveal"]);
      break;
    case "show_leaderboard":
      if (state.phase !== "question_reveal") {
        throw new EngineError("CONFLICT", "Reveal the answer before showing the leaderboard");
      }
      result = nextState(state, { phase: "leaderboard" }, ["leaderboard.updated"]);
      break;
    case "next": {
      if (state.phase !== "question_reveal" && state.phase !== "leaderboard") {
        throw new EngineError("CONFLICT", "Finish the current question before advancing");
      }
      const nextIndex = (state.questionIndex ?? -1) + 1;
      result =
        nextIndex >= state.quiz.questions.length
          ? nextState(state, { phase: "finished", deadlineMs: null }, ["game.finished"])
          : openQuestion(state, nextIndex, input.nowMs, input.newRoundId());
      break;
    }
    case "end":
      if (state.phase === "finished") {
        throw new EngineError("CONFLICT", "The session has already finished");
      }
      result = nextState(state, { phase: "finished", deadlineMs: null }, ["game.finished"]);
      break;
    case "lock_lobby":
      result = nextState(state, { lobbyLocked: true }, ["lobby.updated"]);
      break;
    case "unlock_lobby":
      result = nextState(state, { lobbyLocked: false }, ["lobby.updated"]);
      break;
    case "kick": {
      if (state.phase === "finished") {
        throw new EngineError("CONFLICT", "A finished session cannot be changed");
      }
      const participant = input.participantId ? state.participants[input.participantId] : undefined;
      if (!participant || participant.kicked) {
        throw new EngineError("NOT_FOUND", "Participant not found");
      }
      result = nextState(
        state,
        {
          participants: {
            ...state.participants,
            [participant.id]: { ...participant, connected: false, kicked: true },
          },
        },
        ["lobby.updated"],
      );
      break;
    }
    default: {
      const exhaustive: never = input.action;
      throw new EngineError("CONFLICT", `Unsupported command: ${String(exhaustive)}`);
    }
  }

  result.state.processedCommands = {
    ...result.state.processedCommands,
    [input.commandId]: result.state.version,
  };
  return result;
}

export function addParticipant(state: GameState, participant: EngineParticipant): TransitionResult {
  if (state.lobbyLocked) throw new EngineError("SESSION_LOCKED", "The lobby is locked");
  const existing = state.participants[participant.id];
  return nextState(
    state,
    {
      participants: {
        ...state.participants,
        [participant.id]: existing ? { ...existing, connected: true } : participant,
      },
    },
    ["lobby.updated"],
  );
}

export function setParticipantConnection(
  state: GameState,
  participantId: string,
  connected: boolean,
): TransitionResult {
  const participant = state.participants[participantId];
  if (!participant) throw new EngineError("NOT_FOUND", "Participant not found");
  return nextState(
    state,
    {
      participants: {
        ...state.participants,
        [participantId]: { ...participant, connected },
      },
    },
    ["lobby.updated"],
  );
}

export function acceptAnswer(
  state: GameState,
  input: {
    answerId: string;
    participantId: string;
    roundId: string;
    choiceId: string;
    idempotencyKey: string;
    nowMs: number;
  },
): { state: GameState; answer: EngineAnswer } {
  const duplicate = Object.values(state.answers).find(
    (answer) => answer.idempotencyKey === input.idempotencyKey,
  );
  if (duplicate) return { state, answer: duplicate };
  if (
    state.phase !== "question_open" ||
    !state.roundId ||
    state.roundId !== input.roundId ||
    state.deadlineMs === null ||
    state.openedAtMs === null
  ) {
    throw new EngineError("CONFLICT", "The question is not accepting answers");
  }
  if (input.nowMs > state.deadlineMs) {
    throw new EngineError("ANSWER_LATE", "The answer arrived after the server deadline");
  }
  const participant = state.participants[input.participantId];
  if (!participant || participant.kicked) {
    throw new EngineError("NOT_FOUND", "Participant not found");
  }
  const prior = Object.values(state.answers).find(
    (answer) => answer.participantId === input.participantId && answer.roundId === input.roundId,
  );
  if (prior) return { state, answer: prior };
  const question = state.quiz.questions[state.questionIndex ?? -1];
  if (!question) throw new EngineError("NOT_FOUND", "Question not found");
  const choice = question.choices.find((candidate) => candidate.id === input.choiceId);
  if (!choice) throw new EngineError("ANSWER_INVALID", "Choice not found");

  const responseMs = Math.max(0, input.nowMs - state.openedAtMs);
  const score = calculateScore({
    correct: choice.isCorrect,
    basePoints: question.basePoints,
    elapsedMs: responseMs,
    limitMs: question.timeLimitSeconds * 1_000,
    mode: state.settings.scoringMode,
  });
  const answer: EngineAnswer = {
    answerId: input.answerId,
    participantId: input.participantId,
    roundId: input.roundId,
    choiceId: input.choiceId,
    acceptedAtMs: input.nowMs,
    responseMs,
    score,
    correct: choice.isCorrect,
    idempotencyKey: input.idempotencyKey,
  };
  return {
    answer,
    state: {
      ...state,
      version: state.version + 1,
      seq: state.seq + 1,
      answers: { ...state.answers, [answer.answerId]: answer },
      participants: {
        ...state.participants,
        [participant.id]: {
          ...participant,
          score: participant.score + score,
          correctCount: participant.correctCount + (choice.isCorrect ? 1 : 0),
          acceptedResponseMs: participant.acceptedResponseMs + responseMs,
        },
      },
    },
  };
}

export function leaderboard(state: GameState): ParticipantView[] {
  const sorted = Object.values(state.participants)
    .filter((participant) => !participant.kicked)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.correctCount - a.correctCount ||
        a.acceptedResponseMs - b.acceptedResponseMs ||
        a.id.localeCompare(b.id),
    );
  return sorted.map((participant, index) => ({
    id: participant.id,
    nickname: participant.nickname,
    score: participant.score,
    connected: participant.connected,
    rank: index + 1,
  }));
}

function publicQuestion(question: Question | undefined): PublicQuestion | null {
  if (!question) return null;
  return {
    id: question.id,
    prompt: question.prompt,
    choices: question.choices.map(({ id, label }) => ({ id, label })),
    timeLimitSeconds: question.timeLimitSeconds,
    basePoints: question.basePoints,
    mediaId: question.mediaId,
    mediaAlt: question.mediaAlt,
  };
}

export function snapshotForRole(
  state: GameState,
  options: { role: "host" | "participant" | "presenter"; participantId?: string },
): SessionSnapshot {
  const question =
    state.questionIndex === null ? undefined : state.quiz.questions[state.questionIndex];
  const visibleParticipants = leaderboard(state).map((participant) => ({
    ...participant,
    nickname:
      state.settings.resultVisibility === "private" && options.role === "participant"
        ? participant.id === options.participantId
          ? participant.nickname
          : "Participant"
        : participant.nickname,
    score:
      state.settings.resultVisibility === "private" &&
      options.role === "participant" &&
      participant.id !== options.participantId
        ? 0
        : participant.score,
    rank:
      state.settings.resultVisibility === "private" &&
      options.role === "participant" &&
      participant.id !== options.participantId
        ? null
        : participant.rank,
  }));
  const participantAnswer = Object.values(state.answers).find(
    (answer) => answer.participantId === options.participantId && answer.roundId === state.roundId,
  );
  const revealed =
    state.phase === "question_reveal" ||
    state.phase === "leaderboard" ||
    state.phase === "finished";
  return {
    sessionId: state.sessionId,
    code: state.code,
    version: state.version,
    seq: state.seq,
    phase: state.phase,
    roundId: state.roundId,
    questionIndex: state.questionIndex,
    questionCount: state.quiz.questions.length,
    question: publicQuestion(question),
    deadline: state.deadlineMs ? new Date(state.deadlineMs).toISOString() : null,
    participants: visibleParticipants,
    answerCount: Object.values(state.answers).filter((answer) => answer.roundId === state.roundId)
      .length,
    lobbyLocked: state.lobbyLocked,
    settings: state.settings,
    brandTheme: state.brandTheme ?? null,
    pausedRemainingMs: state.pausedRemainingMs,
    myParticipantId: options.participantId ?? null,
    myAnswerChoiceId: participantAnswer?.choiceId ?? null,
    correctChoiceId: revealed
      ? (question?.choices.find((choice) => choice.isCorrect)?.id ?? null)
      : undefined,
    explanation: revealed ? (question?.explanation ?? "") : undefined,
  };
}
