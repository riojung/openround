"use client";

import { useCallback, useReducer, type Dispatch, type SetStateAction } from "react";
import type { QuestionType, QuizDraft } from "@openround/contracts";

export interface StructuralUndo {
  draft: QuizDraft;
  selectedQuestionId: string | null;
  message: string;
}

export interface EditorControllerState {
  draft: QuizDraft | null;
  selectedQuestionId: string | null;
  insertType: QuestionType;
  undoStack: StructuralUndo[];
  redoStack: StructuralUndo[];
  lastDraftEditAt: number | null;
  lastDraftEditQuestionId: string | null;
}

const HISTORY_LIMIT = 30;
const TEXT_EDIT_COALESCE_MS = 750;

export const initialEditorControllerState: EditorControllerState = {
  draft: null,
  selectedQuestionId: null,
  insertType: "single_select",
  undoStack: [],
  redoStack: [],
  lastDraftEditAt: null,
  lastDraftEditQuestionId: null,
};

type EditorControllerAction =
  | { type: "load"; draft: QuizDraft }
  | { type: "draft"; value: SetStateAction<QuizDraft | null>; occurredAt?: number }
  | { type: "select"; value: string | null }
  | { type: "insert_type"; value: QuestionType }
  | {
      type: "structural_change";
      draft: QuizDraft;
      selectedQuestionId: string | null;
      undo: StructuralUndo;
    }
  | { type: "undo" }
  | { type: "redo" };

function appendHistory(history: StructuralUndo[], snapshot: StructuralUndo) {
  return [...history, snapshot].slice(-HISTORY_LIMIT);
}

export function editorControllerReducer(
  state: EditorControllerState,
  action: EditorControllerAction,
): EditorControllerState {
  switch (action.type) {
    case "load":
      return {
        ...state,
        draft: action.draft,
        selectedQuestionId: action.draft.questions[0]?.id ?? null,
        undoStack: [],
        redoStack: [],
        lastDraftEditAt: null,
        lastDraftEditQuestionId: null,
      };
    case "draft": {
      const nextDraft =
        typeof action.value === "function" ? action.value(state.draft) : action.value;
      if (!state.draft || !nextDraft || nextDraft === state.draft) {
        return { ...state, draft: nextDraft };
      }
      const occurredAt = action.occurredAt ?? Date.now();
      const coalescesWithPreviousEdit =
        state.lastDraftEditAt !== null &&
        occurredAt - state.lastDraftEditAt <= TEXT_EDIT_COALESCE_MS &&
        state.lastDraftEditQuestionId === state.selectedQuestionId;
      return {
        ...state,
        draft: nextDraft,
        undoStack: coalescesWithPreviousEdit
          ? state.undoStack
          : appendHistory(state.undoStack, {
              draft: state.draft,
              selectedQuestionId: state.selectedQuestionId,
              message: "Draft edited.",
            }),
        redoStack: [],
        lastDraftEditAt: occurredAt,
        lastDraftEditQuestionId: state.selectedQuestionId,
      };
    }
    case "select":
      return {
        ...state,
        selectedQuestionId: action.value,
        lastDraftEditAt: null,
        lastDraftEditQuestionId: null,
      };
    case "insert_type":
      return { ...state, insertType: action.value };
    case "structural_change":
      return {
        ...state,
        draft: action.draft,
        selectedQuestionId: action.selectedQuestionId,
        undoStack: appendHistory(state.undoStack, action.undo),
        redoStack: [],
        lastDraftEditAt: null,
        lastDraftEditQuestionId: null,
      };
    case "undo": {
      const previous = state.undoStack.at(-1);
      if (!previous || !state.draft) return state;
      return {
        ...state,
        draft: previous.draft,
        selectedQuestionId: previous.selectedQuestionId,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: appendHistory(state.redoStack, {
          draft: state.draft,
          selectedQuestionId: state.selectedQuestionId,
          message: previous.message,
        }),
        lastDraftEditAt: null,
        lastDraftEditQuestionId: null,
      };
    }
    case "redo": {
      const next = state.redoStack.at(-1);
      if (!next || !state.draft) return state;
      return {
        ...state,
        draft: next.draft,
        selectedQuestionId: next.selectedQuestionId,
        undoStack: appendHistory(state.undoStack, {
          draft: state.draft,
          selectedQuestionId: state.selectedQuestionId,
          message: next.message,
        }),
        redoStack: state.redoStack.slice(0, -1),
        lastDraftEditAt: null,
        lastDraftEditQuestionId: null,
      };
    }
  }
}

export function useEditorController() {
  const [state, dispatch] = useReducer(editorControllerReducer, initialEditorControllerState);
  const loadDraft = useCallback((draft: QuizDraft) => dispatch({ type: "load", draft }), []);
  const setDraft = useCallback<Dispatch<SetStateAction<QuizDraft | null>>>(
    (value) => dispatch({ type: "draft", value, occurredAt: Date.now() }),
    [],
  );
  const setSelectedQuestionId = useCallback<Dispatch<SetStateAction<string | null>>>(
    (value) =>
      dispatch({
        type: "select",
        value: typeof value === "function" ? value(state.selectedQuestionId) : value,
      }),
    [state.selectedQuestionId],
  );
  const setInsertType = useCallback<Dispatch<SetStateAction<QuestionType>>>(
    (value) =>
      dispatch({
        type: "insert_type",
        value: typeof value === "function" ? value(state.insertType) : value,
      }),
    [state.insertType],
  );
  const applyStructuralChange = useCallback(
    (draft: QuizDraft, selectedQuestionId: string | null, undo: StructuralUndo) =>
      dispatch({ type: "structural_change", draft, selectedQuestionId, undo }),
    [],
  );
  const undoStructuralChange = useCallback(() => dispatch({ type: "undo" }), []);
  const redoStructuralChange = useCallback(() => dispatch({ type: "redo" }), []);

  return {
    ...state,
    structuralUndo: state.undoStack.at(-1) ?? null,
    structuralRedo: state.redoStack.at(-1) ?? null,
    loadDraft,
    setDraft,
    setSelectedQuestionId,
    setInsertType,
    applyStructuralChange,
    undoStructuralChange,
    redoStructuralChange,
  };
}
