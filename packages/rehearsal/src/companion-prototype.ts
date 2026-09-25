export const COMPANION_PROTOTYPE_VERSION = "p0.1.0" as const;

export type CompanionPrototypePhase =
  | "lobby"
  | "question_open"
  | "paused"
  | "question_locked"
  | "question_reveal"
  | "intervention"
  | "leaderboard"
  | "finished";

export type CompanionPrototypeConnectionState = "connected" | "reconnecting" | "disconnected";

export type CompanionPrototypeAction =
  | "start"
  | "lock"
  | "resume"
  | "reveal"
  | "intervention.start"
  | "intervention.finish"
  | "recheck.open"
  | "next"
  | "none";

export interface CompanionPrototypeInput {
  phase: CompanionPrototypePhase;
  roundKind: "main" | "linked_recheck" | "revote";
  joinedCount: number;
  connectedCount: number;
  answeredCount: number;
  connectionState: CompanionPrototypeConnectionState;
  hasLinkedRecheck?: boolean;
  interventionFinished?: boolean;
}

export interface CompanionPrototypeProjection {
  version: typeof COMPANION_PROTOTYPE_VERSION;
  projection: "companion_prototype";
  phase: CompanionPrototypePhase;
  phaseLabel: string;
  roundKind: "main" | "linked_recheck" | "revote";
  roomStatus: {
    joinedCount: number;
    connectedCount: number;
    disconnectedCount: number;
    answeredCount: number;
  };
  connectionState: CompanionPrototypeConnectionState;
  primaryAction: {
    action: CompanionPrototypeAction;
    label: string;
    enabled: boolean;
  };
}

const COMPANION_PHASES: readonly CompanionPrototypePhase[] = [
  "lobby",
  "question_open",
  "paused",
  "question_locked",
  "question_reveal",
  "intervention",
  "leaderboard",
  "finished",
];
const COMPANION_ROUND_KINDS: readonly CompanionPrototypeInput["roundKind"][] = [
  "main",
  "linked_recheck",
  "revote",
];
const COMPANION_CONNECTION_STATES: readonly CompanionPrototypeConnectionState[] = [
  "connected",
  "reconnecting",
  "disconnected",
];

function safeCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function enumValue<const TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  fallback: TValue,
): TValue {
  return typeof value === "string" && allowed.includes(value as TValue)
    ? (value as TValue)
    : fallback;
}

function phaseLabel(input: CompanionPrototypeInput) {
  if (input.roundKind !== "main" && input.phase === "question_open") return "Recheck open";
  if (input.roundKind !== "main" && input.phase === "question_locked") return "Recheck locked";
  const labels: Record<CompanionPrototypePhase, string> = {
    lobby: "Lobby",
    question_open: "Question open",
    paused: "Paused",
    question_locked: "Diagnose",
    question_reveal: input.roundKind === "main" ? "Choose the next step" : "Recheck evidence",
    intervention: "Intervention in progress",
    leaderboard: "Standings",
    finished: "Complete",
  };
  return labels[input.phase];
}

function connectedAction(input: CompanionPrototypeInput): {
  action: CompanionPrototypeAction;
  label: string;
} {
  switch (input.phase) {
    case "lobby":
      return { action: "start", label: "Start round" };
    case "question_open":
      return { action: "lock", label: "Lock answers" };
    case "paused":
      return { action: "resume", label: "Resume" };
    case "question_locked":
      return { action: "reveal", label: "Reveal answer" };
    case "question_reveal":
      if (input.roundKind !== "main") return { action: "next", label: "Continue" };
      if (!input.interventionFinished) {
        return { action: "intervention.start", label: "Start intervention" };
      }
      if (input.hasLinkedRecheck) {
        return { action: "recheck.open", label: "Open linked recheck" };
      }
      return { action: "next", label: "Continue" };
    case "intervention":
      return { action: "intervention.finish", label: "Finish intervention" };
    case "leaderboard":
      return { action: "next", label: "Continue" };
    case "finished":
      return { action: "none", label: "Complete" };
  }
}

/**
 * Builds the allowlisted sidecar projection field-by-field so authoring data, answer keys,
 * identities, citations, and hidden diagnostics cannot flow through incidental input properties.
 */
export function buildCompanionPrototypeProjection(
  input: CompanionPrototypeInput,
): CompanionPrototypeProjection {
  const safeInput: CompanionPrototypeInput = {
    phase: enumValue(input.phase, COMPANION_PHASES, "finished"),
    roundKind: enumValue(input.roundKind, COMPANION_ROUND_KINDS, "main"),
    connectionState: enumValue(input.connectionState, COMPANION_CONNECTION_STATES, "disconnected"),
    joinedCount: input.joinedCount,
    connectedCount: input.connectedCount,
    answeredCount: input.answeredCount,
    hasLinkedRecheck: input.hasLinkedRecheck === true,
    interventionFinished: input.interventionFinished === true,
  };
  const joinedCount = safeCount(input.joinedCount);
  const connectedCount = Math.min(joinedCount, safeCount(input.connectedCount));
  const answeredCount = Math.min(joinedCount, safeCount(input.answeredCount));
  const disconnectedCount = Math.max(0, joinedCount - connectedCount);
  const connected = safeInput.connectionState === "connected";
  const action = connected
    ? connectedAction(safeInput)
    : {
        action: "none" as const,
        label: safeInput.connectionState === "reconnecting" ? "Reconnecting" : "Disconnected",
      };

  return {
    version: COMPANION_PROTOTYPE_VERSION,
    projection: "companion_prototype",
    phase: safeInput.phase,
    phaseLabel: phaseLabel(safeInput),
    roundKind: safeInput.roundKind,
    roomStatus: { joinedCount, connectedCount, disconnectedCount, answeredCount },
    connectionState: safeInput.connectionState,
    primaryAction: {
      ...action,
      enabled: connected && action.action !== "none",
    },
  };
}
