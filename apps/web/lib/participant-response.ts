import type {
  AnswerAck,
  ConfidenceValue,
  ResponsePayload,
  SessionSnapshot,
} from "@openround/contracts";

export type ParticipantProgressStage =
  "waiting" | "answering" | "saved" | "discussing" | "reviewing" | "rechecking" | "complete";

export function participantProgressStage(
  snapshot: SessionSnapshot,
  responseSaved: boolean,
): ParticipantProgressStage {
  if (snapshot.phase === "finished") return "complete";
  if (snapshot.phase === "intervention") return "discussing";
  if (snapshot.phase === "question_reveal" || snapshot.phase === "leaderboard") {
    return "reviewing";
  }
  if (snapshot.roundKind === "linked_recheck" || snapshot.roundKind === "revote") {
    return "rechecking";
  }
  if (snapshot.phase === "question_open") return responseSaved ? "saved" : "answering";
  if (responseSaved && snapshot.phase === "question_locked") {
    return "saved";
  }
  return "waiting";
}

export interface ParticipantResponseView {
  saved: boolean;
  choiceIds: string[];
  numericValue: string;
  ratingValue: number | null;
  confidence: ConfidenceValue | null;
}

export interface LocalResponseReceipt {
  response: ResponsePayload;
  confidence: ConfidenceValue | null;
}

export function participantResponseControlsDisabled(input: {
  questionOpen: boolean;
  saved: boolean;
  submitting: boolean;
}) {
  return !input.questionOpen || input.saved || input.submitting;
}

export function participantResponseView(
  serverResponse: ResponsePayload | null | undefined,
  serverConfidence: ConfidenceValue | null | undefined,
  acknowledgement: AnswerAck | null,
  localReceipt: LocalResponseReceipt | null = null,
): ParticipantResponseView {
  const acknowledgedResponse = acknowledgement?.accepted ? localReceipt?.response : null;
  const visibleResponse = serverResponse ?? acknowledgedResponse;
  return {
    saved: Boolean(serverResponse || acknowledgement?.accepted),
    choiceIds:
      visibleResponse?.kind === "choice" || visibleResponse?.kind === "poll"
        ? visibleResponse.choiceIds
        : [],
    numericValue: visibleResponse?.kind === "numeric" ? visibleResponse.value : "",
    ratingValue: visibleResponse?.kind === "rating" ? visibleResponse.value : null,
    confidence: serverResponse
      ? (serverConfidence ?? null)
      : acknowledgement?.accepted
        ? (localReceipt?.confidence ?? null)
        : null,
  };
}
