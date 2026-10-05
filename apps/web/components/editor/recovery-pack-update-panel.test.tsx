import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecoveryPackLinkIssue, RecoveryPackUpdatePanel } from "./recovery-pack-update-panel";

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
});
