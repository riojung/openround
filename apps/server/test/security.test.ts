import { describe, expect, it } from "vitest";
import { cleanPlainText } from "../src/security.js";

describe("plain-text sanitization", () => {
  it("removes markup and invisible direction/control characters", () => {
    expect(cleanPlainText("<b>Hello</b>\u202Etxt.exe\u2066\u0000 world", 500)).toBe(
      "Hellotxt.exe world",
    );
  });

  it("normalizes whitespace and enforces the stored length", () => {
    expect(cleanPlainText("  one\n\t two   three  ", 11)).toBe("one two thr");
  });
});
