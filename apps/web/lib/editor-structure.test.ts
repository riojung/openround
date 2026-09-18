import { describe, expect, it } from "vitest";
import type { QuestionDraft, QuizDraft } from "@openround/contracts";
import { moveQuestionById, removeQuestionById } from "./editor-structure";

function question(id: string, linkedRecheckQuestionId: string | null = null): QuestionDraft {
  return {
    id,
    type: "single_select",
    prompt: id,
    purpose: "diagnostic",
    confidence: "off",
    delivery: linkedRecheckQuestionId ? "main" : "recheck",
    conceptKeys: ["concept"],
    linkedRecheckQuestionId,
    timeLimitSeconds: 20,
    basePoints: 1_000,
    explanation: "",
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: `${id}-a`, label: "A", isCorrect: true },
      { id: `${id}-b`, label: "B", isCorrect: false },
    ],
  };
}

function draft(): QuizDraft {
  return {
    title: "Round",
    description: "",
    questions: [question("main", "recheck"), question("recheck"), question("other")],
  };
}

describe("editor structural controller", () => {
  it("moves by stable ID without changing the selected identity", () => {
    const moved = moveQuestionById(draft(), "recheck", 1);
    expect(moved.questions.map((item) => item.id)).toEqual(["main", "other", "recheck"]);
    expect(moved.questions.find((item) => item.id === "main")?.linkedRecheckQuestionId).toBe(
      "recheck",
    );
  });

  it("clears a link when its recheck is deleted", () => {
    const removed = removeQuestionById(draft(), "recheck");
    expect(removed.questions.map((item) => item.id)).toEqual(["main", "other"]);
    expect(removed.questions[0]?.linkedRecheckQuestionId).toBeNull();
  });

  it("returns the same draft for an illegal move", () => {
    const source = draft();
    expect(moveQuestionById(source, "main", -1)).toBe(source);
  });
});
