import type { HostAction, SessionDecisionEvent } from "@openround/contracts";
import type { SessionDecisionEventWrite } from "@openround/db";
import { CHECKPOINT_INSIGHT_RULESET_VERSION } from "@openround/insights";
import { snapshotForRole, type EngineEvent, type GameState } from "@openround/game-engine";

export function decisionEventsForTransition(input: {
  before: GameState;
  after: GameState;
  engineEvents: EngineEvent[];
  action: HostAction | "deadline";
  commandId: string;
  occurredAt: Date;
}): SessionDecisionEventWrite[] {
  const { before, after, engineEvents, action, commandId, occurredAt } = input;
  const emitted = new Set(engineEvents.map((event) => event.type));
  const occurredAtIso = occurredAt.toISOString();
  const events: SessionDecisionEvent[] = [];
  const activeRound = after.roundId ? after.rounds[after.roundId] : undefined;

  if (
    before.phase !== "question_locked" &&
    after.phase === "question_locked" &&
    emitted.has("checkpoint.insight") &&
    activeRound &&
    after.roundId &&
    after.questionIndex !== null
  ) {
    const insight = snapshotForRole(after, { role: "host" }).insight;
    if (insight) {
      events.push({
        seq: engineEvents.find((event) => event.type === "checkpoint.insight")!.seq,
        occurredAt: occurredAtIso,
        type: "insight_shown",
        roundId: after.roundId,
        questionId: activeRound.questionId,
        sampleSize: insight.sampleSize,
        activeParticipantCount: insight.activeParticipantCount,
        recommendationCode: insight.recommendation.code,
        ruleSetVersion: CHECKPOINT_INSIGHT_RULESET_VERSION,
      });
    }
  }

  if (emitted.has("question.reveal") && after.roundId && activeRound) {
    events.push({
      seq: engineEvents.find((event) => event.type === "question.reveal")!.seq,
      occurredAt: occurredAtIso,
      type: "answer_revealed",
      roundId: after.roundId,
      questionId: activeRound.questionId,
    });
  }

  if (emitted.has("intervention.updated") && after.roundId) {
    const intervention = after.intervention ?? before.intervention;
    if (intervention) {
      const finished = intervention.finishedAtMs !== null;
      events.push({
        seq: engineEvents.find((event) => event.type === "intervention.updated")!.seq,
        occurredAt: occurredAtIso,
        type: finished ? "intervention_finished" : "intervention_started",
        roundId: intervention.sourceRoundId,
        interventionType: intervention.type,
        ...(intervention.recoveryPackCard
          ? { recoveryPackCard: intervention.recoveryPackCard }
          : {}),
      });
    }
  }

  if (emitted.has("recheck.open") && after.roundId && activeRound?.sourceRoundId) {
    events.push({
      seq: engineEvents.find((event) => event.type === "recheck.open")!.seq,
      occurredAt: occurredAtIso,
      type: "recheck_opened",
      sourceRoundId: activeRound.sourceRoundId,
      roundId: after.roundId,
      questionId: activeRound.questionId,
      kind: activeRound.kind === "linked_recheck" ? "linked_recheck" : "revote",
    });
  }

  if (
    action === "next" &&
    emitted.has("question.open") &&
    before.roundId &&
    after.roundId &&
    before.roundId !== after.roundId &&
    activeRound
  ) {
    events.push({
      seq: engineEvents.find((event) => event.type === "question.open")!.seq,
      occurredAt: occurredAtIso,
      type: "question_advanced",
      fromRoundId: before.roundId,
      toRoundId: after.roundId,
      questionId: activeRound.questionId,
    });
  }

  if (before.phase !== "finished" && after.phase === "finished") {
    const finishedEvent = engineEvents.find((event) => event.type === "game.finished");
    if (finishedEvent) {
      events.push({
        seq: finishedEvent.seq,
        occurredAt: occurredAtIso,
        type: "session_finished",
        reason: action === "next" ? "completed" : "host_ended",
      });
    }
  }

  return events
    .sort((left, right) => left.seq - right.seq)
    .map((event, eventOrdinal) => ({ event, commandId, eventOrdinal }));
}
