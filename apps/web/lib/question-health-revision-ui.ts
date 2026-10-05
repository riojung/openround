import type {
  QuestionHealthFinding,
  QuestionHealthRevisionAction,
  QuestionHealthRevisionChange,
} from "@openround/contracts";

type TextActionKind = Exclude<QuestionHealthRevisionAction["kind"], "align_opinion_settings">;

export type HealthRevisionControl =
  | { kind: "align_opinion_settings"; label: string }
  | { kind: TextActionKind; label: string; maxLength: number };

/** Only offer an edit when the finding names one field that the server can change safely. */
export function healthRevisionControl(
  finding: QuestionHealthFinding,
): HealthRevisionControl | null {
  const choiceLabel = /^questions\.\d+\.choices\.\d+\.label$/.test(finding.fieldPath);
  if (
    choiceLabel &&
    (finding.ruleId === "choice.duplicate" ||
      finding.ruleId === "choice.overlap" ||
      finding.ruleId === "choice.length_cue" ||
      finding.ruleId === "question.dense_content")
  ) {
    return { kind: "set_choice_label", label: "Revised choice text", maxLength: 180 };
  }
  if (
    finding.ruleId === "choice.missing_rationale" &&
    /^questions\.\d+\.choices\.\d+\.feedback$/.test(finding.fieldPath)
  ) {
    return { kind: "set_choice_feedback", label: "Distractor feedback", maxLength: 500 };
  }
  if (
    finding.ruleId === "question.missing_explanation" &&
    /^questions\.\d+\.explanation$/.test(finding.fieldPath)
  ) {
    return { kind: "set_explanation", label: "Answer explanation", maxLength: 1_000 };
  }
  if (
    finding.ruleId === "question.dense_content" &&
    /^questions\.\d+\.prompt$/.test(finding.fieldPath)
  ) {
    return { kind: "set_prompt", label: "Revised prompt", maxLength: 500 };
  }
  if (
    finding.ruleId === "recheck.same_prompt" &&
    /^questions\.\d+\.linkedRecheckQuestionId$/.test(finding.fieldPath)
  ) {
    return { kind: "set_recheck_prompt", label: "Revised recheck prompt", maxLength: 500 };
  }
  if (
    finding.ruleId === "question.configuration_mismatch" &&
    /^questions\.\d+\.purpose$/.test(finding.fieldPath)
  ) {
    return { kind: "align_opinion_settings", label: "Align opinion settings" };
  }
  return null;
}

export function healthRevisionAction(
  control: HealthRevisionControl,
  authoredValue: string,
): QuestionHealthRevisionAction | null {
  if (control.kind === "align_opinion_settings") return { kind: control.kind };
  const value = authoredValue.trim();
  if (!value || value.length > control.maxLength) return null;
  return { kind: control.kind, value };
}

export function healthChangeValue(value: QuestionHealthRevisionChange["before"]): string {
  if (value === null) return "Not set";
  return String(value);
}
