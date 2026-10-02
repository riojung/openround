import { describe, expect, it } from "vitest";
import type { QuizDraft } from "@openround/contracts";
import {
  matchesLatestHealthDraft,
  matchesSavedHealthDraft,
  mayAdoptHealthDraft,
} from "./question-health-draft-sync";

const saved: QuizDraft = { title: "Saved Round", description: "", questions: [] };
const edited: QuizDraft = { ...saved, title: "Unsaved local edit" };

describe("Question Health editor synchronization", () => {
  it("requires both the exact saved local content and expected server revision", () => {
    const savedJson = JSON.stringify(saved);
    expect(matchesSavedHealthDraft(saved, savedJson, 7, 7)).toBe(true);
    expect(matchesSavedHealthDraft(edited, savedJson, 7, 7)).toBe(false);
    expect(matchesSavedHealthDraft(saved, savedJson, 8, 7)).toBe(false);
  });

  it("preserves local edits made while the server mutation was in flight", () => {
    expect(mayAdoptHealthDraft(saved, JSON.stringify(saved))).toBe(true);
    expect(mayAdoptHealthDraft(edited, JSON.stringify(saved))).toBe(false);
  });

  it("rejects a historical mutation receipt after another editor advances the draft", () => {
    expect(
      matchesLatestHealthDraft(
        { draft: saved, draftRevision: 3 },
        { draft: saved, draftRevision: 3 },
      ),
    ).toBe(true);
    expect(
      matchesLatestHealthDraft(
        { draft: saved, draftRevision: 3 },
        { draft: edited, draftRevision: 4 },
      ),
    ).toBe(false);
  });
});
