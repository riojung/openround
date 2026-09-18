import { describe, expect, it } from "vitest";
import type { QuizDraft } from "@openround/contracts";
import { editorControllerReducer, initialEditorControllerState } from "./editor-controller";

function draft(): QuizDraft {
  return {
    title: "Recovery Round",
    description: "",
    questions: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        type: "numeric",
        prompt: "How many?",
        purpose: "diagnostic",
        confidence: "off",
        delivery: "main",
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        correctValue: "4",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 20,
        basePoints: 1_000,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
}

describe("editor reducer/controller", () => {
  it("loads a draft and selects its stable first question ID", () => {
    const source = draft();
    const state = editorControllerReducer(initialEditorControllerState, {
      type: "load",
      draft: source,
    });
    expect(state.draft).toBe(source);
    expect(state.selectedQuestionId).toBe(source.questions[0]?.id);
  });

  it("applies functional draft edits through the serialized editor state", () => {
    const loaded = editorControllerReducer(initialEditorControllerState, {
      type: "load",
      draft: draft(),
    });
    const changed = editorControllerReducer(loaded, {
      type: "draft",
      value: (current) => (current ? { ...current, title: "Changed" } : current),
    });
    expect(changed.draft?.title).toBe("Changed");
    expect(changed.selectedQuestionId).toBe(loaded.selectedQuestionId);
  });

  it("restores exactly one structural snapshot and clears the undo slot", () => {
    const original = draft();
    const changed = { ...original, questions: [] };
    const state = {
      ...initialEditorControllerState,
      draft: changed,
      selectedQuestionId: null,
      structuralUndo: {
        draft: original,
        selectedQuestionId: original.questions[0]!.id,
        message: "Question deleted.",
      },
    };
    const restored = editorControllerReducer(state, { type: "undo" });
    expect(restored.draft).toBe(original);
    expect(restored.selectedQuestionId).toBe(original.questions[0]?.id);
    expect(restored.structuralUndo).toBeNull();
  });

  it("invalidates a structural undo snapshot after a later draft edit", () => {
    const original = draft();
    const structurallyChanged = { ...original, questions: [] };
    const stateWithUndo = editorControllerReducer(
      {
        ...initialEditorControllerState,
        draft: original,
        selectedQuestionId: original.questions[0]!.id,
      },
      {
        type: "structural_change",
        draft: structurallyChanged,
        selectedQuestionId: null,
        undo: {
          draft: original,
          selectedQuestionId: original.questions[0]!.id,
          message: "Question deleted.",
        },
      },
    );

    const edited = editorControllerReducer(stateWithUndo, {
      type: "draft",
      value: (current) => (current ? { ...current, title: "Edited after delete" } : current),
    });
    const undoAttempt = editorControllerReducer(edited, { type: "undo" });

    expect(edited.structuralUndo).toBeNull();
    expect(undoAttempt.draft?.title).toBe("Edited after delete");
    expect(undoAttempt.draft?.questions).toEqual([]);
  });
});
