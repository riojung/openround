import { describe, expect, it } from "vitest";
import {
  participantResponseControlsDisabled,
  participantResponseView,
} from "./participant-response";

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
