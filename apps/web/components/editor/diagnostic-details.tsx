import type { QuestionDraft } from "@openround/contracts";
import { BetaDisclosure } from "./beta-disclosure";
import { responseTypeLabel } from "./question-labels";
import type { QuestionUpdater } from "./types";

export function DiagnosticDetails({
  question,
  questions,
  uxBeta,
  onUpdateQuestion,
}: {
  question: QuestionDraft;
  questions: QuestionDraft[];
  uxBeta: boolean;
  onUpdateQuestion: QuestionUpdater;
}) {
  return (
    <BetaDisclosure
      className="editor-disclosure"
      enabled={uxBeta}
      id="question-diagnostic-details"
      summary="Diagnostic details and recheck link"
    >
      <div className="toolbar">
        <label className="field" style={{ flex: "1 1 180px" }}>
          <span>Purpose</span>
          <select
            className="select"
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                purpose: event.target.value as "diagnostic" | "practice" | "opinion",
              }))
            }
            value={
              question.purpose ??
              (question.type === "poll" || question.type === "rating" ? "opinion" : "diagnostic")
            }
          >
            <option value="diagnostic">Diagnostic</option>
            <option value="practice">Practice</option>
            <option value="opinion">Opinion</option>
          </select>
        </label>
        <label className="field" style={{ flex: "1 1 180px" }}>
          <span>Confidence prompt</span>
          <select
            className="select"
            disabled={question.type === "poll" || question.type === "rating"}
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                confidence: event.target.value as "off" | "optional" | "required",
              }))
            }
            value={question.confidence ?? "off"}
          >
            <option value="off">Off</option>
            <option value="optional">Optional</option>
            <option value="required">Required</option>
          </select>
        </label>
        <label className="field" style={{ flex: "2 1 280px" }}>
          <span>Concept keys</span>
          <input
            className="input"
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                conceptKeys: event.target.value
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }))
            }
            placeholder="fractions, rate-vs-total"
            value={(question.conceptKeys ?? []).join(", ")}
          />
          <small className="muted">
            Comma-separated keys using letters, numbers, dots, dashes, or underscores.
          </small>
        </label>
      </div>
      {(question.delivery ?? "main") === "main" &&
      question.type !== "poll" &&
      question.type !== "rating" ? (
        <label className="field">
          <span>{uxBeta ? "Paired recheck question" : "Linked recheck"}</span>
          <select
            className="select"
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                linkedRecheckQuestionId: event.target.value || null,
              }))
            }
            value={question.linkedRecheckQuestionId ?? ""}
          >
            <option value="">{uxBeta ? "No paired recheck" : "No linked recheck"}</option>
            {questions
              .filter(
                (candidate) =>
                  candidate.id !== question.id && (candidate.delivery ?? "main") === "recheck",
              )
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.prompt || `Untitled ${responseTypeLabel(candidate.type)}`}
                </option>
              ))}
          </select>
        </label>
      ) : null}
    </BetaDisclosure>
  );
}
