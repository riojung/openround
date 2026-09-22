import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { QuestionDraft } from "@openround/contracts";
import type { QuestionReuseSource } from "../../lib/question-reuse";
import { withEnglishLocale } from "../../test-utils/english-locale";
import { QuestionReusePicker } from "./question-reuse-picker";

vi.mock("next/navigation", () => ({ usePathname: () => "/quiz/example" }));

const sourceId = "00000000-0000-4000-8000-000000000001";
const mainId = "10000000-0000-4000-8000-000000000001";
const recheckId = "10000000-0000-4000-8000-000000000002";
const orphanId = "10000000-0000-4000-8000-000000000003";
const choiceId = "20000000-0000-4000-8000-000000000001";
const mediaId = "30000000-0000-4000-8000-000000000001";

function question(
  id: string,
  prompt: string,
  delivery: "main" | "recheck",
  linkedRecheckQuestionId: string | null,
): QuestionDraft {
  return {
    id,
    type: "single_select",
    prompt,
    purpose: "diagnostic",
    confidence: "required",
    delivery,
    conceptKeys: ["fractions.core"],
    linkedRecheckQuestionId,
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "Compare part and whole.",
    mediaId,
    mediaAlt: "A fraction model",
    choices: [
      { id: choiceId, label: "One half", isCorrect: true },
      {
        id: "20000000-0000-4000-8000-000000000002",
        label: "Two wholes",
        isCorrect: false,
      },
    ],
  };
}

function sources(): QuestionReuseSource[] {
  return [
    {
      id: sourceId,
      title: "Fraction foundations",
      draft: {
        questions: [
          question(mainId, "Which fraction is shaded?", "main", recheckId),
          question(recheckId, "Apply the model to a new diagram.", "recheck", null),
          question(orphanId, "Hidden orphan recheck", "recheck", null),
        ],
      },
    },
  ];
}

describe("QuestionReusePicker", () => {
  it("renders a private, searchable main-question picker without exposing raw IDs", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <QuestionReusePicker
          currentQuestionCount={4}
          onCancel={() => undefined}
          onReuse={() => undefined}
          sources={sources()}
        />,
      ),
    );

    expect(markup).toContain('data-testid="question-reuse-picker"');
    expect(markup).toContain('id="private-question-bank"');
    expect(markup).toContain('id="question-reuse-heading"');
    expect(markup).toContain("Private question bank");
    expect(markup).toContain("Search workspace questions");
    expect(markup).toContain('<span lang="">Fraction foundations</span>');
    expect(markup).toContain("· 1 question");
    expect(markup).toContain('<span lang="">Which fraction is shaded?</span>');
    expect(markup).toContain('<span lang=""> · fractions.core</span>');
    expect(markup).toContain("Includes paired recheck: Apply the model to a new diagram.");
    expect(markup).toContain("2 questions total");
    expect(markup).not.toContain("Hidden orphan recheck");
    expect(markup).not.toContain(sourceId);
    expect(markup).not.toContain(mainId);
    expect(markup).not.toContain(recheckId);
    expect(markup).not.toContain(choiceId);
    expect(markup).not.toContain(mediaId);
    expect(markup).toContain("196 question slots available.");
    expect(markup).toContain("Choose questions");
  });

  it("exposes empty and capacity-full states without making selection actionable", () => {
    const empty = renderToStaticMarkup(
      withEnglishLocale(
        <QuestionReusePicker
          currentQuestionCount={200}
          onCancel={() => undefined}
          onReuse={() => undefined}
          sources={[]}
        />,
      ),
    );

    expect(empty).toContain("No reusable main questions match your search.");
    expect(empty).toContain("This Round has reached its 200 questions limit.");
    expect(empty).toContain("disabled");
    expect(empty).toContain("Cancel reuse");
  });
});
