"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { QuestionType, RoundCategory } from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";
import { useLocale } from "../locale-provider";
import { formatNumber, pluralCategory } from "../../lib/i18n/format";
import type { MessageKey } from "../../lib/i18n/catalog";
import { useWorkspace } from "./workspace-provider";
import { prioritizeStartersForSegment } from "./workspace-model";
import type { StarterSummary } from "./workspace-types";
import styles from "./workspace-content.module.css";
import { recordAuthoringEvent, recordCreationEvent } from "./product-events";

const categoryKeys: Record<RoundCategory, MessageKey> = {
  general: "category.general",
  education: "category.education",
  business: "category.business",
  technical: "category.technical",
  safety_compliance: "category.safety_compliance",
  icebreaker: "category.icebreaker",
};

const questionTypeLabelKeys: Record<QuestionType, MessageKey> = {
  single_select: "questionType.single_select.label",
  true_false: "questionType.true_false.label",
  multi_select: "questionType.multi_select.label",
  numeric: "questionType.numeric.label",
  rating: "questionType.rating.label",
  poll: "questionType.poll.label",
};

export function StarterGallery({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const { creator, canEdit } = useWorkspace();
  const [starters, setStarters] = useState<StarterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");

  const refresh = useCallback(async () => {
    setLoadError("");
    setLoading(true);
    try {
      const response = await apiFetch<{ starters: StarterSummary[] }>("/v1/starters");
      setStarters(response.starters);
    } catch (caught) {
      setLoadError(humanError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function useStarter(starter: StarterSummary) {
    setBusyId(starter.id);
    setActionError("");
    recordCreationEvent("creation_started", "starter", "round");
    try {
      const response = await apiFetch<{ quiz: { id: string } }>(`/v1/starters/${starter.id}/use`, {
        method: "POST",
        body: "{}",
      });
      recordCreationEvent("creation_completed", "starter", "round");
      if (starter.questionCount > 0) recordAuthoringEvent("first_block_created", "round");
      router.push(`/quiz/${response.quiz.id}`);
    } catch (caught) {
      setActionError(humanError(caught));
      setBusyId("");
    }
  }

  if (loading)
    return (
      <p className={styles.muted} lang={locale} role="status">
        {t("starter.loading")}
      </p>
    );

  const orderedStarters = prioritizeStartersForSegment(starters, creator?.segment);

  return (
    <div lang={locale}>
      {loadError ? (
        <div>
          <p className="error" lang="en-CA" role="alert">
            {loadError}
          </p>
          <button
            className="button-quiet small-button"
            onClick={() => void refresh()}
            type="button"
          >
            {t("starter.retry")}
          </button>
        </div>
      ) : null}
      {actionError ? (
        <p className="error" lang="en-CA" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className={compact ? styles.starterGridCompact : styles.starterGrid}>
        {orderedStarters.map((starter) => {
          const recommended = starter.segment === "all" || starter.segment === creator?.segment;
          return (
            <article className={styles.starterCard} key={starter.id}>
              <div className={styles.cardTopline}>
                <span className={styles.category}>{t(categoryKeys[starter.category])}</span>
                {recommended ? (
                  <span className={styles.recommended}>{t("starter.recommended")}</span>
                ) : null}
              </div>
              <h3 lang="en-CA">{starter.title}</h3>
              <p lang="en-CA">{starter.description}</p>
              <div className={styles.metaLine}>
                <span>
                  {t(
                    pluralCategory(locale, starter.questionCount) === "one"
                      ? "starter.questionCount.one"
                      : "starter.questionCount.other",
                    { count: formatNumber(locale, starter.questionCount) },
                  )}
                </span>
                <span>
                  {starter.responseTypes.map((type) => t(questionTypeLabelKeys[type])).join(" · ")}
                </span>
              </div>
              {canEdit ? (
                <button
                  className="button small-button"
                  disabled={Boolean(busyId)}
                  onClick={() => void useStarter(starter)}
                  type="button"
                >
                  {busyId === starter.id ? t("starter.creating") : t("starter.use")}
                </button>
              ) : (
                <p className={styles.readOnlyNote}>{t("starter.readOnly")}</p>
              )}
            </article>
          );
        })}
      </div>
      {!starters.length && !loadError ? (
        <div className={styles.emptyState}>
          <h3>{t("starter.emptyTitle")}</h3>
          <p>{t("starter.emptyDescription")}</p>
        </div>
      ) : null}
    </div>
  );
}
