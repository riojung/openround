import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestionHealthPanel } from "./question-health-panel";

describe("Question Health panel", () => {
  it("explains its advisory, saved-draft-only behavior and disables stale analysis", () => {
    const markup = renderToStaticMarkup(
      <QuestionHealthPanel quizId="round-id" currentDraftRevision={4} draftSaved={false} />,
    );

    expect(markup).toContain("Question Health · advisory");
    expect(markup).toContain("do not block publishing");
    expect(markup).toContain("never change question content");
    expect(markup).toContain("Save your latest edits before reviewing them.");
    expect(markup).toContain('disabled=""');
  });
});
