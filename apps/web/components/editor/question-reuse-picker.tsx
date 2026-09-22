"use client";

import { useMemo, useState } from "react";
import {
  findQuestionReuseSources,
  normalizeQuestionReuseSelections,
  questionReuseBatchCapacity,
  type QuestionReuseSelection,
  type QuestionReuseSource,
} from "../../lib/question-reuse";
import type { QuestionType } from "@openround/contracts";
import { useLocale } from "../locale-provider";

export interface QuestionReusePickerProps {
  sources: QuestionReuseSource[];
  currentQuestionCount: number;
  maximumQuestionCount?: number;
  onCancel: () => void;
  onReuse: (selections: QuestionReuseSelection[]) => void;
}

export function QuestionReusePicker({
  sources,
  currentQuestionCount,
  maximumQuestionCount = 200,
  onCancel,
  onReuse,
}: QuestionReusePickerProps) {
  const { t } = useLocale();
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

  function questionCount(count: number) {
    return t(
      count === 1 ? "delivery.builder.questionCount.one" : "delivery.builder.questionCount.other",
      { count },
    );
  }

  function responseLabel(type: QuestionType) {
    return t(`delivery.builder.type.${type}`);
  }

  function localizedCapacityMessage() {
    const { includedQuestionCount, maximumQuestionCount, pairedRecheckCount } = capacity;
    if (capacity.remainingQuestionCount === 0) {
      return t("delivery.reuse.capacity.limit", {
        maximumQuestions: questionCount(maximumQuestionCount),
      });
    }
    const remainingSlots = t(
      capacity.remainingQuestionCount === 1
        ? "delivery.reuse.questionSlot.one"
        : "delivery.reuse.questionSlot.other",
      { count: capacity.remainingQuestionCount },
    );
    if (includedQuestionCount === 0) {
      return t("delivery.reuse.capacity.available", { remainingSlots });
    }
    if (!capacity.fits) {
      return t("delivery.reuse.capacity.overflow", {
        included: includedQuestionCount,
        remainingSlots,
      });
    }
    const selectedQuestions = t(
      capacity.selectedMainQuestionCount === 1
        ? "delivery.reuse.selectedQuestion.one"
        : "delivery.reuse.selectedQuestion.other",
      { count: capacity.selectedMainQuestionCount },
    );
    const pairedRechecks = t(
      pairedRecheckCount === 1
        ? "delivery.reuse.pairedRecheck.one"
        : "delivery.reuse.pairedRecheck.other",
      { count: pairedRecheckCount },
    );
    const slotsAfter = t(
      capacity.remainingAfterReuse === 1 ? "delivery.reuse.slot.one" : "delivery.reuse.slot.other",
      { count: capacity.remainingAfterReuse },
    );
    return t("delivery.reuse.capacity.fits", {
      includedQuestions: questionCount(includedQuestionCount),
      selectedQuestions,
      pairedRechecks,
      remainingSlots: slotsAfter,
    });
  }

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
          <p className="eyebrow">{t("delivery.reuse.privateBank")}</p>
          <h2 id="question-reuse-heading">{t("delivery.reuse.title")}</h2>
          <p className="muted">{t("delivery.reuse.description")}</p>
        </div>
        <button className="button-quiet small-button" onClick={onCancel} type="button">
          {t("delivery.reuse.cancel")}
        </button>
      </div>

      <label className="field">
        <span>{t("delivery.reuse.search")}</span>
        <input
          className="input"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("delivery.reuse.searchPlaceholder")}
          type="search"
          value={query}
        />
      </label>

      {matches.length === 0 ? (
        <p className="notice">{t("delivery.reuse.empty")}</p>
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
                  {source.title ? (
                    <span lang="">{source.title}</span>
                  ) : (
                    t("delivery.reuse.untitledRound")
                  )}{" "}
                  · {questionCount(candidates.length)}
                </summary>
                <fieldset className="field">
                  <legend className="muted">{t("delivery.reuse.chooseMain")}</legend>
                  {candidates.map(({ mainQuestion, linkedRecheck, includedQuestionCount }) => (
                    <label className="question-tab" key={mainQuestion.id}>
                      <input
                        checked={selected.has(mainQuestion.id)}
                        onChange={() => toggleQuestion(source.id, mainQuestion.id)}
                        type="checkbox"
                      />
                      <span>
                        <strong>
                          {mainQuestion.prompt ? (
                            <span lang="">{mainQuestion.prompt}</span>
                          ) : (
                            t("delivery.builder.untitledQuestion")
                          )}
                        </strong>
                        <span className="muted">
                          {responseLabel(mainQuestion.type)}
                          {mainQuestion.conceptKeys?.length ? (
                            <span lang=""> · {mainQuestion.conceptKeys.join(", ")}</span>
                          ) : (
                            ""
                          )}
                        </span>
                        {linkedRecheck ? (
                          <span className="muted" lang={linkedRecheck.prompt ? "" : undefined}>
                            {t("delivery.reuse.includesPaired", {
                              question: linkedRecheck.prompt || t("delivery.reuse.untitledRecheck"),
                              questionCount: questionCount(includedQuestionCount),
                            })}
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
          {localizedCapacityMessage()}
        </p>
        <button
          className="button small-button"
          disabled={!capacity.fits}
          onClick={reuseSelection}
          type="button"
        >
          {capacity.includedQuestionCount > 0
            ? t("delivery.reuse.addQuestions", {
                questions: questionCount(capacity.includedQuestionCount),
              })
            : t("delivery.reuse.chooseQuestions")}
        </button>
      </div>
    </section>
  );
}
