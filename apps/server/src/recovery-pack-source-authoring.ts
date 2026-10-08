import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  AuthoringDraftSchema,
  RecoveryPackContentSchema,
  RecoveryPackSourceProposalSchema,
  SourceCitationSchema,
  authoringDraftContentHash,
  recoveryPackContentHash,
  type RecoveryPackSourceProposal,
} from "@openround/contracts";
import type { AuthoringJobRecord } from "@openround/db";

export class RecoveryPackSourceProposalError extends Error {}

export function sourceRecoveryPackProposal(job: AuthoringJobRecord): {
  proposal: RecoveryPackSourceProposal;
  citationCatalog: z.infer<typeof SourceCitationSchema>[];
} {
  if (job.status !== "ready" || !job.output)
    throw new RecoveryPackSourceProposalError("The source draft is not ready for Pack review");
  const output = AuthoringDraftSchema.parse(job.output);
  if (output.sourceDigest !== job.sourceDigest || output.sourceName !== job.sourceName)
    throw new RecoveryPackSourceProposalError("The source output does not match its authoring job");

  const diagnostic = output.checkpointSet.questions.find(
    (question) => question.delivery !== "recheck" && question.linkedRecheckQuestionId,
  );
  const recheck = diagnostic
    ? output.checkpointSet.questions.find(
        (question) => question.id === diagnostic.linkedRecheckQuestionId,
      )
    : undefined;
  if (!diagnostic || !recheck || recheck.delivery !== "recheck")
    throw new RecoveryPackSourceProposalError(
      "The source has no compatible diagnostic/recheck pair",
    );

  const cite = (citation: { locator: string; excerpt: string }) =>
    SourceCitationSchema.parse({
      sourceName: job.sourceName,
      sourceDigest: job.sourceDigest,
      locator: citation.locator,
      excerpt: citation.excerpt,
    });
  const catalog = [
    ...output.citations.map(cite),
    ...(output.contentSlideProposals ?? []).flatMap((card) => card.citations.map(cite)),
  ];
  const citationCatalog = catalog.filter(
    (citation, index) =>
      catalog.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(citation)) ===
      index,
  );
  const firstCitation = diagnostic.sourceCitations?.[0];
  const sourceCard = output.contentSlideProposals?.find((card) =>
    card.citations.some((citation) => citation.locator === firstCitation?.locator),
  );
  // Ready output already contains source-grounded proposal text. Do not ask a
  // provider to generate more content here or send any participant data to one.
  const originalCardBody = sourceCard
    ? [sourceCard.title, sourceCard.body].filter(Boolean).join("\n\n")
    : diagnostic.explanation;
  const cardBody = originalCardBody.slice(0, 2_000).trim();
  const conversionNotes = [...(output.conversionNotes ?? [])];
  if (originalCardBody.length > 2_000) {
    // Old validated jobs may contain 4,000-character slide proposals. Make the
    // smaller Pack-card boundary explicit in the review rather than failing or
    // presenting a shortened source as a lossless conversion.
    conversionNotes.splice(9);
    conversionNotes.push(
      "The selected source slide was shortened to the Pack card's 2,000-character limit. Review the intervention against its source before approval.",
    );
  }
  const cardId = sourceCard?.id ?? deterministicCardId(job.id);
  const conceptKeys = [
    ...new Set([...(diagnostic.conceptKeys ?? []), ...(recheck.conceptKeys ?? [])]),
  ].slice(0, 12);
  const misconceptionKeys = [
    ...new Set(
      [diagnostic, recheck].flatMap((question) =>
        "choices" in question
          ? question.choices.flatMap((choice) =>
              choice.misconceptionKey ? [choice.misconceptionKey] : [],
            )
          : [],
      ),
    ),
  ].slice(0, 12);
  const draft = RecoveryPackContentSchema.parse({
    schemaVersion: 1,
    title: output.checkpointSet.title,
    description: output.checkpointSet.description,
    diagnostic: {
      ...structuredClone(diagnostic),
      purpose: "diagnostic",
      delivery: "main",
      linkedRecheckQuestionId: recheck.id,
    },
    interventions: [
      {
        id: cardId,
        title: sourceCard?.title ?? "Source-grounded intervention",
        body: cardBody,
        citations: sourceCard ? sourceCard.citations.map(cite) : (diagnostic.sourceCitations ?? []),
      },
    ],
    recheck: { ...structuredClone(recheck), delivery: "recheck", linkedRecheckQuestionId: null },
    delayedProbe: null,
    conceptKeys,
    misconceptionKeys,
    citations: citationCatalog.slice(0, 20),
  });
  return {
    proposal: RecoveryPackSourceProposalSchema.parse({
      schemaVersion: 1,
      authoringJobId: job.id,
      sourceName: job.sourceName,
      sourceDigest: job.sourceDigest,
      sourceOutputHash: authoringDraftContentHash(output),
      contentHash: recoveryPackContentHash(draft),
      draft,
      conversionNotes,
    }),
    citationCatalog,
  };
}

function deterministicCardId(jobId: string) {
  const bytes = createHash("sha256").update(`source-recovery-card:${jobId}`).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
