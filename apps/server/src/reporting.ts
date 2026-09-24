import { randomUUID } from "node:crypto";
import {
  questionDelivery,
  questionPurpose,
  type Report,
  type ReportV3,
} from "@openround/contracts";
import type { SessionEvidence } from "@openround/db";
import { avatarIdForSeed, responseDistributionFor, type GameState } from "@openround/game-engine";

const evidenceNote =
  "Recovery is evidence from this session and should not be interpreted as proof of long-term learning.";

function percent(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 1_000) / 10 : 0;
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

function stateEvidence(state: GameState): SessionEvidence {
  return {
    answers: Object.values(state.answers),
    rounds: Object.entries(state.rounds).map(([id, round]) => ({ id, ...round })),
    interventions: Object.values(state.interventions),
    qna: { questions: 0, answered: 0, unresolved: 0 },
    interactions: {
      signalEvents: [],
      chatMessages: [],
      reactions: [],
      reports: 0,
      moderationActions: 0,
    },
  };
}

function emptyReportFields(state: GameState) {
  return {
    trustMode: state.settings.trustMode ?? "learning",
    metrics: {
      participantCount: Object.values(state.participants).filter(
        (participant) => !participant.kicked,
      ).length,
      completedCount: 0,
      answerCount: 0,
      accuracyPercent: 0,
    },
    questions: [],
    participants: [],
    initialAccuracy: { correct: 0, responses: 0, percent: 0 },
    confidenceMatrix: [1, 2, 3].map((confidence) => ({
      confidence: confidence as 1 | 2 | 3,
      correct: 0,
      incorrect: 0,
      total: 0,
    })),
    misconceptions: [],
    interventions: [],
    recovery: [],
    unresolvedConcepts: [],
    participation: {
      participants: Object.values(state.participants).filter((participant) => !participant.kicked)
        .length,
      respondents: 0,
      percent: 0,
    },
    responseTime: { responses: 0, medianMs: null, p95Ms: null },
    qna: { questions: 0, answered: 0, unresolved: 0 },
    participantFeedback: [],
    evidenceNote,
    experience: {
      category: state.experienceTheme.category,
      preset: state.experienceTheme.preset,
    },
    audiencePulse: {
      uniqueParticipants: 0,
      events: 0,
      bySignal: { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 },
      contexts: [],
    },
    conversation: {
      messages: 0,
      uniqueContributors: 0,
      reactions: 0,
      reports: 0,
      removed: 0,
      moderationActions: 0,
      peakMessagesPerMinute: 0,
      transcriptAvailable: false,
    },
  } satisfies Omit<
    ReportV3,
    "id" | "sessionId" | "schemaVersion" | "status" | "generatedAt" | "expiresAt"
  >;
}

export function createPendingReport(state: GameState, expiresAt: Date): ReportV3 {
  return {
    id: randomUUID(),
    sessionId: state.sessionId,
    schemaVersion: 3,
    status: "pending",
    generatedAt: null,
    expiresAt: expiresAt.toISOString(),
    ...emptyReportFields(state),
  };
}

