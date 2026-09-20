import type { QuestionType, QuizDraft } from "@openround/contracts";
import { editorTypeLabel, responseTypeGuidance } from "./question-labels";

const QUESTION_TYPES: QuestionType[] = [
  "single_select",
  "true_false",
  "multi_select",
  "numeric",
  "rating",
  "poll",
];

export function QuestionNavigator({
  draft,
  insertType,
  selectedQuestionId,
  uxBeta,
  canReuseQuestions,
  onAddQuestion,
  onInsertTypeChange,
  onOpenQuestionReuse,
  onSelectQuestion,
  questionReuseOpen,
}: {
  draft: QuizDraft;
  insertType: QuestionType;
  selectedQuestionId: string | null;
  uxBeta: boolean;
  canReuseQuestions?: boolean;
  onAddQuestion: (type: QuestionType) => void;
  onInsertTypeChange: (type: QuestionType) => void;
  onOpenQuestionReuse?: () => void;
  onSelectQuestion: (questionId: string) => void;
  questionReuseOpen?: boolean;
}) {
  return (
    <aside className="panel">
      <h2 style={{ fontSize: "1.4rem" }}>{uxBeta ? "Questions" : "Checkpoints"}</h2>
      <div className="question-list">
        {draft.questions.map((item, index) => (
          <button
            aria-current={item.id === selectedQuestionId}
            className="question-tab"
            key={item.id}
            onClick={() => onSelectQuestion(item.id)}
            type="button"
          >
            <strong>{index + 1}.</strong>{" "}
            {item.prompt || (uxBeta ? "Untitled question" : "Untitled checkpoint")}
            {(item.delivery ?? "main") === "recheck" ? " · recheck" : ""}
          </button>
        ))}
      </div>
      {uxBeta ? (
        <div className="insert-menu" style={{ marginTop: 16 }}>
          <label className="field" htmlFor="insert-question-type">
            <span>Insert</span>
            <select
              aria-describedby="insert-question-guidance"
              className="select"
              id="insert-question-type"
              onChange={(event) => onInsertTypeChange(event.target.value as QuestionType)}
              value={insertType}
            >
              <option value="single_select">Single select</option>
              <option value="true_false">True or false</option>
              <option value="multi_select">Multiple select</option>
              <option value="numeric">Numeric response</option>
              <option value="rating">Rating</option>
              <option value="poll">Poll</option>
            </select>
          </label>
          <p className="muted" id="insert-question-guidance">
            {responseTypeGuidance[insertType]}
          </p>
          <button
            className="button small-button"
            onClick={() => onAddQuestion(insertType)}
            type="button"
          >
            Add question
          </button>
          {canReuseQuestions && onOpenQuestionReuse ? (
            <button
              aria-controls="private-question-bank"
              aria-expanded={Boolean(questionReuseOpen)}
              className="button-quiet small-button"
              id="open-private-question-bank"
              onClick={onOpenQuestionReuse}
              type="button"
            >
              Reuse from your workspace
            </button>
          ) : null}
        </div>
      ) : (
        <div className="button-row" style={{ marginTop: 16 }}>
          {QUESTION_TYPES.map((type) => (
            <button
              className="button-quiet small-button"
              key={type}
              onClick={() => onAddQuestion(type)}
              type="button"
            >
              {editorTypeLabel(type, false)}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
