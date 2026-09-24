import {
  PresentationReportV1Schema,
  questionTypeDefinition,
  type PresentationReportV1,
} from "@openround/contracts";
import {
  comparePresentationLeaderboardEntries,
  type PresentationSessionParticipantRecord,
  type PresentationSessionRecord,
  type PresentationSessionResponseRecord,
  type PresentationSessionTimelineRecord,
} from "@openround/db";

const PRESENTATION_EVIDENCE_NOTE =
  "Content slides are recorded in the facilitation timeline but are not evidence of learning.";

function reportLeaderboard(
  participants: PresentationSessionParticipantRecord[],
  responses: PresentationSessionResponseRecord[],
) {
  const scores = new Map<string, number>();
  for (const response of responses) {
    scores.set(response.participantId, (scores.get(response.participantId) ?? 0) + response.score);
  }
  return participants
    .map((participant) => ({
      id: participant.id,
      nickname: participant.nickname,
      joinedAt: participant.joinedAt,
      score: scores.get(participant.id) ?? 0,
    }))
    .sort(comparePresentationLeaderboardEntries)
    .map(({ joinedAt: _joinedAt, ...participant }, index) => ({
      ...participant,
      rank: index + 1,
    }));
}

export function generatePresentationReport(input: {
  session: PresentationSessionRecord;
  participants: PresentationSessionParticipantRecord[];
  responses: PresentationSessionResponseRecord[];
  timeline: PresentationSessionTimelineRecord[];
}): PresentationReportV1 {
  const { session, participants, responses, timeline } = input;
  if (session.status !== "finished") {
    throw new Error("A Presentation report can only be generated for a finished session");
  }
  // Pre-foundation and directly imported rows could mark a session finished without populating
  // finished_at. updatedAt was the legacy transition timestamp and is the lossless fallback also
  // used by the report-queue migration.
  const finishedAt = session.finishedAt ?? session.updatedAt;

  const responsesByBlock = new Map<string, PresentationSessionResponseRecord[]>();
  for (const response of responses) {
    const group = responsesByBlock.get(response.blockId) ?? [];
    group.push(response);
    responsesByBlock.set(response.blockId, group);
  }
  const evidence = session.content.blocks.map((block, blockIndex) => {
    if (block.kind === "content") {
      return {
        blockId: block.id,
        blockIndex,
        kind: "content" as const,
        title: block.title,
        assessmentStatus: "not_assessed" as const,
      };
    }
    const blockResponses = responsesByBlock.get(block.id) ?? [];
    const assessed = blockResponses.filter((response) => response.correct !== null);
    const correct = assessed.filter((response) => response.correct).length;
    return {
      blockId: block.id,
      blockIndex,
      kind: "question" as const,
      questionId: block.question.id,
      prompt: block.question.prompt,
      questionType: block.question.type,
      questionTypeLabel: questionTypeDefinition(block.question.type).label,
      delivery: block.question.delivery ?? "main",
      respondents: blockResponses.length,
      correct: assessed.length ? correct : null,
      accuracyPercent: assessed.length ? Math.round((correct / assessed.length) * 100) : null,
      totalScore: blockResponses.reduce((total, response) => total + response.score, 0),
      averageResponseMs: blockResponses.length
        ? Math.round(
            blockResponses.reduce((total, response) => total + response.responseMs, 0) /
              blockResponses.length,
          )
        : null,
    };
  });

  const responseByParticipantQuestion = new Map(
    responses.map((response) => [`${response.participantId}:${response.questionId}`, response]),
  );
  const recovery = session.content.blocks.flatMap((block) => {
    if (block.kind !== "question" || !block.question.linkedRecheckQuestionId) return [];
    let eligible = 0;
    let recovered = 0;
    for (const participant of participants) {
      const initial = responseByParticipantQuestion.get(`${participant.id}:${block.question.id}`);
      const recheck = responseByParticipantQuestion.get(
        `${participant.id}:${block.question.linkedRecheckQuestionId}`,
      );
      if (initial?.correct === false && recheck) {
        eligible += 1;
        if (recheck.correct === true) recovered += 1;
      }
    }
    return [
      {
        sourceQuestionId: block.question.id,
        recheckQuestionId: block.question.linkedRecheckQuestionId,
        eligible,
        recovered,
        recoveryPercent: eligible ? Math.round((recovered / eligible) * 100) : null,
      },
    ];
  });

  return PresentationReportV1Schema.parse({
    schemaVersion: 1,
    sessionId: session.id,
    artifactType: "presentation",
    presentationId: session.presentationId,
    presentationVersionId: session.presentationVersionId,
    title: session.title,
    status: "finished",
    trustMode: session.trustMode,
    participantCount: participants.length,
    responseCount: responses.length,
    leaderboard: reportLeaderboard(participants, responses),
    evidence,
    recovery,
    timeline: timeline.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      blockIndex: event.blockIndex,
      blockId: event.blockId,
      occurredAt: event.occurredAt.toISOString(),
    })),
    evidenceNote: PRESENTATION_EVIDENCE_NOTE,
    createdAt: session.createdAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  });
}
