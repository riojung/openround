import { describe, expect, it } from "vitest";
import { RecoveryPackContentSchema, type RecoveryPackUpdatePreview } from "@openround/contracts";
import {
  recoveryPackChangedFields,
  recoveryPackDefaultSelections,
  recoveryPackReviewIsCurrent,
  recoveryPackSelectedChoices,
  recoveryPackSelectedLinkIssue,
  recoveryPackUpdateAvailable,
  recoveryPackUndoIsCurrent,
} from "./recovery-pack-update-ui";

const ids = {
  diagnostic: "10000000-0000-4000-8000-000000000001",
  recheck: "10000000-0000-4000-8000-000000000002",
};
const diagnostic = {
  id: ids.diagnostic,
  type: "numeric" as const,
  prompt: "First situation",
  purpose: "diagnostic" as const,
  delivery: "main" as const,
  conceptKeys: ["ratios"],
  linkedRecheckQuestionId: ids.recheck,
  timeLimitSeconds: 30,
  basePoints: 100,
  explanation: "Use a ratio.",
  mediaId: null,
  mediaAlt: null,
  correctValue: "2",
  tolerance: "0",
  unit: null,
};
const content = RecoveryPackContentSchema.parse({
  schemaVersion: 1,
  title: "Ratios",
  description: "",
  diagnostic,
  recheck: {
    ...diagnostic,
    id: ids.recheck,
    prompt: "Transfer situation",
    delivery: "recheck",
    linkedRecheckQuestionId: null,
  },
  interventions: [
    { id: "10000000-0000-4000-8000-000000000003", title: "Example", body: "Compare two ratios." },
  ],
  conceptKeys: ["ratios"],
});
const preview: RecoveryPackUpdatePreview = {
  quizId: ids.diagnostic,
  insertionId: ids.recheck,
  draftRevision: 3,
  baselineVersion: 1,
  baselineVersionId: ids.diagnostic,
  latestVersion: 2,
  latestVersionId: ids.recheck,
  baselineContent: content,
  latestContent: content,
  contextChanged: false,
  items: [
    {
      role: "diagnostic",
      questionId: ids.diagnostic,
      baseline: content.diagnostic,
      local: content.diagnostic,
      latest: content.diagnostic,
      status: "source_changed",
    },
    {
      role: "recheck",
      questionId: ids.recheck,
      baseline: content.recheck,
      local: content.recheck,
      latest: content.recheck,
      status: "conflict",
    },
  ],
};

describe("Recovery Pack update controls", () => {
  it("requires an explicit linked diagnostic choice before restoring an unlinked deleted recheck", () => {
    const deletionReview: RecoveryPackUpdatePreview = {
      ...preview,
      items: preview.items.map((item) =>
        item.role === "diagnostic"
          ? {
              ...item,
              status: "local_changed",
              local: { ...item.baseline, linkedRecheckQuestionId: null },
            }
          : { ...item, status: "conflict", local: null },
      ),
    };
    expect(recoveryPackSelectedLinkIssue(deletionReview, null)).toBeNull();
    expect(
      recoveryPackSelectedLinkIssue(
        deletionReview,
        recoveryPackSelectedChoices(deletionReview, {
          diagnostic: "keep_local",
          recheck: "use_latest",
        }),
      ),
    ).toBeTypeOf("string");
    for (const selections of [
      { diagnostic: "use_latest", recheck: "use_latest" },
      { diagnostic: "keep_local", recheck: "keep_local" },
    ] as const) {
      expect(
        recoveryPackSelectedLinkIssue(
          deletionReview,
          recoveryPackSelectedChoices(deletionReview, selections),
        ),
      ).toBeNull();
    }
  });
  it("keeps fresh or already-accepted source comparisons read-only rather than submitting a no-op", () => {
    expect(recoveryPackUpdateAvailable(preview)).toBe(true);
    expect(
      recoveryPackUpdateAvailable({ ...preview, latestVersionId: preview.baselineVersionId }),
    ).toBe(false);
    expect(recoveryPackUpdateAvailable({ ...preview, baselineVersion: 3, latestVersion: 1 })).toBe(
      true,
    );
  });
  it("auto-selects only safe source changes and requires an explicit conflict/deletion decision", () => {
    const selections = recoveryPackDefaultSelections(preview);
    expect(selections).toEqual({ diagnostic: "use_latest" });
    expect(recoveryPackSelectedChoices(preview, selections)).toBeNull();
    expect(recoveryPackSelectedChoices(preview, { ...selections, recheck: "keep_local" })).toEqual([
      { role: "diagnostic", action: "use_latest" },
      { role: "recheck", action: "keep_local" },
    ]);
    const unchanged = {
      ...preview,
      items: preview.items.map((item) => ({ ...item, status: "local_changed" as const })),
    };
    expect(recoveryPackDefaultSelections(unchanged)).toEqual({
      diagnostic: "keep_local",
      recheck: "keep_local",
    });
  });
  it("invalidates both local-keystroke and saved-revision changes", () => {
    expect(recoveryPackReviewIsCurrent(preview, 3, "original", "original")).toBe(true);
    expect(recoveryPackReviewIsCurrent(preview, 4, "original", "original")).toBe(false);
    expect(recoveryPackReviewIsCurrent(preview, 3, "original", "edited")).toBe(false);
  });
  it("bounds update undo to the unchanged applied revision, independently of feature rollout", () => {
    const undo = { appliedRevision: 4, draftSignature: "accepted" };
    expect(recoveryPackUndoIsCurrent(undo, 4, "accepted")).toBe(true);
    expect(recoveryPackUndoIsCurrent(undo, 5, "accepted")).toBe(false);
    expect(recoveryPackUndoIsCurrent(undo, 4, "new local edit")).toBe(false);
    expect(recoveryPackUndoIsCurrent(null, 4, "accepted")).toBe(false);
  });
  it("uses the shared semantic rules instead of flagging copy IDs, defaults, or decimal notation", () => {
    const copiedIds = {
      diagnostic: "20000000-0000-4000-8000-000000000001",
      recheck: "20000000-0000-4000-8000-000000000002",
    };
    const copy = {
      ...content.diagnostic,
      id: copiedIds.diagnostic,
      linkedRecheckQuestionId: copiedIds.recheck,
      correctValue: "2.00",
    };
    expect(recoveryPackChangedFields(content.diagnostic, copy, ids, copiedIds)).toEqual([]);
    expect(
      recoveryPackChangedFields(
        content.diagnostic,
        { ...copy, explanation: "New explanation" },
        ids,
        copiedIds,
      ),
    ).toEqual(["explanation"]);
    expect(recoveryPackChangedFields(content.diagnostic, null, ids, copiedIds)).toEqual([
      "checkpoint deleted",
    ]);
  });
});
