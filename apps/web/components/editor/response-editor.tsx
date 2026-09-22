import type { QuestionDraft } from "@openround/contracts";
import { clientUuid } from "../../lib/uuid";
import { BetaDisclosure } from "./beta-disclosure";
import {
  isChoiceQuestion,
  type ChoiceQuestionDraft,
  type ChoiceQuestionUpdater,
  type QuestionStructuralChange,
  type QuestionUpdater,
} from "./types";
import { useLocale } from "../locale-provider";

function ChoiceResponseEditor({
  question,
  uxBeta,
  onStructuralChange,
  onUpdateChoiceQuestion,
}: {
  question: ChoiceQuestionDraft;
  uxBeta: boolean;
  onStructuralChange: QuestionStructuralChange;
  onUpdateChoiceQuestion: ChoiceQuestionUpdater;
}) {
  const { locale, t } = useLocale();
  return (
    <>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="field-label" style={{ marginBottom: 10 }}>
          {question.type === "poll"
            ? t("questionType.poll.label")
            : t("delivery.builder.choicesAndCorrect")}
        </legend>
        {question.choices.map((choice, index) => (
          <div className="choice-row" key={choice.id}>
            {question.type !== "poll" ? (
              <input
                aria-label={`Mark choice ${index + 1} correct`}
                checked={choice.isCorrect}
                className="choice-correct"
                name={
                  question.type === "multi_select"
                    ? `correct-choice-${choice.id}`
                    : "correct-choice"
                }
                onChange={() =>
                  onUpdateChoiceQuestion((item) => ({
                    ...item,
                    choices: item.choices.map((candidate) => ({
                      ...candidate,
                      isCorrect:
                        item.type === "multi_select"
                          ? candidate.id === choice.id
                            ? !candidate.isCorrect
                            : candidate.isCorrect
                          : candidate.id === choice.id,
                    })),
                  }))
                }
                lang="en-CA"
                type={question.type === "multi_select" ? "checkbox" : "radio"}
              />
            ) : null}
            <div style={{ flex: 1 }}>
              <span className="sr-only" id={`answer-label-${choice.id}`} lang={locale}>
                {t("delivery.builder.answer", { number: index + 1 })}
              </span>
              <input
                aria-labelledby={`answer-label-${choice.id}`}
                aria-invalid={!choice.label.trim()}
                className="input"
                disabled={question.type === "true_false"}
                lang=""
                maxLength={180}
                onChange={(event) =>
                  onUpdateChoiceQuestion((item) => ({
                    ...item,
                    choices: item.choices.map((candidate) =>
                      candidate.id === choice.id
                        ? { ...candidate, label: event.target.value }
                        : candidate,
                    ),
                  }))
                }
                value={choice.label}
              />
              {question.type !== "poll" ? (
                <div lang="en-CA">
                  <BetaDisclosure
                    className="choice-diagnostics"
                    enabled={uxBeta}
                    summary="Diagnostic rationale and feedback"
                  >
                    <div className="toolbar" style={{ marginTop: 8 }}>
                      <span
                        className="sr-only"
                        id={`misconception-label-${choice.id}`}
                        lang="en-CA"
                      >
                        Misconception tag for choice {index + 1}
                      </span>
                      <input
                        aria-labelledby={`misconception-label-${choice.id}`}
                        className="input"
                        lang={choice.misconceptionKey ? "" : "en-CA"}
                        maxLength={64}
                        onChange={(event) =>
                          onUpdateChoiceQuestion((item) => ({
                            ...item,
                            choices: item.choices.map((candidate) =>
                              candidate.id === choice.id
                                ? {
                                    ...candidate,
                                    misconceptionKey: event.target.value || null,
                                  }
                                : candidate,
                            ),
                          }))
                        }
                        placeholder="Misconception tag, such as unit-confusion"
                        value={choice.misconceptionKey ?? ""}
                      />
                      <span className="sr-only" id={`feedback-label-${choice.id}`} lang="en-CA">
                        Why someone might choose choice {index + 1}
                      </span>
                      <input
                        aria-labelledby={`feedback-label-${choice.id}`}
                        className="input"
                        lang={choice.feedback ? "" : "en-CA"}
                        maxLength={500}
                        onChange={(event) =>
                          onUpdateChoiceQuestion((item) => ({
                            ...item,
                            choices: item.choices.map((candidate) =>
                              candidate.id === choice.id
                                ? { ...candidate, feedback: event.target.value }
                                : candidate,
                            ),
                          }))
                        }
                        placeholder="Why might someone choose this?"
                        value={choice.feedback ?? ""}
                      />
                    </div>
                  </BetaDisclosure>
                </div>
              ) : null}
            </div>
            {question.type !== "true_false" && question.choices.length > 2 ? (
              <button
                className="danger-link"
                onClick={() =>
                  onStructuralChange(
                    {
                      ...question,
                      choices: question.choices.filter((candidate) => candidate.id !== choice.id),
                    },
                    "Choice removed.",
                  )
                }
                type="button"
              >
                {t("delivery.common.delete")}
              </button>
            ) : null}
          </div>
        ))}
      </fieldset>
      {question.type !== "true_false" && question.choices.length < 6 ? (
        <button
          className="button-quiet small-button"
          onClick={() =>
            onUpdateChoiceQuestion((item) => ({
              ...item,
              choices: [...item.choices, { id: clientUuid(), label: "", isCorrect: false }],
            }))
          }
          type="button"
        >
          {t("delivery.builder.addAnswer")}
        </button>
      ) : null}
    </>
  );
}

