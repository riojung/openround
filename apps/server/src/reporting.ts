import { randomUUID } from "node:crypto";
import type { Report } from "@openround/contracts";
import type { GameState } from "@openround/game-engine";

export function generateReport(state: GameState, expiresAt: Date): Report {
  const answers = Object.values(state.answers);
  const participants = Object.values(state.participants).filter(
    (participant) => !participant.kicked,
  );
  const correctAnswers = answers.filter((answer) => answer.correct).length;
  const questions = state.quiz.questions.map((question) => {
    const roundIds = Object.entries(state.rounds)
      .filter(([, round]) => round.questionId === question.id)
      .map(([roundId]) => roundId);
    const roundAnswers = answers.filter((answer) => roundIds.includes(answer.roundId));
    const correct = roundAnswers.filter((answer) => answer.correct).length;
    const accuracyPercent = roundAnswers.length ? (correct / roundAnswers.length) * 100 : 0;
    return {
      questionId: question.id,
      prompt: question.prompt,
      responses: roundAnswers.length,
      correct,
      accuracyPercent: Math.round(accuracyPercent * 10) / 10,
      difficult: roundAnswers.length > 0 && accuracyPercent < 60,
    };
  });
  return {
    id: randomUUID(),
    sessionId: state.sessionId,
    status: "ready",
    generatedAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    metrics: {
      participantCount: participants.length,
      completedCount: participants.filter((participant) =>
        answers.some((answer) => answer.participantId === participant.id),
      ).length,
      answerCount: answers.length,
      accuracyPercent: answers.length
        ? Math.round((correctAnswers / answers.length) * 1_000) / 10
        : 0,
    },
    questions,
    participants: participants.map((participant) => ({
      participantId: participant.id,
      nickname: participant.nickname,
      score: participant.score,
      correctCount: participant.correctCount,
      answerCount: answers.filter((answer) => answer.participantId === participant.id).length,
    })),
  };
}

function csvCell(value: string | number): string {
  const raw = String(value);
  const text = /^(?:\s*[=+@-]|[\t\r\n])/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function reportCsv(report: Report): string {
  const rows = [
    ["participant_id", "nickname", "score", "correct_count", "answer_count"],
    ...report.participants.map((participant) => [
      participant.participantId,
      participant.nickname,
      participant.score,
      participant.correctCount,
      participant.answerCount,
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
