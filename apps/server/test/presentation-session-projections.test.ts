import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresentationContentSchema } from "@openround/contracts";
import type {
  PresentationParticipantSnapshotProjection,
  PresentationSessionParticipantRecord,
  PresentationSessionRecord,
  PresentationSessionResponseRecord,
} from "@openround/db";
import {
  buildPresentationCompanionSnapshot,
  buildPresentationHostSnapshot,
  buildPresentationParticipantSnapshot,
  buildPresentationProjectionData,
  buildTargetedPresentationParticipantSnapshot,
  presentationAcceptingResponses,
} from "../src/presentation-session-projections.js";

const NOW = new Date("2026-09-24T18:00:30.000Z");

afterEach(() => {
  vi.useRealTimers();
});

function fixture() {
  const workspaceId = randomUUID();
  const sessionId = randomUUID();
  const presentationId = randomUUID();
  const presentationVersionId = randomUUID();
  const blockId = randomUUID();
  const questionId = randomUUID();
  const correctChoiceId = randomUUID();
  const distractorChoiceId = randomUUID();
  const participantId = randomUUID();
  const secondParticipantId = randomUUID();
  const thirdParticipantId = randomUUID();
  const content = PresentationContentSchema.parse({
    title: "Projection boundaries",
    description: "Role-safe Presentation snapshots",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 1,
    sourceDisclosure: {
      sourceName: "private source disclosure",
      sourceDigest: "a".repeat(64),
      provider: "private provider",
      model: "private model",
    },
    blocks: [
      {
        id: blockId,
        kind: "question",
        citations: [{ locator: "private locator", excerpt: "private block citation" }],
        question: {
          id: questionId,
          type: "single_select",
          prompt: "Which projection is safe?",
          purpose: "diagnostic",
          confidence: "optional",
          delivery: "main",
          conceptKeys: ["projection-safety"],
          linkedRecheckQuestionId: null,
          choices: [
            {
              id: correctChoiceId,
              label: "The allowlisted projection",
              isCorrect: true,
              feedback: "private correct feedback",
            },
            {
              id: distractorChoiceId,
              label: "The authoring record",
              isCorrect: false,
              misconceptionKey: "private-misconception",
            },
          ],
          timeLimitSeconds: 60,
          basePoints: 1_000,
          explanation: "private answer explanation",
          mediaId: null,
          mediaAlt: null,
          sourceCitations: [
            {
              sourceName: "private question source",
              sourceDigest: "b".repeat(64),
              locator: "private question locator",
              excerpt: "private question citation",
            },
          ],
        },
      },
    ],
  });
  const session: PresentationSessionRecord = {
    id: sessionId,
    workspaceId,
    presentationId,
    presentationVersionId,
    title: content.title,
    content,
    code: "1234567",
    status: "active",
    phase: "question_open",
    currentBlockIndex: 0,
    revision: 2,
    settings: { timeMode: "timed" },
    trustMode: "learning",
    eventSeq: 3,
    questionOpenedAt: new Date("2026-09-24T18:00:00.000Z"),
    questionClosesAt: new Date("2026-09-24T18:01:00.000Z"),
    createdBy: randomUUID(),
    createdAt: new Date("2026-09-24T17:59:00.000Z"),
    updatedAt: new Date("2026-09-24T18:00:00.000Z"),
    finishedAt: null,
    liveExpiresAt: new Date("2026-09-25T18:00:00.000Z"),
    retentionExpiresAt: new Date("2026-10-24T18:00:00.000Z"),
  };
  const participants: PresentationSessionParticipantRecord[] = [
    {
      id: participantId,
      workspaceId,
      sessionId,
      nickname: "River",
      tokenHash: "river-token-hash",
      joinedAt: new Date("2026-09-24T17:59:10.000Z"),
      lastSeenAt: new Date(NOW.getTime() - 15_000),
    },
    {
      id: secondParticipantId,
      workspaceId,
      sessionId,
      nickname: "Sky",
      tokenHash: "sky-token-hash",
      joinedAt: new Date("2026-09-24T17:59:20.000Z"),
      lastSeenAt: new Date(NOW.getTime() - 15_001),
    },
    {
      id: thirdParticipantId,
      workspaceId,
      sessionId,
      nickname: "Oak",
      tokenHash: "oak-token-hash",
      joinedAt: new Date("2026-09-24T17:59:30.000Z"),
      lastSeenAt: new Date(NOW.getTime() - 60_000),
    },
  ];
  const previousResponse: PresentationSessionResponseRecord = {
    id: randomUUID(),
    workspaceId,
    sessionId,
    participantId,
    blockId: randomUUID(),
    questionId: randomUUID(),
    response: { choiceIds: [correctChoiceId], confidence: 2 },
    correct: true,
    score: 200,
    responseMs: 10_000,
    submittedAt: new Date("2026-09-24T17:59:50.000Z"),
    idempotencyKey: "previous-response",
    requestHash: "previous-request",
  };
  const currentResponse: PresentationSessionResponseRecord = {
    id: randomUUID(),
    workspaceId,
    sessionId,
    participantId,
    blockId,
    questionId,
    response: { choiceIds: [correctChoiceId], confidence: 3 },
    correct: true,
    score: 1_000,
    responseMs: 30_000,
    submittedAt: new Date("2026-09-24T18:00:20.000Z"),
    idempotencyKey: "current-response",
    requestHash: "current-request",
  };
  return {
    session,
    participants,
    previousResponse,
    currentResponse,
    ids: { participantId, thirdParticipantId, correctChoiceId },
  };
}

