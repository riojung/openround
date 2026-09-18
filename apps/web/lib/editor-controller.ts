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
  structuralUndo: StructuralUndo | null;
}

export const initialEditorControllerState: EditorControllerState = {
  draft: null,
  selectedQuestionId: null,
  insertType: "single_select",
  structuralUndo: null,
};

type EditorControllerAction =
  | { type: "load"; draft: QuizDraft }
  | { type: "draft"; value: SetStateAction<QuizDraft | null> }
  | { type: "select"; value: string | null }
  | { type: "insert_type"; value: QuestionType }
  | {
      type: "structural_change";
      draft: QuizDraft;
      selectedQuestionId: string | null;
      undo: StructuralUndo;
    }
  | { type: "undo" };

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
        structuralUndo: null,
      };
    case "draft":
      return {
        ...state,
        draft: typeof action.value === "function" ? action.value(state.draft) : action.value,
        structuralUndo: null,
      };
    case "select":
      return { ...state, selectedQuestionId: action.value };
    case "insert_type":
      return { ...state, insertType: action.value };
    case "structural_change":
      return {
        ...state,
        draft: action.draft,
        selectedQuestionId: action.selectedQuestionId,
        structuralUndo: action.undo,
      };
    case "undo":
      return state.structuralUndo
        ? {
            ...state,
            draft: state.structuralUndo.draft,
            selectedQuestionId: state.structuralUndo.selectedQuestionId,
            structuralUndo: null,
          }
        : state;
  }
}

export function useEditorController() {
  const [state, dispatch] = useReducer(editorControllerReducer, initialEditorControllerState);
  const loadDraft = useCallback((draft: QuizDraft) => dispatch({ type: "load", draft }), []);
  const setDraft = useCallback<Dispatch<SetStateAction<QuizDraft | null>>>(
    (value) => dispatch({ type: "draft", value }),
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

  return {
    ...state,
    loadDraft,
    setDraft,
    setSelectedQuestionId,
    setInsertType,
    applyStructuralChange,
    undoStructuralChange,
  };
}
