"use client";

import { useMemo, useState } from "react";
import {
  findQuestionReuseSources,
  normalizeQuestionReuseSelections,
  questionReuseBatchCapacity,
  type QuestionReuseSelection,
  type QuestionReuseSource,
} from "../../lib/question-reuse";
import { responseTypeLabel } from "./question-labels";

export interface QuestionReusePickerProps {
  sources: QuestionReuseSource[];
  currentQuestionCount: number;
  maximumQuestionCount?: number;
  onCancel: () => void;
  onReuse: (selections: QuestionReuseSelection[]) => void;
}

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function QuestionReusePicker({
  sources,
  currentQuestionCount,
  maximumQuestionCount = 200,
  onCancel,
  onReuse,
}: QuestionReusePickerProps) {
  const [query, setQuery] = useState("");
  const [selectedBySource, setSelectedBySource] = useState<ReadonlyMap<string, readonly string[]>>(
    new Map(),
  );
  const matches = useMemo(() => findQuestionReuseSources(sources, query), [query, sources]);
  const selections = useMemo(
    () =>
      normalizeQuestionReuseSelections(
        sources,
        [...selectedBySource].map(([sourceQuizId, selectedMainQuestionIds]) => ({
          sourceQuizId,
          selectedMainQuestionIds: [...selectedMainQuestionIds],
        })),
      ),
    [selectedBySource, sources],
  );
  const capacity = questionReuseBatchCapacity(
    sources,
    selections,
    currentQuestionCount,
    maximumQuestionCount,
  );

  function toggleQuestion(sourceQuizId: string, questionId: string) {
    setSelectedBySource((current) => {
      const next = new Map(current);
      const selected = new Set(current.get(sourceQuizId) ?? []);
      if (selected.has(questionId)) selected.delete(questionId);
      else selected.add(questionId);
      if (selected.size === 0) next.delete(sourceQuizId);
      else next.set(sourceQuizId, [...selected]);
      return next;
    });
  }

  function reuseSelection() {
    if (!capacity.fits) return;
    onReuse(selections);
    setSelectedBySource(new Map());
  }

  return (
    <section
      aria-labelledby="question-reuse-heading"
      className="panel question-reuse-picker"
      data-testid="question-reuse-picker"
      id="private-question-bank"
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">Private question bank</p>
          <h2 id="question-reuse-heading">Reuse from your workspace</h2>
          <p className="muted">
            Add independent copies from another Round. Later edits to the source will not sync.
          </p>
        </div>
        <button className="button-quiet small-button" onClick={onCancel} type="button">
          Cancel reuse
        </button>
      </div>

      <label className="field">
        <span>Search workspace questions</span>
        <input
          className="input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Round title, prompt, response type, or concept"
          type="search"
          value={query}
        />
      </label>

      {matches.length === 0 ? (
        <p className="notice">No reusable main questions match your search.</p>
      ) : (
        <div className="question-reuse-sources">
          {matches.map(({ source, candidates }) => {
            const selected = new Set(selectedBySource.get(source.id) ?? []);
            return (
              <details
                className="editor-disclosure"
                key={source.id}
                open={matches.length === 1 || query.trim().length > 0 || selected.size > 0}
              >
                <summary>
                  {source.title || "Untitled Round"} · {countLabel(candidates.length, "question")}
                </summary>
                <fieldset className="field">
                  <legend className="muted">Choose main questions to copy</legend>
                  {candidates.map(({ mainQuestion, linkedRecheck, includedQuestionCount }) => (
                    <label className="question-tab" key={mainQuestion.id}>
                      <input
                        checked={selected.has(mainQuestion.id)}
                        onChange={() => toggleQuestion(source.id, mainQuestion.id)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{mainQuestion.prompt || "Untitled question"}</strong>
                        <span className="muted">
                          {responseTypeLabel(mainQuestion.type)}
                          {mainQuestion.conceptKeys?.length
                            ? ` · ${mainQuestion.conceptKeys.join(", ")}`
                            : ""}
                        </span>
                        {linkedRecheck ? (
                          <span className="muted">
                            Includes paired recheck: {linkedRecheck.prompt || "Untitled recheck"} ·{" "}
                            {countLabel(includedQuestionCount, "question")} total
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </details>
            );
          })}
        </div>
      )}

      <div className="button-row" style={{ justifyContent: "space-between", marginTop: 16 }}>
        <p aria-live="polite" className={capacity.fits ? "muted" : "notice"} role="status">
          {capacity.message}
        </p>
        <button
          className="button small-button"
          disabled={!capacity.fits}
          onClick={reuseSelection}
          type="button"
        >
          {capacity.includedQuestionCount > 0
            ? `Add ${countLabel(capacity.includedQuestionCount, "question")}`
            : "Choose questions"}
        </button>
      </div>
    </section>
  );
}
