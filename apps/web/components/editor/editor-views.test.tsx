import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { QuestionDraft, QuizDraft } from "@openround/contracts";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { DeliveryScoring } from "./delivery-scoring";
import { DiagnosticDetails } from "./diagnostic-details";
import { MediaEditor } from "./media-editor";
import { ParticipantPreview } from "./participant-preview";
import { QuestionNavigator } from "./question-navigator";
import { ResponseEditor } from "./response-editor";

const noopUpdate = () => undefined;

vi.mock("next/navigation", () => ({
  usePathname: () => "/quiz/test-round",
}));

function renderLocalized(node: ReactNode) {
  return renderToStaticMarkup(withEnglishLocale(node));
}

const choiceQuestion: QuestionDraft = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "single_select",
  prompt: "Which model fits?",
  purpose: "diagnostic",
  confidence: "required",
  delivery: "main",
  conceptKeys: ["models"],
  linkedRecheckQuestionId: "22222222-2222-4222-8222-222222222222",
  timeLimitSeconds: 20,
  basePoints: 1_000,
  explanation: "Compare the evidence.",
  mediaId: null,
  mediaAlt: "Two models side by side",
  choices: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      label: "Model A",
      isCorrect: true,
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      label: "Model B",
      isCorrect: false,
      misconceptionKey: "surface-match",
      feedback: "It matches one surface feature.",
    },
  ],
};

const recheckQuestion: QuestionDraft = {
  ...choiceQuestion,
  id: "22222222-2222-4222-8222-222222222222",
  prompt: "Which model fits the new evidence?",
  delivery: "recheck",
  linkedRecheckQuestionId: null,
};

const draft: QuizDraft = {
  title: "Models",
  description: "Check model selection.",
  questions: [choiceQuestion, recheckQuestion],
};

