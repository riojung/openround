import type { QuestionType, QuizDraft } from "@openround/contracts";
import { editorTypeLabel, responseTypeGuidance } from "./question-labels";
import styles from "./round-builder.module.css";

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
  collapsed = false,
  issueQuestionIds = new Set<string>(),
  onAddQuestion,
  onDeleteQuestion,
  onDuplicateQuestion,
  onInsertTypeChange,
  onMoveQuestion,
  onOpenQuestionReuse,
  onSelectQuestion,
  onToggleCollapsed,
  questionReuseOpen,
}: {
  draft: QuizDraft;
  insertType: QuestionType;
  selectedQuestionId: string | null;
  uxBeta: boolean;
  canReuseQuestions?: boolean;
  collapsed?: boolean;
  issueQuestionIds?: ReadonlySet<string>;
  onAddQuestion: (type: QuestionType) => void;
  onDeleteQuestion?: (questionId: string) => void;
  onDuplicateQuestion?: (questionId: string) => void;
  onInsertTypeChange: (type: QuestionType) => void;
  onMoveQuestion?: (questionId: string, direction: -1 | 1) => void;
  onOpenQuestionReuse?: () => void;
  onSelectQuestion: (questionId: string) => void;
  onToggleCollapsed?: () => void;
  questionReuseOpen?: boolean;
}) {
  const terminology = uxBeta ? "question" : "checkpoint";

  if (!uxBeta) {
    return (
      <aside className="panel">
        <h2 style={{ fontSize: "1.4rem" }}>Checkpoints</h2>
        <div className="question-list">
          {draft.questions.map((item, index) => (
            <button
              aria-current={item.id === selectedQuestionId}
              className="question-tab"
              key={item.id}
              onClick={() => onSelectQuestion(item.id)}
              type="button"
            >
              <strong>{index + 1}.</strong> {item.prompt || "Untitled checkpoint"}
              {(item.delivery ?? "main") === "recheck" ? " · recheck" : ""}
            </button>
          ))}
        </div>
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
      </aside>
    );
  }

  return (
    <aside className={styles.questionMap} data-collapsed={collapsed} aria-label="Question map">
      <div className={styles.mapHeader}>
        <div>
          <h2 className={collapsed ? "sr-only" : undefined}>
            {uxBeta ? "Questions" : "Checkpoints"}
          </h2>
          {!collapsed ? (
            <span className={styles.mapCount}>
              {draft.questions.length}{" "}
              {draft.questions.length === 1 ? terminology : `${terminology}s`}
            </span>
          ) : null}
        </div>
        {onToggleCollapsed ? (
          <button
            aria-label={collapsed ? "Expand question map" : "Collapse question map"}
            className={styles.iconButton}
            onClick={onToggleCollapsed}
            title={collapsed ? "Expand question map" : "Collapse question map"}
            type="button"
          >
            {collapsed ? "›" : "‹"}
          </button>
        ) : null}
      </div>

      {collapsed ? (
        <div className={styles.collapsedList}>
          {draft.questions.map((item, index) => (
            <button
              aria-current={item.id === selectedQuestionId}
              aria-label={`${uxBeta ? "Question" : "Checkpoint"} ${index + 1}: ${item.prompt || `Untitled ${terminology}`}`}
              className={styles.collapsedQuestion}
              data-issue={issueQuestionIds.has(item.id)}
              key={item.id}
              onClick={() => onSelectQuestion(item.id)}
              title={item.prompt || `Untitled ${terminology}`}
              type="button"
            >
              {index + 1}
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.mapList}>
          {draft.questions.map((item, index) => {
            const hasIssue = issueQuestionIds.has(item.id);
            const active = item.id === selectedQuestionId;
            return (
              <article className={styles.mapItem} data-active={active} key={item.id}>
                <button
                  aria-current={active}
                  className={styles.mapSelect}
                  onClick={() => onSelectQuestion(item.id)}
                  type="button"
                >
                  <span className={styles.mapNumber}>{index + 1}</span>
                  <span className={styles.mapCopy}>
                    <strong>{item.prompt || `Untitled ${terminology}`}</strong>
                    <small>
                      {editorTypeLabel(item.type, uxBeta)}
                      {(item.delivery ?? "main") === "recheck" ? " · recheck" : ""}
                    </small>
                  </span>
                  <span
                    aria-label={hasIssue ? "Needs attention" : "Ready"}
                    className={styles.mapStatus}
                    data-issue={hasIssue}
                    role="img"
                  />
                </button>
                {onMoveQuestion || onDuplicateQuestion || onDeleteQuestion ? (
                  <div
                    className={styles.mapActions}
                    aria-label={`${terminology} ${index + 1} actions`}
                    role="group"
                  >
                    {onMoveQuestion ? (
                      <>
                        <button
                          aria-label={`Move ${terminology} ${index + 1} up`}
                          className={styles.mapAction}
                          disabled={index === 0}
                          onClick={() => onMoveQuestion(item.id, -1)}
                          title="Move up"
                          type="button"
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`Move ${terminology} ${index + 1} down`}
                          className={styles.mapAction}
                          disabled={index === draft.questions.length - 1}
                          onClick={() => onMoveQuestion(item.id, 1)}
                          title="Move down"
                          type="button"
                        >
                          ↓
                        </button>
                      </>
                    ) : null}
                    {onDuplicateQuestion ? (
                      <button
                        className={styles.mapAction}
                        onClick={() => onDuplicateQuestion(item.id)}
                        type="button"
                      >
                        Duplicate
                      </button>
                    ) : null}
                    {onDeleteQuestion ? (
                      <button
                        className={`${styles.mapAction} ${styles.mapActionDanger}`}
                        onClick={() => onDeleteQuestion(item.id)}
                        type="button"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      {!collapsed ? (
        <div className={styles.mapInsert}>
          <label className="field" htmlFor="insert-question-type">
            <span>Add a question</span>
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
      ) : null}
    </aside>
  );
}
