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

  it("restores a snapshot and makes it available to redo", () => {
    const original = draft();
    const changed = { ...original, questions: [] };
    const state = {
      ...initialEditorControllerState,
      draft: changed,
      selectedQuestionId: null,
      undoStack: [
        {
          draft: original,
          selectedQuestionId: original.questions[0]!.id,
          message: "Question deleted.",
        },
      ],
    };
    const restored = editorControllerReducer(state, { type: "undo" });
    expect(restored.draft).toBe(original);
    expect(restored.selectedQuestionId).toBe(original.questions[0]?.id);
    expect(restored.undoStack).toEqual([]);
    expect(restored.redoStack).toHaveLength(1);

    const redone = editorControllerReducer(restored, { type: "redo" });
    expect(redone.draft).toBe(changed);
    expect(redone.selectedQuestionId).toBeNull();
  });

  it("records later draft edits in bounded history and clears redo", () => {
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
    expect(edited.undoStack).toHaveLength(2);
    expect(edited.redoStack).toEqual([]);

    const undoEdit = editorControllerReducer(edited, { type: "undo" });
    expect(undoEdit.draft?.title).toBe("Recovery Round");
    expect(undoEdit.draft?.questions).toEqual([]);

    const undoDelete = editorControllerReducer(undoEdit, { type: "undo" });
    expect(undoDelete.draft).toBe(original);
  });

  it("coalesces a burst of text edits into one undo step", () => {
    const loaded = editorControllerReducer(initialEditorControllerState, {
      type: "load",
      draft: draft(),
    });
    const firstEdit = editorControllerReducer(loaded, {
      type: "draft",
      occurredAt: 1_000,
      value: (current) => (current ? { ...current, title: "R" } : current),
    });
    const secondEdit = editorControllerReducer(firstEdit, {
      type: "draft",
      occurredAt: 1_500,
      value: (current) => (current ? { ...current, title: "Ro" } : current),
    });

    expect(secondEdit.undoStack).toHaveLength(1);
    expect(secondEdit.draft?.title).toBe("Ro");
    expect(editorControllerReducer(secondEdit, { type: "undo" }).draft?.title).toBe(
      "Recovery Round",
    );
  });

  it("starts a new undo step after the coalescing window", () => {
    const loaded = editorControllerReducer(initialEditorControllerState, {
      type: "load",
      draft: draft(),
    });
    const firstEdit = editorControllerReducer(loaded, {
      type: "draft",
      occurredAt: 1_000,
      value: (current) => (current ? { ...current, title: "First" } : current),
    });
    const secondEdit = editorControllerReducer(firstEdit, {
      type: "draft",
      occurredAt: 2_000,
      value: (current) => (current ? { ...current, title: "Second" } : current),
    });

    expect(secondEdit.undoStack).toHaveLength(2);
    expect(editorControllerReducer(secondEdit, { type: "undo" }).draft?.title).toBe("First");
  });
});