export function generateReport(
  state: GameState,
  expiresAt: Date,
  options: { id?: string; evidence?: SessionEvidence; generatedAt?: Date } = {},
): ReportV3 {
  const evidence = options.evidence ?? stateEvidence(state);
  const interactions = evidence.interactions ?? {
    signalEvents: [],
    chatMessages: [],
    reactions: [],
    reports: 0,
    moderationActions: 0,
  };
  const participants = Object.values(state.participants).filter(
    (participant) => !participant.kicked,
  );
  const activeParticipantIds = new Set(participants.map((participant) => participant.id));
  const answers = evidence.answers.filter((answer) =>
    activeParticipantIds.has(answer.participantId),
  );
  const questionById = new Map(state.quiz.questions.map((question) => [question.id, question]));
  const roundById = new Map(evidence.rounds.map((round) => [round.id, round]));
  const mainRounds = evidence.rounds.filter((round) => round.kind === "main");
  const scorableMainRoundIds = new Set(
    mainRounds
      .filter((round) => {
        const question = questionById.get(round.questionId);
        return (
          question &&
          question.type !== "poll" &&
          question.type !== "rating" &&
          questionPurpose(question) !== "opinion"
        );
      })
      .map((round) => round.id),
  );
  const initialAnswers = answers.filter((answer) => scorableMainRoundIds.has(answer.roundId));
  const correctAnswers = initialAnswers.filter((answer) => answer.correct).length;
  const questions = state.quiz.questions
    .filter((question) => questionDelivery(question) === "main")
    .map((question) => {
      const roundIds = mainRounds
        .filter((round) => round.questionId === question.id)
        .map((round) => round.id);
      const roundAnswers = answers.filter((answer) => roundIds.includes(answer.roundId));
      const correct = roundAnswers.filter((answer) => answer.correct).length;
      const accuracyPercent = percent(correct, roundAnswers.length);
      const scorable =
        question.type !== "poll" &&
        question.type !== "rating" &&
        questionPurpose(question) !== "opinion";
      const responseDistribution = responseDistributionFor(question, roundAnswers);
      return {
        questionId: question.id,
        prompt: question.prompt,
        responses: roundAnswers.length,
        correct,
        accuracyPercent,
        difficult: scorable && roundAnswers.length > 0 && accuracyPercent < 60,
        ...(responseDistribution ? { responseDistribution } : {}),
      };
    });

  const confidenceMatrix = ([1, 2, 3] as const).map((confidence) => {
    const selected = initialAnswers.filter((answer) => answer.confidence === confidence);
    const correct = selected.filter((answer) => answer.correct).length;
    return {
      confidence,
      correct,
      incorrect: selected.length - correct,
      total: selected.length,
    };
  });

  const misconceptions = mainRounds.flatMap((round) => {
    const question = questionById.get(round.questionId);
    if (!question || !("choices" in question)) return [];
    const roundAnswers = answers.filter((answer) => answer.roundId === round.id);
    const wrongAnswers = roundAnswers.filter((answer) => !answer.correct);
    const counts = new Map<string, number>();
    for (const answer of wrongAnswers) {
      if (answer.response.kind !== "choice" && answer.response.kind !== "poll") continue;
      for (const choiceId of answer.response.choiceIds) {
        const key = question.choices.find((choice) => choice.id === choiceId)?.misconceptionKey;
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()].map(([key, responses]) => ({
      questionId: question.id,
      key,
      responses,
      allResponsePercent: percent(responses, roundAnswers.length),
      wrongResponsePercent: percent(responses, wrongAnswers.length),
    }));
  });

  const recoveredParticipantKeys = new Set<string>();
  const recovery = evidence.rounds
    .filter((round) => round.kind !== "main" && round.sourceRoundId)
    .map((round) => {
      const sourceRoundId = round.sourceRoundId!;
      const sourceRound = roundById.get(sourceRoundId)!;
      const initialByParticipant = new Map(
        answers
          .filter((answer) => answer.roundId === sourceRoundId)
          .map((answer) => [answer.participantId, answer]),
      );
      const recheckByParticipant = new Map(
        answers
          .filter((answer) => answer.roundId === round.id)
          .map((answer) => [answer.participantId, answer]),
      );
      let denominator = 0;
      let recovered = 0;
      for (const [participantId, initial] of initialByParticipant) {
        const recheck = recheckByParticipant.get(participantId);
        if (initial.correct || !recheck) continue;
        denominator += 1;
        if (recheck.correct) {
          recovered += 1;
          recoveredParticipantKeys.add(`${sourceRoundId}:${participantId}`);
        }
      }
      const evidenceType: "linked_recheck" | "revote" =
        round.kind === "linked_recheck" ? "linked_recheck" : "revote";
      return {
        sourceQuestionId: sourceRound.questionId,
        recheckQuestionId: round.questionId,
        sourceRoundId,
        recheckRoundId: round.id,
        evidenceType,
        recovered,
        initiallyIncorrectWithBoth: denominator,
        recoveryPercent: denominator ? percent(recovered, denominator) : null,
        smallSample: denominator < 5,
      };
    });

  const conceptTotals = new Map<
    string,
    { initiallyIncorrect: Set<string>; recovered: Set<string> }
  >();
  for (const answer of initialAnswers.filter((candidate) => !candidate.correct)) {
    const round = roundById.get(answer.roundId);
    const question = round ? questionById.get(round.questionId) : undefined;
    for (const conceptKey of question?.conceptKeys ?? []) {
      const aggregate = conceptTotals.get(conceptKey) ?? {
        initiallyIncorrect: new Set<string>(),
        recovered: new Set<string>(),
      };
      aggregate.initiallyIncorrect.add(answer.participantId);
      if (recoveredParticipantKeys.has(`${answer.roundId}:${answer.participantId}`)) {
        aggregate.recovered.add(answer.participantId);
      }
      conceptTotals.set(conceptKey, aggregate);
    }
  }
  const unresolvedConcepts = [...conceptTotals.entries()].map(([conceptKey, aggregate]) => ({
    conceptKey,
    initiallyIncorrect: aggregate.initiallyIncorrect.size,
    recovered: aggregate.recovered.size,
    unresolved: aggregate.initiallyIncorrect.size - aggregate.recovered.size,
  }));

  const respondentIds = new Set(answers.map((answer) => answer.participantId));
  const participantFeedback = participants.map((participant) => {
    const participantInitial = initialAnswers.filter(
      (answer) => answer.participantId === participant.id,
    );
    const unresolved = new Set<string>();
    for (const answer of participantInitial.filter((candidate) => !candidate.correct)) {
      const round = roundById.get(answer.roundId);
      const question = round ? questionById.get(round.questionId) : undefined;
      if (!recoveredParticipantKeys.has(`${answer.roundId}:${participant.id}`)) {
        for (const conceptKey of question?.conceptKeys ?? []) unresolved.add(conceptKey);
      }
    }
    return {
      participantId: participant.id,
      correct: participantInitial.filter((answer) => answer.correct).length,
      responses: participantInitial.length,
      unresolvedConcepts: [...unresolved].sort(),
    };
  });

  const linkedRecheckByIntervention = new Map(
    evidence.rounds
      .filter((round) => round.interventionId && round.kind !== "main")
      .map((round) => [round.interventionId!, round.id]),
  );
  const signalCounts = { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 };
  const signalParticipants = new Set(interactions.signalEvents.map((event) => event.participantId));
  const signalContexts = new Map<
    string,
    {
      participants: Set<string>;
      counts: typeof signalCounts;
    }
  >();
  const latestSignalByContextParticipant = new Map<
    string,
    (typeof interactions.signalEvents)[number]
  >();
  for (const signalEvent of interactions.signalEvents) {
    latestSignalByContextParticipant.set(
      `${signalEvent.contextKey}:${signalEvent.participantId}`,
      signalEvent,
    );
  }
  for (const signalEvent of latestSignalByContextParticipant.values()) {
    const context = signalContexts.get(signalEvent.contextKey) ?? {
      participants: new Set<string>(),
      counts: { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 },
    };
    context.participants.add(signalEvent.participantId);
    signalContexts.set(signalEvent.contextKey, context);
    if (!signalEvent.signal) continue;
    signalCounts[signalEvent.signal] += 1;
    context.counts[signalEvent.signal] += 1;
  }
  const contributorIds = new Set(
    interactions.chatMessages.map(
      (message) => message.participantId ?? message.actorId ?? message.staffCredentialId!,
    ),
  );
  const messagesPerMinute = new Map<string, number>();
  for (const message of interactions.chatMessages) {
    const minute = message.createdAt.toISOString().slice(0, 16);
    messagesPerMinute.set(minute, (messagesPerMinute.get(minute) ?? 0) + 1);
  }
  return {
    id: options.id ?? randomUUID(),
    sessionId: state.sessionId,
    schemaVersion: 3,
    status: "ready",
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    expiresAt: expiresAt.toISOString(),
    metrics: {
      participantCount: participants.length,
      completedCount: respondentIds.size,
      answerCount: answers.length,
      accuracyPercent: percent(correctAnswers, initialAnswers.length),
    },
    questions,
    participants: participants.map((participant) => ({
      participantId: participant.id,
      nickname: participant.nickname,
      avatarId: participant.avatarId ?? avatarIdForSeed(participant.id),
      score: participant.score,
      correctCount: participant.correctCount,
      answerCount: answers.filter((answer) => answer.participantId === participant.id).length,
    })),
    initialAccuracy: {
      correct: correctAnswers,
      responses: initialAnswers.length,
      percent: percent(correctAnswers, initialAnswers.length),
    },
    confidenceMatrix,
    misconceptions,
    interventions: evidence.interventions.map((intervention) => ({
      id: intervention.id,
      type: intervention.type,
      sourceRoundId: intervention.sourceRoundId,
      linkedRecheckRoundId: linkedRecheckByIntervention.get(intervention.id) ?? null,
      startedAt: new Date(intervention.startedAtMs).toISOString(),
      finishedAt:
        intervention.finishedAtMs === null
          ? null
          : new Date(intervention.finishedAtMs).toISOString(),
    })),
    recovery,
    unresolvedConcepts,
    participation: {
      participants: participants.length,
      respondents: respondentIds.size,
      percent: percent(respondentIds.size, participants.length),
    },
    responseTime: {
      responses: answers.length,
      medianMs: percentile(
        answers.map((answer) => answer.responseMs),
        0.5,
      ),
      p95Ms: percentile(
        answers.map((answer) => answer.responseMs),
        0.95,
      ),
    },
    qna: evidence.qna,
    participantFeedback,
    evidenceNote,
    experience: {
      category: state.experienceTheme.category,
      preset: state.experienceTheme.preset,
    },
    audiencePulse: {
      uniqueParticipants: signalParticipants.size,
      events: interactions.signalEvents.length,
      bySignal: signalCounts,
      contexts: [...signalContexts.entries()].map(([contextKey, context]) => ({
        contextKey,
        uniqueParticipants: context.participants.size,
        bySignal: context.counts,
      })),
    },
    conversation: {
      messages: interactions.chatMessages.length,
      uniqueContributors: contributorIds.size,
      reactions: interactions.reactions.length,
      reports: interactions.reports,
      removed: interactions.chatMessages.filter((message) => message.status === "removed").length,
      moderationActions: interactions.moderationActions,
      peakMessagesPerMinute: Math.max(0, ...messagesPerMinute.values()),
      transcriptAvailable: interactions.chatMessages.length > 0,
    },
  };
}

function csvCell(value: string | number): string {
  const raw = String(value);
  const text = /^(?:\s*[=+@-]|[\t\r\n])/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function reportCsv(report: Report): string {
  const rows: Array<Array<string | number>> = [
    ["participant_id", "nickname", "score", "correct_count", "answer_count"],
    ...report.participants.map((participant) => [
      participant.participantId,
      participant.nickname,
      participant.score,
      participant.correctCount,
      participant.answerCount,
    ]),
  ];
  if (report.schemaVersion === 2 || report.schemaVersion === 3) {
    rows.push(
      [],
      ["report_schema_version", report.schemaVersion],
      ["initial_correct", report.initialAccuracy.correct],
      ["initial_responses", report.initialAccuracy.responses],
      ["initial_accuracy_percent", report.initialAccuracy.percent],
      [],
      [
        "evidence_type",
        "source_question_id",
        "recheck_question_id",
        "recovered_numerator",
        "initially_incorrect_denominator",
        "recovery_percent",
        "small_sample",
      ],
      ...report.recovery.map((recovery) => [
        recovery.evidenceType,
        recovery.sourceQuestionId,
        recovery.recheckQuestionId,
        recovery.recovered,
        recovery.initiallyIncorrectWithBoth,
        recovery.recoveryPercent ?? "",
        String(recovery.smallSample),
      ]),
      [],
      ["concept_key", "initially_incorrect", "recovered", "unresolved"],
      ...report.unresolvedConcepts.map((concept) => [
        concept.conceptKey,
        concept.initiallyIncorrect,
        concept.recovered,
        concept.unresolved,
      ]),
      [],
      ["evidence_note", report.evidenceNote],
    );
  }
  if (report.schemaVersion === 3) {
    rows.push(
      [],
      ["experience_category", report.experience.category],
      ["experience_preset", report.experience.preset.id],
      ["signal_events", report.audiencePulse.events],
      ["unique_signal_participants", report.audiencePulse.uniqueParticipants],
      ["signal_got_it", report.audiencePulse.bySignal.got_it],
      ["signal_unsure", report.audiencePulse.bySignal.unsure],
      ["signal_need_example", report.audiencePulse.bySignal.need_example],
      ["signal_too_fast", report.audiencePulse.bySignal.too_fast],
      ["chat_messages", report.conversation.messages],
      ["chat_contributors", report.conversation.uniqueContributors],
      ["chat_reactions", report.conversation.reactions],
      ["chat_reports", report.conversation.reports],
      ["chat_removals", report.conversation.removed],
      ["chat_moderation_actions", report.conversation.moderationActions],
      ["chat_peak_messages_per_minute", report.conversation.peakMessagesPerMinute],
      [],
      ["pulse_context", "unique_participants", "got_it", "unsure", "need_example", "too_fast"],
      ...report.audiencePulse.contexts.map((context) => [
        context.contextKey,
        context.uniqueParticipants,
        context.bySignal.got_it,
        context.bySignal.unsure,
        context.bySignal.need_example,
        context.bySignal.too_fast,
      ]),
    );
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
