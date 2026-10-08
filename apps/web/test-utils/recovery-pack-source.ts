import {
  AuthoringJobSchema,
  RecoveryPackContentSchema,
  authoringDraftContentHash,
  recoveryPackContentHash,
} from "@openround/contracts";
import type { RecoveryPackRecord } from "../lib/recovery-pack-source";
import { publishedPracticePack, packPracticeIds } from "./recovery-pack-practice";

export function sourcePackFixtures() {
  const citation = {
    sourceName: "Halves < reference",
    sourceDigest: "a".repeat(64),
    locator: "paragraph 1",
    excerpt: "Divide a whole into two equal groups. <script>plain text</script>",
  };
  const native = publishedPracticePack(false).content;
  const draft = RecoveryPackContentSchema.parse({
    ...native,
    citations: [citation],
    diagnostic: { ...native.diagnostic, sourceCitations: [citation] },
    recheck: { ...native.recheck, sourceCitations: [citation] },
    interventions: [{ ...native.interventions[0], citations: [citation] }],
  });
  const job = AuthoringJobSchema.parse({
    id: "10000000-0000-4000-8000-000000000009",
    sourceType: "pasted_text",
    sourceName: citation.sourceName,
    status: "ready",
    attempts: 1,
    appliedQuizId: null,
    error: null,
    createdAt: "2026-10-07T12:00:00.000Z",
    updatedAt: "2026-10-07T12:00:00.000Z",
    output: {
      schemaVersion: 1,
      sourceName: citation.sourceName,
      sourceDigest: citation.sourceDigest,
      checkpointSet: {
        title: draft.title,
        description: draft.description,
        questions: [draft.diagnostic, draft.recheck],
      },
      citations: [draft.diagnostic, draft.recheck].map((question) => ({
        checkpointId: question.id,
        locator: citation.locator,
        excerpt: citation.excerpt,
      })),
      provider: "Test fixture",
      model: "deterministic",
      generatedAt: "2026-10-07T12:00:00.000Z",
    },
  });
  const proposal = {
    schemaVersion: 1 as const,
    authoringJobId: job.id,
    sourceName: job.sourceName,
    sourceDigest: citation.sourceDigest,
    sourceOutputHash: authoringDraftContentHash(job.output),
    contentHash: recoveryPackContentHash(draft),
    draft,
    conversionNotes: ["Review exact citations before publishing."],
  };
  const pack: RecoveryPackRecord = {
    id: packPracticeIds.pack,
    title: draft.title,
    draft,
    draftRevision: 1,
    currentVersionId: null,
    publishedDraftRevision: null,
    sourceReview: {
      schemaVersion: 1,
      authoringJobId: job.id,
      sourceName: job.sourceName,
      sourceDigest: proposal.sourceDigest,
      sourceOutputHash: proposal.sourceOutputHash,
      contentHash: proposal.contentHash,
      approvedContentHash: null,
      approvedDraftRevision: null,
      approvedAt: null,
      approved: false,
    },
  };
  const approvedPack: RecoveryPackRecord = {
    ...pack,
    sourceReview: {
      ...pack.sourceReview!,
      approvedContentHash: proposal.contentHash,
      approvedDraftRevision: pack.draftRevision,
      approvedAt: "2026-10-07T12:10:00.000Z",
      approved: true,
    },
  };
  return { citation, job, draft, proposal, pack, approvedPack };
}
