import { describe, expect, it } from "vitest";
import {
  RecoveryPackContentSchema,
  type ApplyRecoveryPackUpdate,
  type PresentationDraft,
  type PresentationRecoveryPackUpdatePreview,
} from "@openround/contracts";
import {
  presentationPackDraftIsCurrent,
  presentationPackReviewForPanel,
  presentationPackSelectedBlock,
  presentationPackUpdateFromPanel,
} from "./presentation-pack-update-ui";
import {
  recoveryPackDefaultSelections,
  recoveryPackSelectedChoices,
  recoveryPackSelectedLinkIssue,
} from "./recovery-pack-update-ui";

const diagnosticId = "10000000-0000-4000-8000-000000000001";
const recheckId = "10000000-0000-4000-8000-000000000002";
const diagnostic = {
  id: diagnosticId,
  type: "numeric",
  prompt: "First ratio",
  correctValue: "2",
  tolerance: "0",
  unit: null,
  purpose: "diagnostic",
  delivery: "main",
  timeLimitSeconds: 30,
  basePoints: 100,
  explanation: "Compare a part with its reference.",
  mediaId: null,
  mediaAlt: null,
  conceptKeys: ["ratios"],
  linkedRecheckQuestionId: recheckId,
};
const content = RecoveryPackContentSchema.parse({
  schemaVersion: 1,
  title: "Ratios",
  diagnostic,
  recheck: {
    ...diagnostic,
    id: recheckId,
    delivery: "recheck",
    prompt: "Transfer ratio",
    linkedRecheckQuestionId: null,
  },
  interventions: [
    { id: "10000000-0000-4000-8000-000000000003", title: "Compare", body: "Two ratios" },
  ],
  conceptKeys: ["ratios"],
});
const review: PresentationRecoveryPackUpdatePreview = {
  presentationId: diagnosticId,
  insertionId: recheckId,
  draftRevision: 3,
  baselineVersion: 1,
  baselineVersionId: diagnosticId,
  latestVersion: 2,
  latestVersionId: recheckId,
  baselineContent: content,
  latestContent: content,
  contextChanged: true,
  items: [
    {
      role: "diagnostic",
      questionId: diagnosticId,
      baseline: content.diagnostic,
      local: content.diagnostic,
      latest: content.diagnostic,
      status: "source_changed",
    },
    {
      role: "recheck",
      questionId: recheckId,
      baseline: content.recheck,
      local: null,
      latest: content.recheck,
      status: "conflict",
    },
  ],
};

describe("Presentation Pack update adapter", () => {
  it("preserves exact version, context and explicit deleted-copy conflict semantics", () => {
    const normalized = presentationPackReviewForPanel(review);
    expect(normalized.quizId).toBe(review.presentationId);
    expect(normalized).not.toHaveProperty("presentationId");
    expect(normalized.items).toBe(review.items);
    expect(normalized.latestContent).toBe(content);
    expect(normalized.latestVersionId).toBe(review.latestVersionId);
    expect(recoveryPackDefaultSelections(normalized)).toEqual({ diagnostic: "use_latest" });
    expect(recoveryPackSelectedChoices(normalized, { diagnostic: "use_latest" })).toBeNull();
    expect(
      recoveryPackSelectedLinkIssue(normalized, [
        { role: "diagnostic", action: "use_latest" },
        { role: "recheck", action: "use_latest" },
      ]),
    ).toBeNull();
  });

  it("removes only the Round envelope ID and retains lost-acknowledgement intent exactly", () => {
    const intent: ApplyRecoveryPackUpdate = {
      quizId: diagnosticId,
      insertionId: recheckId,
      packVersionId: recheckId,
      expectedRevision: 3,
      mutationId: diagnosticId,
      choices: [
        { role: "diagnostic", action: "use_latest" },
        { role: "recheck", action: "keep_local" },
      ],
    };
    const original = JSON.stringify(intent);
    const first = presentationPackUpdateFromPanel(intent);
    expect(first).not.toHaveProperty("quizId");
    expect(first.mutationId).toBe(intent.mutationId);
    expect(first.choices).toBe(intent.choices);
    expect(JSON.stringify(presentationPackUpdateFromPanel(intent))).toBe(JSON.stringify(first));
    expect(JSON.stringify(intent)).toBe(original);
  });

  it("fences unsaved keystrokes, unfinished autosave and stale revisions before adoption", () => {
    const fence = {
      expectedSignature: "reviewed",
      currentSignature: "reviewed",
      savedSignature: "reviewed",
      expectedRevision: 3,
      currentRevision: 3,
    };
    expect(presentationPackDraftIsCurrent(fence)).toBe(true);
    expect(presentationPackDraftIsCurrent({ ...fence, currentSignature: "local edit" })).toBe(
      false,
    );
    expect(presentationPackDraftIsCurrent({ ...fence, savedSignature: "previous save" })).toBe(
      false,
    );
    expect(presentationPackDraftIsCurrent({ ...fence, currentRevision: 4 })).toBe(false);
  });

  it("preserves focus and existing block order, falling back nearby only if the selected copy was deleted", () => {
    const before: PresentationDraft = {
      schemaVersion: 2,
      title: "Ratios",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      blocks: [
        { kind: "question", id: diagnosticId, question: content.diagnostic },
        { kind: "question", id: recheckId, question: content.recheck },
      ],
    };
    expect(presentationPackSelectedBlock(before, before, recheckId)).toBe(recheckId);
    const after = { ...before, blocks: before.blocks.slice(1) };
    expect(presentationPackSelectedBlock(before, after, diagnosticId)).toBe(recheckId);
    expect(
      presentationPackSelectedBlock(before, { ...before, blocks: [] }, diagnosticId),
    ).toBeNull();
    expect(before.blocks.map((block) => block.id)).toEqual([diagnosticId, recheckId]);
  });
});
