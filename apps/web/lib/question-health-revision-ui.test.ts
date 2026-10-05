import { describe, expect, it } from "vitest";
import type { QuestionHealthFinding } from "@openround/contracts";
import {
  healthChangeValue,
  healthRevisionAction,
  healthRevisionControl,
} from "./question-health-revision-ui";

function finding(
  ruleId: QuestionHealthFinding["ruleId"],
  fieldPath: string,
): QuestionHealthFinding {
  return {
    id: "finding-id",
    ruleId,
    ruleVersion: 1,
    rulesetVersion: "1.0.0",
    severity: "advisory",
    questionId: "00000000-0000-4000-8000-000000000001",
    fieldPath,
    contentHash: "a".repeat(64),
    reason: "Review this question",
    evidence: "Evidence",
    recommendedAction: "Revise the field",
  };
}

describe("Question Health revision controls", () => {
  it("offers a scoped edit only for supported finding and field combinations", () => {
    expect(healthRevisionControl(finding("choice.overlap", "questions.0.choices.2.label"))).toEqual(
      {
        kind: "set_choice_label",
        label: "Revised choice text",
        maxLength: 180,
      },
    );
    expect(
      healthRevisionControl(finding("question.dense_content", "questions.0.choices")),
    ).toBeNull();
    expect(
      healthRevisionControl(finding("question.missing_citation", "questions.0.sourceCitations")),
    ).toBeNull();
    expect(
      healthRevisionControl(
        finding("recheck.concept_mismatch", "questions.0.linkedRecheckQuestionId"),
      ),
    ).toBeNull();
  });

  it("requires a bounded authored value and permits the no-input settings action", () => {
    const textControl = healthRevisionControl(
      finding("question.missing_explanation", "questions.0.explanation"),
    );
    expect(textControl).not.toBeNull();
    if (!textControl) return;
    expect(healthRevisionAction(textControl, "   ")).toBeNull();
    expect(healthRevisionAction(textControl, " Reasoning. ")).toEqual({
      kind: "set_explanation",
      value: "Reasoning.",
    });
    expect(healthRevisionAction(textControl, "x".repeat(1_001))).toBeNull();

    const settingsControl = healthRevisionControl(
      finding("question.configuration_mismatch", "questions.0.purpose"),
    );
    expect(settingsControl && healthRevisionAction(settingsControl, "")).toEqual({
      kind: "align_opinion_settings",
    });
  });

  it("renders null and scalar changes legibly in a before/after diff", () => {
    expect(healthChangeValue(null)).toBe("Not set");
    expect(healthChangeValue(0)).toBe("0");
    expect(healthChangeValue("New text")).toBe("New text");
  });
});
