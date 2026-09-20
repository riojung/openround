import { describe, expect, it } from "vitest";
import {
  participantProgressStage,
  participantRevealState,
  participantResponseControlsDisabled,
  participantResponseView,
} from "./participant-response";
import type { SessionSnapshot } from "@openround/contracts";

describe("participantResponseView", () => {
  it("rehydrates a durable choice receipt after reconnect", () => {
    expect(participantResponseView({ kind: "choice", choiceIds: ["choice-b"] }, 3, null)).toEqual({
      saved: true,
      choiceIds: ["choice-b"],
      numericValue: "",
      ratingValue: null,
      confidence: 3,
    });
  });

  it("uses an accepted acknowledgement until a snapshot arrives", () => {
    const view = participantResponseView(
      null,
      null,
      {
        accepted: true,
        duplicate: false,
      },
      {
        response: { kind: "numeric", value: "42", unit: "kg" },
        confidence: 3,
      },
    );
    expect(view).toMatchObject({ saved: true, numericValue: "42", confidence: 3 });
  });

  it("prefers the durable server response over the local acknowledgement receipt", () => {
    const view = participantResponseView(
      { kind: "rating", value: 4 },
      null,
      { accepted: true, duplicate: false },
      { response: { kind: "rating", value: 2 }, confidence: 3 },
    );
    expect(view).toMatchObject({ ratingValue: 4, confidence: null });
  });

  it("does not treat a rejected acknowledgement as saved", () => {
    const view = participantResponseView(
      undefined,
      undefined,
      {
        accepted: false,
        duplicate: false,
        code: "ANSWER_LATE",
      },
      { response: { kind: "rating", value: 5 }, confidence: null },
    );
    expect(view).toMatchObject({ saved: false, ratingValue: null });
  });

  it("locks every response control while a submission is pending", () => {
    expect(
      participantResponseControlsDisabled({
        questionOpen: true,
        saved: false,
        submitting: true,
      }),
    ).toBe(true);
    expect(
      participantResponseControlsDisabled({
        questionOpen: true,
        saved: false,
        submitting: false,
      }),
    ).toBe(false);
  });

  it("keeps response controls locked after a durable response is rehydrated", () => {
    expect(
      participantResponseControlsDisabled({
        questionOpen: true,
        saved: true,
        submitting: false,
      }),
    ).toBe(true);
  });
});

describe("participantRevealState", () => {
  it("keeps post-reveal intervention feedback visible without an answer key", () => {
    expect(participantRevealState({ answerRevealed: true, myCorrect: false }, true)).toEqual({
      revealed: true,
      selectedCorrect: false,
      selectedIncorrect: true,
    });
  });

  it("does not expose a result during a pre-reveal intervention", () => {
    expect(participantRevealState({ answerRevealed: false, myCorrect: undefined }, true)).toEqual({
      revealed: false,
      selectedCorrect: false,
      selectedIncorrect: false,
    });
  });

  it("marks only the learner's selected response from their own correct result", () => {
    expect(participantRevealState({ answerRevealed: true, myCorrect: true }, true)).toMatchObject({
      selectedCorrect: true,
      selectedIncorrect: false,
    });
    expect(participantRevealState({ answerRevealed: true, myCorrect: true }, false)).toMatchObject({
      selectedCorrect: false,
      selectedIncorrect: false,
    });
  });
});

describe("participantProgressStage", () => {
  const stage = (
    phase: SessionSnapshot["phase"],
    roundKind: SessionSnapshot["roundKind"] = "main",
    saved = false,
  ) => participantProgressStage({ phase, roundKind } as SessionSnapshot, saved);

  it("maps the live recovery journey to compact participant stages", () => {
    expect(stage("lobby")).toBe("waiting");
    expect(stage("question_open")).toBe("answering");
    expect(stage("question_open", "main", true)).toBe("saved");
    expect(stage("intervention")).toBe("discussing");
    expect(stage("question_reveal")).toBe("reviewing");
    expect(stage("question_open", "linked_recheck")).toBe("rechecking");
    expect(stage("finished")).toBe("complete");
  });
});
