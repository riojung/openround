import {
  QuizDraftSchema,
  questionPurpose,
  type QuestionHealthFinding,
  type QuestionHealthRevisionAction,
  type QuestionHealthRevisionChange,
  type QuizDraft,
} from "@openround/contracts";

/**
 * A strict, rule-specific edit allowlist. Findings are advice, not an arbitrary JSON-patch API.
 * Text and citations never come from an AI provider or from a guessed server-side rewrite.
 */
export function proposeQuestionHealthRevision(
  draft: QuizDraft,
  finding: QuestionHealthFinding,
  action: QuestionHealthRevisionAction,
): { draft: QuizDraft; changes: QuestionHealthRevisionChange[] } | null {
  const indexMatch = /^questions\.(\d+)\./.exec(finding.fieldPath);
  if (!indexMatch) return null;
  const questionIndex = Number(indexMatch[1]);
  const source = draft.questions[questionIndex];
  if (!source || source.id !== finding.questionId) return null;

  const next = structuredClone(draft);
  const question = next.questions[questionIndex]!;
  const changes: QuestionHealthRevisionChange[] = [];
  const change = (
    fieldPath: string,
    before: string | number | null | undefined,
    after: string | number | null,
  ) => {
    const prior = before ?? null;
    if (prior !== after) changes.push({ fieldPath, before: prior, after });
  };

  switch (action.kind) {
    case "align_opinion_settings": {
      if (
        finding.ruleId !== "question.configuration_mismatch" ||
        finding.fieldPath !== `questions.${questionIndex}.purpose` ||
        questionPurpose(question) !== "opinion" ||
        question.type === "poll" ||
        question.type === "rating"
      )
        return null;
      change(`questions.${questionIndex}.basePoints`, question.basePoints, 0);
      change(`questions.${questionIndex}.confidence`, question.confidence, "off");
      question.basePoints = 0;
      question.confidence = "off";
      break;
    }
    case "set_explanation": {
      if (
        finding.ruleId !== "question.missing_explanation" ||
        finding.fieldPath !== `questions.${questionIndex}.explanation`
      )
        return null;
      change(finding.fieldPath, question.explanation, action.value);
      question.explanation = action.value;
      break;
    }
    case "set_choice_feedback": {
      if (finding.ruleId !== "choice.missing_rationale" || !("choices" in question)) return null;
      const match = new RegExp(`^questions\\.${questionIndex}\\.choices\\.(\\d+)\\.feedback$`).exec(
        finding.fieldPath,
      );
      const choice = match ? question.choices[Number(match[1])] : null;
      if (!choice || choice.isCorrect) return null;
      change(finding.fieldPath, choice.feedback, action.value);
      choice.feedback = action.value;
      break;
    }
    case "set_choice_label": {
      if (
        ![
          "choice.duplicate",
          "choice.overlap",
          "choice.length_cue",
          "question.dense_content",
        ].includes(finding.ruleId) ||
        !("choices" in question)
      )
        return null;
      const match = new RegExp(`^questions\\.${questionIndex}\\.choices\\.(\\d+)\\.label$`).exec(
        finding.fieldPath,
      );
      const choice = match ? question.choices[Number(match[1])] : null;
      if (!choice) return null;
      change(finding.fieldPath, choice.label, action.value);
      choice.label = action.value;
      break;
    }
    case "set_prompt": {
      if (
        finding.ruleId !== "question.dense_content" ||
        finding.fieldPath !== `questions.${questionIndex}.prompt`
      )
        return null;
      change(finding.fieldPath, question.prompt, action.value);
      question.prompt = action.value;
      break;
    }
    case "set_recheck_prompt": {
      if (
        finding.ruleId !== "recheck.same_prompt" ||
        finding.fieldPath !== `questions.${questionIndex}.linkedRecheckQuestionId`
      )
        return null;
      const targetIndex = next.questions.findIndex(
        (candidate) => candidate.id === question.linkedRecheckQuestionId,
      );
      if (targetIndex < 0) return null;
      const target = next.questions[targetIndex]!;
      change(`questions.${targetIndex}.prompt`, target.prompt, action.value);
      target.prompt = action.value;
      break;
    }
  }

  if (changes.length === 0) return null;
  const validated = QuizDraftSchema.safeParse(next);
  return validated.success ? { draft: validated.data, changes } : null;
}
