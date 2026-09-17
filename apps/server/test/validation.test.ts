import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QuizContentSchema } from "@openround/contracts";
import { validationIssueMessage } from "../src/validation.js";

describe("validation issue messages", () => {
  it("identifies the question and field that need attention", () => {
    const result = QuizContentSchema.safeParse({
      title: "A draft",
      description: "",
      questions: [
        {
          id: randomUUID(),
          type: "single_select",
          prompt: "",
          choices: [
            { id: randomUUID(), label: "", isCorrect: true },
            { id: randomUUID(), label: "Complete", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(validationIssueMessage(result.error.issues[0]!)).toBe(
        "Question 1: Enter the question text",
      );
      expect(validationIssueMessage(result.error.issues[1]!)).toBe(
        "Question 1, answer 1: Enter an answer",
      );
    }
  });
});
