import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  QuestionHealthPostUseResultSchema,
  QuestionHealthPublishedResultSchema,
} from "@openround/contracts";
import {
  PublishedQuestionHealthPanel,
  PublishedQuestionHealthObservations,
  PublishedQuestionHealthResults,
} from "./question-health-published-panel";

const quizId = "00000000-0000-4000-8000-000000000001";
const versionId = "00000000-0000-4000-8000-000000000002";
const questionId = "00000000-0000-4000-8000-000000000003";
const removedQuestionId = "00000000-0000-4000-8000-000000000004";

const result = QuestionHealthPublishedResultSchema.parse({
  source: "published",
  quizId,
  version: {
    id: versionId,
    number: 3,
    contentHash: "a".repeat(64),
    publishedAt: "2026-10-01T12:00:00.000Z",
    sourceDraftRevision: 7,
  },
  rulesetVersion: "1.0.0",
  evaluatedQuestionCount: 2,
  findings: [
    {
      id: "missing-explanation",
      ruleId: "question.missing_explanation",
      ruleVersion: 1,
      rulesetVersion: "1.0.0",
      severity: "advisory",
      questionId,
      fieldPath: "questions.0.explanation",
      contentHash: "b".repeat(64),
      reason: "This question has no explanation.",
      evidence: "Explanation is empty.",
      recommendedAction: "Write an explanation.",
    },
    {
      id: "missing-citation",
      ruleId: "question.missing_citation",
      ruleVersion: 1,
      rulesetVersion: "1.0.0",
      severity: "advisory",
      questionId: removedQuestionId,
      fieldPath: "questions.1.sourceCitations",
      contentHash: "c".repeat(64),
      reason: "This question has no citation.",
      evidence: "No source citation is attached.",
      recommendedAction: "Attach a citation.",
    },
  ],
  findingsTruncated: false,
});

const postUseResult = QuestionHealthPostUseResultSchema.parse({
  quizId,
  source: "published",
  rulesetVersion: "post-use-1.0.0",
  version: result.version,
  eligibility: {
    minimumResponsesPerSession: 20,
    instabilityMinimumSessions: 3,
    instabilityThresholdPercentagePoints: 30,
  },
  history: { maxReports: 250, reportsIncluded: 250, hasMoreReports: true },
  cohorts: [
    {
      trustMode: "learning",
      timeMode: "timed",
      scoringMode: "accuracy",
      questions: [
        {
          questionId,
          questionPosition: 1,
          sample: { sessions: 1, responses: 20, minimumResponsesPerSession: 20 },
          correct: 14,
          accuracyPercent: 70,
          sessionAccuracyRange: { minPercent: 70, maxPercent: 70 },
          signals: [
            {
              id: "choice.unused_after_use:question:choice",
              ruleId: "choice.unused_after_use",
              ruleVersion: 1,
              severity: "advisory",
              questionId,
              choiceId: removedQuestionId,
              evidence: "Not selected in this aggregate sample.",
              recommendedAction: "Review whether this is a plausible distractor.",
            },
          ],
        },
      ],
    },
  ],
  evidenceNote:
    "Aggregate observations use the 250 most recent retained reports; older reports are omitted and results do not establish cause.",
});

describe("published Question Health", () => {
  it("makes the published review separate from draft changes", () => {
    const markup = renderToStaticMarkup(
      <PublishedQuestionHealthPanel
        canEdit
        draftQuestionIds={new Set([questionId])}
        featureEnabled
        onOpenDraftQuestion={() => undefined}
        quizId={quizId}
        versionId={versionId}
      />,
    );

    expect(markup).toContain("published version (read-only)");
    expect(markup).toContain("edit the separate current draft");
    expect(markup).toContain("publish a new version");
    expect(markup).toContain("Review published version");
    expect(markup).not.toContain("Dismiss finding");
    expect(markup).not.toContain("Apply to saved draft");
  });

  it("shows frozen version findings and only links questions still in the draft", () => {
    const markup = renderToStaticMarkup(
      <PublishedQuestionHealthResults
        canEdit
        draftQuestionIds={new Set([questionId])}
        onOpenDraftQuestion={() => undefined}
        result={result}
      />,
    );

    expect(markup).toContain("immutable published v3");
    expect(markup).toContain("current draft may differ");
    expect(markup).toContain("2 advisory findings across 2 questions");
    expect(markup).toContain("Edit matching question in current draft");
    expect(markup).toContain("no longer in the current draft");
    expect(markup.match(/Edit matching question in current draft/g)).toHaveLength(1);
    expect(markup).not.toContain("Dismiss finding");
    expect(markup).not.toContain("Apply to saved draft");
  });

  it("does not show draft-edit actions to viewers", () => {
    const markup = renderToStaticMarkup(
      <PublishedQuestionHealthResults
        canEdit={false}
        draftQuestionIds={new Set([questionId])}
        onOpenDraftQuestion={() => undefined}
        result={result}
      />,
    );
    expect(markup).not.toContain("Edit matching question in current draft");
  });

  it("keeps published findings visible when the current draft changes", () => {
    const unchangedQuestionIds = new Set([questionId]);
    const afterDraftEditQuestionIds = new Set<string>();
    const before = renderToStaticMarkup(
      <PublishedQuestionHealthResults
        canEdit
        draftQuestionIds={unchangedQuestionIds}
        onOpenDraftQuestion={() => undefined}
        result={result}
      />,
    );
    const after = renderToStaticMarkup(
      <PublishedQuestionHealthResults
        canEdit
        draftQuestionIds={afterDraftEditQuestionIds}
        onOpenDraftQuestion={() => undefined}
        result={result}
      />,
    );

    expect(before).toContain("immutable published v3");
    expect(after).toContain("immutable published v3");
    expect(after).toContain("This question has no explanation.");
    expect(after).toContain("This question has no citation.");
    expect(after).toContain(`Published content hash: <code>${"a".repeat(64)}</code>`);
    expect(after).not.toContain("Edit matching question in current draft");
  });

  it("labels aggregate evidence, sample limits, and draft review actions", () => {
    const markup = renderToStaticMarkup(
      <PublishedQuestionHealthObservations
        canEdit
        draftQuestionIds={new Set([questionId])}
        onOpenDraftQuestion={() => undefined}
        result={postUseResult}
      />,
    );

    expect(markup).toContain("Aggregate observations for published v3");
    expect(markup).toContain("at least 20 responses");
    expect(markup).toContain("Cross-session instability is not assessed");
    expect(markup).toContain("Distractor not selected");
    expect(markup).toContain("Review matching question in current draft");
    expect(markup).toContain("older reports are omitted");
    expect(markup).toContain("do not establish cause");
  });
});
