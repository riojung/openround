import type { QuestionDraft } from "@openround/contracts";
import type { QuestionUpdater } from "./types";

export function DeliveryScoring({
  question,
  onUpdateQuestion,
}: {
  question: QuestionDraft;
  onUpdateQuestion: QuestionUpdater;
}) {
  return (
    <>
      <div className="toolbar" style={{ marginTop: 22 }}>
        <label className="field" style={{ flex: "1 1 180px", marginBottom: 0 }}>
          <span>Time limit</span>
          <select
            className="select"
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                timeLimitSeconds: Number(event.target.value),
              }))
            }
            value={question.timeLimitSeconds}
          >
            {[5, 10, 20, 30, 60, 90, 120, 300].map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds} seconds
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ flex: "1 1 180px", marginBottom: 0 }}>
          <span>Base points</span>
          <select
            className="select"
            disabled={question.type === "poll" || question.type === "rating"}
            onChange={(event) =>
              onUpdateQuestion((item) => ({
                ...item,
                basePoints: Number(event.target.value),
              }))
            }
            value={question.basePoints}
          >
            {[0, 500, 1000, 2000].map((points) => (
              <option key={points} value={points}>
                {points}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field" style={{ marginTop: 22 }}>
        <label htmlFor="explanation">Explanation after reveal</label>
        <textarea
          className="textarea"
          id="explanation"
          maxLength={1000}
          onChange={(event) =>
            onUpdateQuestion((item) => ({ ...item, explanation: event.target.value }))
          }
          value={question.explanation}
        />
      </div>
    </>
  );
}