export function ResponseEditor({
  question,
  uxBeta,
  onStructuralChange,
  onUpdateChoiceQuestion,
  onUpdateQuestion,
}: {
  question: QuestionDraft;
  uxBeta: boolean;
  onStructuralChange: QuestionStructuralChange;
  onUpdateChoiceQuestion: ChoiceQuestionUpdater;
  onUpdateQuestion: QuestionUpdater;
}) {
  const { t } = useLocale();
  if (isChoiceQuestion(question)) {
    return (
      <ChoiceResponseEditor
        onStructuralChange={onStructuralChange}
        onUpdateChoiceQuestion={onUpdateChoiceQuestion}
        question={question}
        uxBeta={uxBeta}
      />
    );
  }

  if (question.type === "numeric") {
    return (
      <div className="toolbar">
        <label className="field" style={{ flex: "1 1 180px" }}>
          <span>{t("delivery.builder.correctValue")}</span>
          <input
            className="input"
            inputMode="decimal"
            lang=""
            onChange={(event) =>
              onUpdateQuestion((item) =>
                item.type === "numeric" ? { ...item, correctValue: event.target.value } : item,
              )
            }
            value={question.correctValue}
          />
        </label>
        <label className="field" style={{ flex: "1 1 180px" }}>
          <span lang="en-CA">Absolute tolerance</span>
          <input
            className="input"
            inputMode="decimal"
            lang=""
            onChange={(event) =>
              onUpdateQuestion((item) =>
                item.type === "numeric" ? { ...item, tolerance: event.target.value } : item,
              )
            }
            value={question.tolerance}
          />
        </label>
        <label className="field" style={{ flex: "1 1 180px" }}>
          <span lang="en-CA">Optional unit</span>
          <input
            className="input"
            lang=""
            maxLength={32}
            onChange={(event) =>
              onUpdateQuestion((item) =>
                item.type === "numeric" ? { ...item, unit: event.target.value || null } : item,
              )
            }
            value={question.unit ?? ""}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="toolbar">
      <label className="field" style={{ flex: "1 1 120px" }}>
        <span lang="en-CA">Minimum</span>
        <select
          className="select"
          onChange={(event) =>
            onUpdateQuestion((item) =>
              item.type === "rating" ? { ...item, min: Number(event.target.value) } : item,
            )
          }
          value={question.min}
        >
          {[1, 2, 3, 4].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className="field" style={{ flex: "1 1 120px" }}>
        <span lang="en-CA">Maximum</span>
        <select
          className="select"
          onChange={(event) =>
            onUpdateQuestion((item) =>
              item.type === "rating" ? { ...item, max: Number(event.target.value) } : item,
            )
          }
          value={question.max}
        >
          {[5, 6, 7, 8, 9, 10].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className="field" style={{ flex: "1 1 180px" }}>
        <span lang="en-CA">Minimum label</span>
        <input
          className="input"
          lang=""
          onChange={(event) =>
            onUpdateQuestion((item) =>
              item.type === "rating" ? { ...item, minLabel: event.target.value } : item,
            )
          }
          value={question.minLabel}
        />
      </label>
      <label className="field" style={{ flex: "1 1 180px" }}>
        <span lang="en-CA">Maximum label</span>
        <input
          className="input"
          lang=""
          onChange={(event) =>
            onUpdateQuestion((item) =>
              item.type === "rating" ? { ...item, maxLabel: event.target.value } : item,
            )
          }
          value={question.maxLabel}
        />
      </label>
    </div>
  );
}
