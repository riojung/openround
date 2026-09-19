import type { QuestionDraft } from "@openround/contracts";
import { isChoiceQuestion } from "./types";

export function ParticipantPreview({ question }: { question: QuestionDraft }) {
  return (
    <div className="participant-preview" aria-label="Participant preview">
      <p className="eyebrow">Participant view</p>
      <h3>{question.prompt || "Your question will appear here"}</h3>
      {isChoiceQuestion(question) ? (
        <div className="preview-options">
          {question.choices.map((choice, index) => (
            <span className="preview-option" key={choice.id}>
              {choice.label || `Choice ${index + 1}`}
            </span>
          ))}
        </div>
      ) : question.type === "numeric" ? (
        <input className="input" disabled placeholder="Enter a number" />
      ) : (
        <div className="preview-options">
          {Array.from({ length: question.max - question.min + 1 }, (_, index) => (
            <span className="preview-rating" key={question.min + index}>
              {question.min + index}
            </span>
          ))}
        </div>
      )}
      {question.confidence !== "off" && question.type !== "poll" && question.type !== "rating" ? (
        <p className="muted">Confidence will be requested before Submit.</p>
      ) : null}
      <button className="button" disabled type="button">
        Submit answer
      </button>
    </div>
  );
}
