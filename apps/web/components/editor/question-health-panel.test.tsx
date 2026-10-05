import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionHealthPanel } from "./question-health-panel";

describe("Question Health panel", () => {
  it("explains its advisory, draft-only preview behavior and disables stale analysis", () => {
    const markup = renderToStaticMarkup(
      <QuestionHealthPanel canEdit quizId="round-id" currentDraftRevision={4} draftSaved={false} />,
    );

    expect(markup).toContain("Question Health · advisory");
    expect(markup).toContain("do not block publishing");
    expect(markup).toContain("preview a change before applying it to the draft");
    expect(markup).toContain("published versions never change");
    expect(markup).toContain("Save your latest edits before reviewing them.");
    expect(markup).toContain('disabled=""');
  });
});