describe("editor views", () => {
  it("keeps stable-id navigation and the beta Insert menu labels", () => {
    const markup = renderLocalized(
      <QuestionNavigator
        canReuseQuestions
        draft={draft}
        insertType="numeric"
        onAddQuestion={() => undefined}
        onInsertTypeChange={() => undefined}
        onMoveQuestion={() => undefined}
        onOpenQuestionReuse={() => undefined}
        onSelectQuestion={() => undefined}
        questionReuseOpen={false}
        selectedQuestionId={recheckQuestion.id}
        uxBeta
      />,
    );

    expect(markup).toContain('id="insert-question-type"');
    expect(markup).toContain('id="insert-question-guidance"');
    expect(markup).toContain("A numeric answer with optional tolerance and unit.");
    expect(markup).toContain("Add question");
    expect(markup).toContain("Reuse from your workspace");
    expect(markup).toContain('aria-controls="private-question-bank"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain("Which model fits the new evidence?");
    expect(markup).toContain('<span lang="">Which model fits the new evidence?</span>');
    expect(markup).toContain("Single select · recheck");
    expect(markup).toMatch(/aria-label="Question 1 actions"[^>]*lang="en-CA"/);
  });

  it("preserves the feature-off checkpoint navigator", () => {
    const markup = renderLocalized(
      <QuestionNavigator
        draft={draft}
        insertType="single_select"
        onAddQuestion={() => undefined}
        onInsertTypeChange={() => undefined}
        onSelectQuestion={() => undefined}
        selectedQuestionId={choiceQuestion.id}
        uxBeta={false}
      />,
    );

    expect(markup).toContain("Checkpoints");
    expect(markup).toContain(">Numeric</button>");
    expect(markup).toContain('class="panel"');
    expect(markup).not.toContain('id="insert-question-type"');
    expect(markup).not.toContain("Reuse from your workspace");
    expect(markup).not.toContain('aria-label="Question map"');
    expect(markup).not.toContain("Collapse question map");
  });

  it("renders diagnostic details as a beta disclosure without exposing IDs as labels", () => {
    const markup = renderLocalized(
      <DiagnosticDetails
        onUpdateQuestion={noopUpdate}
        question={choiceQuestion}
        questions={draft.questions}
        uxBeta
      />,
    );

    expect(markup).toContain('id="question-diagnostic-details"');
    expect(markup).toContain("Diagnostic details and recheck link");
    expect(markup).toContain("Paired recheck question");
    expect(markup).toMatch(/<option lang="" value="22222222-2222-4222-8222-222222222222"[^>]*>/);
    expect(markup).toContain("Which model fits the new evidence?");
    expect(markup).not.toContain(`>${recheckQuestion.id}<`);
  });

  it("keeps legacy diagnostic controls expanded when the beta is off", () => {
    const markup = renderLocalized(
      <DiagnosticDetails
        onUpdateQuestion={noopUpdate}
        question={choiceQuestion}
        questions={draft.questions}
        uxBeta={false}
      />,
    );

    expect(markup).toContain("Linked recheck");
    expect(markup).not.toContain("<details");
  });

  it("renders each response editor with its existing labels", () => {
    const choiceMarkup = renderLocalized(
      <ResponseEditor
        onStructuralChange={() => undefined}
        onUpdateChoiceQuestion={noopUpdate}
        onUpdateQuestion={noopUpdate}
        question={choiceQuestion}
        uxBeta
      />,
    );
    const numericMarkup = renderLocalized(
      <ResponseEditor
        onStructuralChange={() => undefined}
        onUpdateChoiceQuestion={noopUpdate}
        onUpdateQuestion={noopUpdate}
        question={{
          ...choiceQuestion,
          type: "numeric",
          correctValue: "42",
          tolerance: "0.5",
          unit: "kg",
        }}
        uxBeta
      />,
    );
    const ratingMarkup = renderLocalized(
      <ResponseEditor
        onStructuralChange={() => undefined}
        onUpdateChoiceQuestion={noopUpdate}
        onUpdateQuestion={noopUpdate}
        question={{
          ...choiceQuestion,
          type: "rating",
          min: 1,
          max: 5,
          minLabel: "Low",
          maxLabel: "High",
        }}
        uxBeta
      />,
    );

    expect(choiceMarkup).toContain("Choices and correct answer");
    expect(choiceMarkup).toContain('aria-label="Mark choice 1 correct"');
    expect(choiceMarkup).toContain('lang="en-CA" type="radio"');
    expect(choiceMarkup).toContain(
      'aria-labelledby="answer-label-33333333-3333-4333-8333-333333333333"',
    );
    expect(choiceMarkup).toContain('lang="" maxLength="180"');
    expect(choiceMarkup).toContain("Diagnostic rationale and feedback");
    expect(numericMarkup).toContain("Correct value");
    expect(numericMarkup).toContain("Absolute tolerance");
    expect(numericMarkup).toContain("Optional unit");
    expect(ratingMarkup).toContain("Minimum label");
    expect(ratingMarkup).toContain("Maximum label");
  });

  it("keeps media, delivery, scoring, and participant preview semantics", () => {
    const mediaMarkup = renderLocalized(
      <MediaEditor
        mediaPreviewUrl="https://example.test/scanned.png"
        mediaState="idle"
        mediaUploadsEnabled
        onRemoveImage={() => undefined}
        onUpdateQuestion={noopUpdate}
        onUploadImage={() => undefined}
        question={choiceQuestion}
        uxBeta
      />,
    );
    const deliveryMarkup = renderLocalized(
      <DeliveryScoring onUpdateQuestion={noopUpdate} question={choiceQuestion} />,
    );
    const previewMarkup = renderLocalized(<ParticipantPreview question={choiceQuestion} />);

    expect(mediaMarkup).toContain('id="media-alt"');
    expect(mediaMarkup).toContain('id="media-upload"');
    expect(mediaMarkup).toContain('alt="Two models side by side"');
    expect(mediaMarkup).toMatch(/<img[^>]*lang=""[^>]*width="640"/);
    expect(mediaMarkup).toContain("Remove image");
    expect(deliveryMarkup).toContain("Time limit");
    expect(deliveryMarkup).toContain("Base points");
    expect(deliveryMarkup).toContain('id="explanation"');
    expect(previewMarkup).toContain('aria-label="Participant preview"');
    expect(previewMarkup).toContain('<span lang="">Which model fits?</span>');
    expect(previewMarkup).toContain('<span lang="">Model A</span>');
    expect(previewMarkup).toContain("Confidence will be requested before Submit.");
    expect(previewMarkup).toContain("Submit answer");
  });
});
