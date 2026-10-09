import { describe, expect, it } from "vitest";
import {
  addCompanionQuickCheckChoice,
  createCompanionQuickCheckDraft,
  removeCompanionQuickCheckChoice,
  validateCompanionQuickCheckDraft,
} from "./presentation-companion-quick-check";

const draft = {
  prompt: "  Which approach should we discuss?  ",
  choices: ["  First approach  ", "Second   approach"],
  timeLimitSeconds: "30",
};

describe("Companion Quick Check form state and validation", () => {
  it("starts with two empty choices and a bounded default, independently for each form", () => {
    const first = createCompanionQuickCheckDraft();
    expect(first).toEqual({ prompt: "", choices: ["", ""], timeLimitSeconds: "30" });
    first.choices[0] = "edited";
    expect(createCompanionQuickCheckDraft().choices).toEqual(["", ""]);
  });

  it("trims accepted fields and preserves authored internal spacing without mutating the draft", () => {
    expect(validateCompanionQuickCheckDraft(draft)).toEqual({
      success: true,
      quickCheck: {
        prompt: "Which approach should we discuss?",
        choices: ["First approach", "Second   approach"],
        timeLimitSeconds: 30,
      },
    });
    expect(draft.choices[0]).toBe("  First approach  ");
  });

  it.each(["", "   ", "x".repeat(501)])("rejects an invalid prompt", (prompt) => {
    expect(validateCompanionQuickCheckDraft({ ...draft, prompt })).toMatchObject({
      success: false,
      field: "prompt",
      messageKey: "live.companion.quickCheck.promptInvalid",
    });
  });

  it.each([
    ["one"],
    ["one", ""],
    ["one", "   "],
    ["one", "x".repeat(181)],
    ["one", "two", "three", "four", "five", "six", "seven"],
  ])("rejects an invalid choice list", (...choices) => {
    expect(validateCompanionQuickCheckDraft({ ...draft, choices })).toMatchObject({
      success: false,
      field: "choices",
      messageKey: "live.companion.quickCheck.choicesInvalid",
    });
  });

  it.each([
    ["First Approach", "first approach"],
    ["First   Approach", " first\tapproach "],
    ["Ａ", "a"],
  ])("rejects canonically duplicate choices", (...choices) => {
    expect(validateCompanionQuickCheckDraft({ ...draft, choices })).toMatchObject({
      success: false,
      field: "choices",
      messageKey: "live.companion.quickCheck.choicesDuplicate",
    });
  });

  it.each(["", "9", "301", "10.5", "not a number"])(
    "rejects an invalid response time of %s",
    (timeLimitSeconds) => {
      expect(validateCompanionQuickCheckDraft({ ...draft, timeLimitSeconds })).toMatchObject({
        success: false,
        field: "timeLimitSeconds",
        messageKey: "live.companion.quickCheck.timeInvalid",
      });
    },
  );

  it.each(["10", "300"])("accepts the time boundary %s", (timeLimitSeconds) => {
    expect(validateCompanionQuickCheckDraft({ ...draft, timeLimitSeconds }).success).toBe(true);
  });

  it("bounds add/remove controls and keeps prompt, timer, and other choice text intact", () => {
    let current = { ...draft, choices: ["one", "two"] };
    expect(removeCompanionQuickCheckChoice(current, 0)).toBe(current);
    for (let index = 0; index < 4; index++) current = addCompanionQuickCheckChoice(current);
    expect(current.choices).toHaveLength(6);
    expect(addCompanionQuickCheckChoice(current)).toBe(current);
    expect(removeCompanionQuickCheckChoice(current, -1)).toBe(current);
    expect(removeCompanionQuickCheckChoice(current, 6)).toBe(current);
    expect(removeCompanionQuickCheckChoice(current, 1.5)).toBe(current);
    expect(removeCompanionQuickCheckChoice(current, 1)).toEqual({
      ...draft,
      choices: ["one", "", "", "", ""],
    });
    expect(current.choices[1]).toBe("two");
  });
});
