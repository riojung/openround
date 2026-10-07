import { RecoveryPackContentSchema } from "@openround/contracts";
import type { PublishedPracticePack } from "../lib/recovery-pack-practice";
import type { CreatedPractice } from "../lib/practice-assignment";

export const packPracticeIds = {
  pack: "10000000-0000-4000-8000-000000000001",
  version: "10000000-0000-4000-8000-000000000002",
  diagnostic: "10000000-0000-4000-8000-000000000003",
  recheck: "10000000-0000-4000-8000-000000000004",
  probe: "10000000-0000-4000-8000-000000000005",
  card: "10000000-0000-4000-8000-000000000006",
};
const diagnostic = {
  id: packPracticeIds.diagnostic,
  type: "numeric",
  prompt: "Diagnostic only",
  correctValue: "4",
  tolerance: "0",
  unit: null,
  purpose: "diagnostic",
  delivery: "main",
  confidence: "off",
  conceptKeys: ["halves"],
  linkedRecheckQuestionId: packPracticeIds.recheck,
  timeLimitSeconds: 30,
  basePoints: 100,
  explanation: "Divide by two.",
  mediaId: null,
  mediaAlt: null,
};

export function publishedPracticePack(withProbe = true): PublishedPracticePack {
  return {
    id: packPracticeIds.version,
    packId: packPracticeIds.pack,
    version: 2,
    publishedAt: "2026-10-07T12:00:00.000Z",
    content: RecoveryPackContentSchema.parse({
      schemaVersion: 1,
      title: "Halves < whole",
      description: "",
      diagnostic,
      recheck: {
        ...diagnostic,
        id: packPracticeIds.recheck,
        prompt: "Recheck only",
        delivery: "recheck",
        linkedRecheckQuestionId: null,
      },
      delayedProbe: withProbe
        ? {
            ...diagnostic,
            id: packPracticeIds.probe,
            prompt: "Delayed transfer probe",
            linkedRecheckQuestionId: null,
          }
        : null,
      interventions: [
        { id: packPracticeIds.card, title: "Private explanation", body: "Facilitator guidance" },
      ],
      conceptKeys: ["halves"],
    }),
  };
}

export function createdPackPractice(): CreatedPractice {
  const version = publishedPracticePack();
  return {
    followup: {
      id: "10000000-0000-4000-8000-000000000010",
      purpose: "assignment",
      sourceSessionId: null,
      sourceReportId: null,
      sourceQuizVersionId: null,
      recoveryPackSource: {
        artifactType: "recovery_pack",
        packId: version.packId,
        packVersionId: version.id,
        packVersion: version.version,
        contentHash: "a".repeat(64),
        packTitle: version.content.title,
        publishedAt: version.publishedAt,
        sourceItemId: packPracticeIds.probe,
        role: "delayed_probe",
      },
      title: "Delayed probe: Halves",
      conceptKeys: [],
      checkpointCount: 1,
      timeMode: "flex",
      opensAt: "2026-10-07T12:00:00.000Z",
      closesAt: "2026-10-14T12:00:00.000Z",
      expiresAt: "2026-11-07T12:00:00.000Z",
      closedAt: null,
      createdAt: "2026-10-07T12:00:00.000Z",
    },
    genericUrl: "https://example.test/followup/assignment#token=generic-private",
    personalAccess: [
      {
        id: "10000000-0000-4000-8000-000000000011",
        kind: "assignment_personal",
        participantId: null,
        nickname: null,
        label: "Learner A",
        timeMultiplier: 1,
        expiresAt: "2026-10-14T12:00:00.000Z",
        revokedAt: null,
        url: "https://example.test/followup/assignment#token=personal-private",
      },
    ],
  };
}
