import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AuthoringJob } from "@openround/contracts";
import {
  authoringProposalSelectionCount,
  defaultAuthoringProposalSelection,
  toggleContentSlideProposal,
  toggleQuestionProposal,
} from "./authoring-proposals";

function job(): AuthoringJob {
  const mainId = randomUUID();
  const recheckId = randomUUID();
  return {
    id: randomUUID(),
    sourceType: "pasted_text",
    sourceName: "Guide",
    status: "ready",
    attempts: 1,
    appliedQuizId: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    output: {
      schemaVersion: 1,
      sourceName: "Guide",
      sourceDigest: "a".repeat(64),
      checkpointSet: {
        title: "Guide review",
        description: "",
        category: "general",
        experiencePreset: { id: "focus", version: 1 },
        questions: [
          {
            id: mainId,
            type: "single_select",
            prompt: "Main",
            choices: [
              { id: randomUUID(), label: "Yes", isCorrect: true },
              { id: randomUUID(), label: "No", isCorrect: false },
            ],
            purpose: "diagnostic",
            confidence: "optional",
            delivery: "main",
            conceptKeys: ["guide"],
            linkedRecheckQuestionId: recheckId,
            timeLimitSeconds: 30,
            basePoints: 1_000,
            explanation: "Review.",
            mediaId: null,
            mediaAlt: null,
          },
          {
            id: recheckId,
            type: "true_false",
            prompt: "Recheck",
            choices: [
              { id: randomUUID(), label: "True", isCorrect: true },
              { id: randomUUID(), label: "False", isCorrect: false },
            ],
            purpose: "practice",
            confidence: "optional",
            delivery: "recheck",
            conceptKeys: ["guide"],
            linkedRecheckQuestionId: null,
            timeLimitSeconds: 30,
            basePoints: 0,
            explanation: "Review.",
            mediaId: null,
            mediaAlt: null,
          },
        ],
      },
      citations: [
        { checkpointId: mainId, locator: "paragraph 1", excerpt: "Grounded evidence" },
        { checkpointId: recheckId, locator: "paragraph 1", excerpt: "Grounded evidence" },
      ],
      contentSlideProposals: [
        {
          id: randomUUID(),
          kind: "content",
          layout: "section",
          title: "Grounded evidence",
          body: "",
          citations: [{ locator: "paragraph 1", excerpt: "Grounded evidence" }],
        },
      ],
      generatedAt: new Date().toISOString(),
      provider: "approved",
      model: "grounded",
    },
  };
}

describe("authoring proposal selection", () => {
  it("selects all reviewable slides and questions by default", () => {
    const proposal = job();
    const selection = defaultAuthoringProposalSelection(proposal);
    expect(selection.selectedContentSlideIds).toHaveLength(1);
    expect(selection.selectedQuestionIds).toHaveLength(2);
    expect(authoringProposalSelectionCount(selection)).toBe(3);
  });

  it("toggles Recovery questions as a complete pair and slides independently", () => {
    const proposal = job();
    const defaults = defaultAuthoringProposalSelection(proposal);
    const mainId = proposal.output!.checkpointSet.questions[0]!.id;
    const withoutPair = toggleQuestionProposal(proposal, defaults, mainId);
    expect(withoutPair.selectedQuestionIds).toEqual([]);
    const restoredPair = toggleQuestionProposal(proposal, withoutPair, mainId);
    expect(restoredPair.selectedQuestionIds).toHaveLength(2);
    const withoutSlide = toggleContentSlideProposal(
      proposal,
      restoredPair,
      proposal.output!.contentSlideProposals![0]!.id,
    );
    expect(withoutSlide.selectedContentSlideIds).toEqual([]);
    expect(withoutSlide.selectedQuestionIds).toHaveLength(2);
  });
});
