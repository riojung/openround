import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuilderCommandBar } from "./builder-command-bar";
import { QuestionInspector } from "./question-inspector";
import { ReadinessSummary } from "./readiness-summary";

const noop = () => undefined;

describe("Round Builder shell", () => {
  it("keeps title, autosave, history, preview, and publish in one command bar", () => {
    const markup = renderToStaticMarkup(
      <BuilderCommandBar
        canRedo={false}
        canUndo
        inspectorOpen
        onPreview={noop}
        onPublish={noop}
        onRedo={noop}
        onTitleChange={noop}
        onToggleInspector={noop}
        onToggleQuestionMap={noop}
        onUndo={noop}
        previewDisabled={false}
        publishDisabled={false}
        publishLabel="Publish"
        questionMapOpen
        saveState="saving"
        status="draft"
        title="Safety refresher"
      />,
    );

    expect(markup).toContain('id="quiz-title"');
    expect(markup).toContain('value="Safety refresher"');
    expect(markup).toContain("Saving…");
    expect(markup).toContain('aria-label="Undo last edit"');
    expect(markup).toContain('aria-label="Redo last edit"');
    expect(markup).toContain(">Preview</button>");
    expect(markup).toContain(">Publish</button>");
  });

  it("exposes every readiness issue as a navigable action", () => {
    const markup = renderToStaticMarkup(
      <ReadinessSummary
        action="publish"
        issues={[
          {
            id: "question-one",
            source: "Question 1",
            resolution: "Enter the question prompt.",
            questionId: "one",
          },
          {
            id: "question-two",
            source: "Question 2",
            resolution: "Fill answer choice 2.",
            questionId: "two",
          },
        ]}
        onSelectIssue={noop}
      />,
    );

    expect(markup).toContain("Cannot publish this Round yet");
    expect(markup).toContain("2 items need attention");
    expect(markup).toContain("Question 1: Enter the question prompt.");
    expect(markup).toContain("Question 2: Fill answer choice 2.");
  });

  it("renders Build, Diagnose, and Recover as an accessible inspector tab set", () => {
    const markup = renderToStaticMarkup(
      <QuestionInspector
        activeTab="diagnose"
        build={<p>Build controls</p>}
        collapsed={false}
        diagnose={<p>Diagnostic controls</p>}
        onTabChange={noop}
        onToggle={noop}
        recover={<p>Recovery controls</p>}
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("Build");
    expect(markup).toContain("Diagnose");
    expect(markup).toContain("Recover");
    expect(markup).toContain("Diagnostic controls");
    expect(markup).toContain('id="inspector-build"');
    expect(markup).toContain('hidden=""');
  });
});
