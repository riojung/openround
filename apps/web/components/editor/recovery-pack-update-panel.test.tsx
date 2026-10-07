import { renderToStaticMarkup } from "react-dom/server";
import { RecoveryPackContentSchema } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import { RecoveryPackLinkIssue, RecoveryPackUpdatePanel } from "./recovery-pack-update-panel";

const diagnostic = {
  id: "10000000-0000-4000-8000-000000000001",
  type: "numeric",
  prompt: "Compare two quantities",
  purpose: "diagnostic",
  delivery: "main",
  conceptKeys: ["ratios"],
  linkedRecheckQuestionId: "10000000-0000-4000-8000-000000000002",
  timeLimitSeconds: 30,
  basePoints: 100,
  explanation: "Use a ratio.",
  mediaId: null,
  mediaAlt: null,
  correctValue: "2",
  tolerance: "0",
  unit: null,
};
const referenceContent = RecoveryPackContentSchema.parse({
  schemaVersion: 1,
  title: "Ratios",
  description: "",
  diagnostic,
  recheck: {
    ...diagnostic,
    id: diagnostic.linkedRecheckQuestionId,
    prompt: "Compare a different pair of quantities",
    delivery: "recheck",
    linkedRecheckQuestionId: null,
  },
  interventions: [
    {
      id: "10000000-0000-4000-8000-000000000003",
      title: "Example",
      body: "Accepted baseline guidance.",
    },
  ],
  conceptKeys: ["ratios"],
});

describe("Recovery Pack update panel", () => {
  it("announces a specific invalid linked-pair selection without hiding the recovery action", () => {
    const issue = "Use the latest diagnostic to link the restored recheck, or keep it deleted.";
    const markup = renderToStaticMarkup(<RecoveryPackLinkIssue issue={issue} />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-label="Linked checkpoint choices"');
    expect(markup).toContain(issue);
    expect(renderToStaticMarkup(<RecoveryPackLinkIssue issue={null} />)).toBe("");
  });
  it("explains the saved-draft barrier and keeps read-only review available after rollout is disabled", () => {
    const markup = renderToStaticMarkup(
      <RecoveryPackUpdatePanel
        quizId="round"
        insertionId="insertion"
        title="Ratios"
        canEdit={false}
        featureEnabled={false}
        currentDraftRevision={3}
        draftSignature="original"
        draftSaved
        mutationBusy={false}
        receiptRetryable={false}
        onReview={async () => {
          throw new Error("unused");
        }}
        onApply={async () => {
          throw new Error("unused");
        }}
        onUndo={async () => {
          throw new Error("unused");
        }}
      />,
    );
    expect(markup).toContain("Review Pack updates · Ratios");
    expect(markup).toContain("Conflicts and deleted checkpoints require an explicit choice");
    expect(markup).toContain("Review first saves pending Round edits");
    expect(markup).toContain("Existing references and update comparisons remain readable");
    expect(markup).not.toContain('disabled=""');
  });
  it("labels Presentation review and saving without changing the default Round copy", () => {
    const markup = renderToStaticMarkup(
      <RecoveryPackUpdatePanel
        quizId="presentation"
        artifactLabel="Presentation"
        allowDisabledReceiptRetry
        insertionId="insertion"
        title="Ratios"
        canEdit
        featureEnabled={false}
        currentDraftRevision={3}
        draftSignature="original"
        draftSaved
        mutationBusy
        receiptRetryable={false}
        onReview={async () => {
          throw new Error("unused");
        }}
        onApply={async () => {
          throw new Error("unused");
        }}
        onUndo={async () => {
          throw new Error("unused");
        }}
      />,
    );
    expect(markup).toContain("Saving or reviewing the Presentation draft");
    expect(markup).toContain("Review first saves pending Presentation edits");
    expect(markup).not.toContain("Round");
  });
  it.each(["Round", "Presentation"] as const)(
    "describes conditional live playback for new %s sessions without changing accepted references",
    (artifactLabel) => {
      const markup = renderToStaticMarkup(
        <RecoveryPackUpdatePanel
          quizId="artifact"
          artifactLabel={artifactLabel}
          insertionId="insertion"
          title="Ratios"
          referenceContent={referenceContent}
          canEdit={false}
          featureEnabled={false}
          currentDraftRevision={3}
          draftSignature="original"
          draftSaved
          mutationBusy={false}
          receiptRetryable={false}
          onReview={async () => {
            throw new Error("unused");
          }}
          onApply={async () => {
            throw new Error("unused");
          }}
          onUndo={async () => {
            throw new Error("unused");
          }}
        />,
      );
      expect(markup).toContain("These copied references change only when you accept a Pack update");
      expect(markup).toContain(
        `Live explanation or worked-example playback is available in eligible new ${artifactLabel} sessions when enabled for the workspace`,
      );
      expect(markup).toContain(
        "The facilitator explicitly selects a card after revealing the Pack diagnostic",
      );
      expect(markup).toContain("Accepted baseline guidance.");
      expect(markup).not.toContain("not available yet");
      expect(markup).not.toContain("Compare two quantities");
      expect(markup).not.toContain("delayed probe");
    },
  );
});
