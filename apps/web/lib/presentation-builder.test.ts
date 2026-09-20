import { describe, expect, it } from "vitest";
import {
  changePresentationQuestionType,
  createContentBlock,
  createPresentationQuestion,
  createQuestionBlock,
  duplicatePresentationBlock,
  movePresentationBlock,
  presentationReadiness,
  removePresentationBlock,
} from "./presentation-builder";
import type { PresentationDraft } from "@openround/contracts";

function draft(): PresentationDraft {
  const content = createContentBlock();
  content.title = "Welcome";
  const question = createQuestionBlock();
  if (question.kind === "question") {
    question.question.prompt = "Which signal matters?";
    if ("choices" in question.question) {
      question.question.choices = question.question.choices.slice(0, 2).map((choice, index) => ({
        ...choice,
        label: index === 0 ? "Evidence" : "Volume",
        isCorrect: index === 0,
      }));
    }
  }
  return {
    title: "Facilitator deck",
    description: "",
    experiencePreset: { id: "focus", version: 1 },
    schemaVersion: 1,
    blocks: [content, question],
  };
}

describe("presentation builder model", () => {
  it("creates response-specific defaults without conflating opinion and diagnostic blocks", () => {
    const poll = createPresentationQuestion("poll");
    const numeric = createPresentationQuestion("numeric");
    const rating = createPresentationQuestion("rating");

    expect(poll).toMatchObject({ purpose: "opinion", basePoints: 0, confidence: "off" });
    expect("choices" in poll && poll.choices).toHaveLength(4);
    expect(numeric).toMatchObject({
      purpose: "diagnostic",
      basePoints: 1_000,
      correctValue: "",
      tolerance: "0",
    });
    expect(rating).toMatchObject({ purpose: "opinion", basePoints: 0, min: 1, max: 5 });
  });

  it("reports a publish-ready structured deck", () => {
    expect(presentationReadiness(draft())).toEqual([]);
  });

  it("returns actionable readiness issues for an incomplete or inaccessible deck", () => {
    const content = createContentBlock("media");
    content.mediaId = "media-1";
    const question = createQuestionBlock("numeric");
    question.question.mediaId = "media-2";
    const incomplete: PresentationDraft = {
      title: "",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 1,
      blocks: [content, question],
    };

    expect(presentationReadiness(incomplete).map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        "Give this presentation a title.",
        "Add alternative text for the slide image.",
        "Write the question prompt.",
        "Enter the correct numeric value.",
        "Add alternative text for the question image.",
      ]),
    );
  });

  it("moves and removes blocks without mutating the source", () => {
    const source = draft();
    const second = source.blocks[1]!;
    const moved = movePresentationBlock(source, second.id, -1);
    expect(moved.blocks[0]?.id).toBe(second.id);
    expect(source.blocks[0]?.id).not.toBe(second.id);
    expect(removePresentationBlock(moved, second.id).blocks).toHaveLength(1);
  });

  it("treats invalid and boundary moves as stable no-ops", () => {
    const source = draft();
    expect(movePresentationBlock(source, source.blocks[0]!.id, -1)).toBe(source);
    expect(movePresentationBlock(source, "missing-block", 1)).toBe(source);
    expect(movePresentationBlock(source, source.blocks.at(-1)!.id, 1)).toBe(source);
  });

  it("clears a diagnostic link when its recheck block is removed", () => {
    const main = createQuestionBlock();
    const recheck = createQuestionBlock();
    main.question.linkedRecheckQuestionId = recheck.question.id;
    recheck.question.delivery = "recheck";
    const source: PresentationDraft = {
      title: "Recovery pair",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 1,
      blocks: [main, recheck],
    };

    const updated = removePresentationBlock(source, recheck.id);
    expect(updated.blocks).toHaveLength(1);
    expect(updated.blocks[0]?.kind).toBe("question");
    if (updated.blocks[0]?.kind === "question") {
      expect(updated.blocks[0].question.linkedRecheckQuestionId).toBeNull();
    }
    expect(main.question.linkedRecheckQuestionId).toBe(recheck.question.id);
  });

  it("duplicates questions with independent IDs", () => {
    const source = draft().blocks[1]!;
    const copy = duplicatePresentationBlock(source);
    expect(copy.id).not.toBe(source.id);
    if (source.kind === "question" && copy.kind === "question") {
      expect(copy.question.id).not.toBe(source.question.id);
      if ("choices" in source.question && "choices" in copy.question) {
        expect(copy.question.choices[0]?.id).not.toBe(source.question.choices[0]?.id);
      }
      expect(copy.question.linkedRecheckQuestionId).toBeNull();
    }
  });

  it("duplicates content without sharing its block identity", () => {
    const source = createContentBlock("callout");
    source.title = "Remember";
    source.body = "Use the evidence before choosing an intervention.";
    const copy = duplicatePresentationBlock(source);

    expect(copy).toEqual({ ...source, id: expect.any(String) });
    expect(copy.id).not.toBe(source.id);
  });

  it("preserves question identity when changing response type", () => {
    const source = draft();
    const question = source.blocks.find((block) => block.kind === "question");
    expect(question?.kind).toBe("question");
    if (question?.kind !== "question") return;

    const updated = changePresentationQuestionType(source, question.id, "numeric");
    const changed = updated.blocks.find((block) => block.id === question.id);
    expect(changed?.kind).toBe("question");
    if (changed?.kind === "question") {
      expect(changed.question.id).toBe(question.question.id);
      expect(changed.question.type).toBe("numeric");
    }
  });

  it("clears inbound recovery links when a recheck becomes an opinion question", () => {
    const main = createQuestionBlock();
    const recheck = createQuestionBlock();
    main.question.linkedRecheckQuestionId = recheck.question.id;
    recheck.question.delivery = "recheck";
    const source: PresentationDraft = {
      title: "Recovery pair",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 1,
      blocks: [main, recheck],
    };

    const updated = changePresentationQuestionType(source, recheck.id, "poll");
    const updatedMain = updated.blocks[0];
    const updatedRecheck = updated.blocks[1];
    expect(updatedMain?.kind).toBe("question");
    expect(updatedRecheck?.kind).toBe("question");
    if (updatedMain?.kind === "question" && updatedRecheck?.kind === "question") {
      expect(updatedMain.question.linkedRecheckQuestionId).toBeNull();
      expect(updatedRecheck.question.id).toBe(recheck.question.id);
      expect(updatedRecheck.question.delivery).toBe("main");
      expect(updatedRecheck.question.linkedRecheckQuestionId).toBeNull();
    }
    expect(main.question.linkedRecheckQuestionId).toBe(recheck.question.id);
  });

  it("promotes a detached recheck when its diagnostic becomes an opinion question", () => {
    const main = createQuestionBlock();
    const recheck = createQuestionBlock();
    main.question.linkedRecheckQuestionId = recheck.question.id;
    recheck.question.delivery = "recheck";
    const source: PresentationDraft = {
      title: "Recovery pair",
      description: "",
      experiencePreset: { id: "focus", version: 1 },
      schemaVersion: 1,
      blocks: [main, recheck],
    };

    const updated = changePresentationQuestionType(source, main.id, "rating");
    const updatedMain = updated.blocks[0];
    const updatedRecheck = updated.blocks[1];
    expect(updatedMain?.kind).toBe("question");
    expect(updatedRecheck?.kind).toBe("question");
    if (updatedMain?.kind === "question" && updatedRecheck?.kind === "question") {
      expect(updatedMain.question.id).toBe(main.question.id);
      expect(updatedMain.question.linkedRecheckQuestionId).toBeNull();
      expect(updatedRecheck.question.delivery).toBe("main");
    }
  });

  it("rejects a recovery link that does not target a recheck", () => {
    const source = draft();
    const questions = source.blocks.filter((block) => block.kind === "question");
    const main = questions[0];
    expect(main?.kind).toBe("question");
    if (main?.kind !== "question") return;
    main.question.linkedRecheckQuestionId = main.question.id;

    expect(presentationReadiness(source)).toContainEqual({
      blockId: main.id,
      field: "linkedRecheckQuestionId",
      message: "Choose a valid recheck question.",
    });
  });
});