describe("Presentation session projections", () => {
  it("keeps participant and companion blocks on explicit allowlists before and after reveal", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { session, participants, ids } = fixture();
    const data = buildPresentationProjectionData(session, participants, []);

    const openHost = buildPresentationHostSnapshot(session, data);
    const participant = buildPresentationParticipantSnapshot(session, ids.participantId, data);
    const companion = buildPresentationCompanionSnapshot(session, data);
    expect(openHost).toMatchObject({
      currentBlock: {
        kind: "question",
        question: { purpose: "diagnostic" },
        revealedAnswer: null,
      },
    });
    expect(participant.currentBlock).toMatchObject({ kind: "question" });
    expect(
      participant.currentBlock?.kind === "question"
        ? participant.currentBlock.question.choices
        : [],
    ).toEqual([
      { id: ids.correctChoiceId, label: "The allowlisted projection" },
      expect.objectContaining({ label: "The authoring record" }),
    ]);

    for (const snapshot of [participant, companion]) {
      const serialized = JSON.stringify(snapshot);
      for (const privateValue of [
        "private source disclosure",
        "private block citation",
        "private correct feedback",
        "private-misconception",
        "private answer explanation",
        "private question citation",
      ]) {
        expect(serialized).not.toContain(privateValue);
      }
      for (const privateField of [
        "purpose",
        "isCorrect",
        "feedback",
        "misconceptionKey",
        "conceptKeys",
        "explanation",
        "sourceCitations",
        "citations",
        "sourceDisclosure",
        "revealedAnswer",
      ]) {
        expect(serialized).not.toContain(`"${privateField}"`);
      }
    }

    const revealedSession: PresentationSessionRecord = {
      ...session,
      phase: "question_reveal",
      questionClosesAt: null,
    };
    const revealedData = buildPresentationProjectionData(revealedSession, participants, []);
    const revealedHost = buildPresentationHostSnapshot(revealedSession, revealedData);
    const revealedParticipant = buildPresentationParticipantSnapshot(
      revealedSession,
      ids.participantId,
      revealedData,
    );
    expect(revealedHost).toMatchObject({
      currentBlock: {
        kind: "question",
        revealedAnswer: {
          kind: "choice",
          correctChoiceIds: [ids.correctChoiceId],
          explanation: "private answer explanation",
        },
      },
    });
    expect(JSON.stringify(revealedParticipant)).not.toContain("private answer explanation");
  });

  it("hides current-question score and result until reveal while retaining the latest receipt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { session, participants, previousResponse, currentResponse, ids } = fixture();
    const openData = buildPresentationProjectionData(session, participants, [
      previousResponse,
      currentResponse,
    ]);
    const openHost = buildPresentationHostSnapshot(session, openData);
    const openParticipant = buildPresentationParticipantSnapshot(
      session,
      ids.participantId,
      openData,
    );

    expect(openHost.participants[0]).toMatchObject({ nickname: "River", score: 200, rank: 1 });
    expect(openParticipant).toMatchObject({
      responseSubmitted: true,
      responseReceipt: {
        responseId: currentResponse.id,
        idempotencyKey: "current-response",
      },
      standing: null,
      responseResult: null,
    });

    const revealedSession: PresentationSessionRecord = {
      ...session,
      phase: "question_reveal",
      questionClosesAt: null,
    };
    const revealedData = buildPresentationProjectionData(revealedSession, participants, [
      previousResponse,
      currentResponse,
    ]);
    const revealedHost = buildPresentationHostSnapshot(revealedSession, revealedData);
    const revealedParticipant = buildPresentationParticipantSnapshot(
      revealedSession,
      ids.participantId,
      revealedData,
    );
    expect(revealedHost.participants[0]).toMatchObject({ score: 1_200, rank: 1 });
    expect(revealedParticipant).toMatchObject({
      standing: { score: 1_200, rank: 1 },
      responseResult: { correct: true, score: 1_000 },
    });
  });

  it("uses participant ID as the final deterministic leaderboard tie-breaker", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { session, participants } = fixture();
    const firstId = "00000000-0000-4000-8000-000000000001";
    const secondId = "00000000-0000-4000-8000-000000000002";
    const tiedParticipants = participants.slice(0, 2).map((participant, index) => ({
      ...participant,
      id: index === 0 ? secondId : firstId,
      nickname: "Same nickname",
      joinedAt: new Date("2026-09-24T17:59:10.000Z"),
    }));
    const revealedSession: PresentationSessionRecord = {
      ...session,
      phase: "question_reveal",
      questionClosesAt: null,
    };
    const data = buildPresentationProjectionData(revealedSession, tiedParticipants, []);

    expect(
      buildPresentationHostSnapshot(revealedSession, data).participants.map(({ id, rank }) => ({
        id,
        rank,
      })),
    ).toEqual([
      { id: firstId, rank: 1 },
      { id: secondId, rank: 2 },
    ]);
    expect(buildPresentationParticipantSnapshot(revealedSession, secondId, data)).toMatchObject({
      standing: { rank: 2, score: 0 },
    });
  });

  it("uses nickname before participant ID when scores and join timestamps tie", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { session, participants } = fixture();
    const idThatSortsFirst = "00000000-0000-4000-8000-000000000001";
    const idThatSortsLast = "00000000-0000-4000-8000-000000000002";
    const tiedParticipants = participants.slice(0, 2).map((participant, index) => ({
      ...participant,
      id: index === 0 ? idThatSortsFirst : idThatSortsLast,
      nickname: index === 0 ? "Zulu" : "Alpha",
      joinedAt: new Date("2026-09-24T17:59:10.000Z"),
    }));
    const revealedSession: PresentationSessionRecord = {
      ...session,
      phase: "question_reveal",
      questionClosesAt: null,
    };
    const data = buildPresentationProjectionData(revealedSession, tiedParticipants, []);

    expect(
      buildPresentationHostSnapshot(revealedSession, data).participants.map(
        ({ id, nickname, rank }) => ({ id, nickname, rank }),
      ),
    ).toEqual([
      { id: idThatSortsLast, nickname: "Alpha", rank: 1 },
      { id: idThatSortsFirst, nickname: "Zulu", rank: 2 },
    ]);
  });

  it("uses the inclusive heartbeat window plus socket presence only in staff room status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { session, participants, ids } = fixture();
    const data = buildPresentationProjectionData(session, participants, []);
    const host = buildPresentationHostSnapshot(session, data, new Set([ids.thirdParticipantId]));
    const participant = buildPresentationParticipantSnapshot(session, ids.participantId, data);

    expect(host.roomStatus).toMatchObject({
      joinedCount: 3,
      connectedCount: 2,
      notCurrentlyConnectedCount: 1,
    });
    expect(participant).not.toHaveProperty("roomStatus");
  });

  it("preserves deadline boundaries and the targeted lost-ack response override", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { session, currentResponse, ids } = fixture();
    const closesAt = session.questionClosesAt!;
    expect(presentationAcceptingResponses(session, closesAt)).toBe(true);
    expect(presentationAcceptingResponses(session, new Date(closesAt.getTime() + 1))).toBe(false);
    expect(
      presentationAcceptingResponses({
        ...session,
        settings: { timeMode: "flex" },
        questionClosesAt: null,
      }),
    ).toBe(true);
    expect(presentationAcceptingResponses({ ...session, phase: "question_reveal" })).toBe(false);

    const projection: PresentationParticipantSnapshotProjection = {
      participantCount: 1,
      standing: { rank: 1, score: 1_000 },
      currentResponse: null,
    };
    const open = buildTargetedPresentationParticipantSnapshot(
      session,
      ids.participantId,
      projection,
      currentResponse,
    );
    expect(open).toMatchObject({
      responseSubmitted: true,
      standing: null,
      responseResult: null,
    });

    const revealed = buildTargetedPresentationParticipantSnapshot(
      { ...session, phase: "question_reveal", questionClosesAt: null },
      ids.participantId,
      projection,
      currentResponse,
    );
    expect(revealed).toMatchObject({
      responseSubmitted: true,
      standing: { rank: 1, score: 1_000 },
      responseResult: { correct: true, score: 1_000 },
    });
  });
});
