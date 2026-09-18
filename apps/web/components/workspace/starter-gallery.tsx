"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, humanError } from "../../lib/api";
import { useWorkspace } from "./workspace-provider";
import { responseTypeLabel } from "./workspace-model";
import type { StarterSummary } from "./workspace-types";
import styles from "./workspace-content.module.css";
import { recordCreationEvent } from "./product-events";

export function StarterGallery({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { creator, canEdit } = useWorkspace();
  const [starters, setStarters] = useState<StarterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await apiFetch<{ starters: StarterSummary[] }>("/v1/starters");
      setStarters(response.starters);
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function useStarter(starter: StarterSummary) {
    setBusyId(starter.id);
    setError("");
    recordCreationEvent("creation_started", "starter");
    try {
      const response = await apiFetch<{ quiz: { id: string } }>(`/v1/starters/${starter.id}/use`, {
        method: "POST",
        body: "{}",
      });
      recordCreationEvent("creation_completed", "starter");
      router.push(`/quiz/${response.quiz.id}`);
    } catch (caught) {
      setError(humanError(caught));
      setBusyId("");
    }
  }

  if (loading) return <p className={styles.muted}>Loading starters…</p>;

  return (
    <>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className={compact ? styles.starterGridCompact : styles.starterGrid}>
        {starters.map((starter) => {
          const recommended = starter.segment === "all" || starter.segment === creator?.segment;
          return (
            <article className={styles.starterCard} key={starter.id}>
              <div className={styles.cardTopline}>
                <span className={styles.category}>{starter.category.replaceAll("_", " ")}</span>
                {recommended ? <span className={styles.recommended}>Good fit</span> : null}
              </div>
              <h3>{starter.title}</h3>
              <p>{starter.description}</p>
              <div className={styles.metaLine}>
                <span>
                  {starter.questionCount} question{starter.questionCount === 1 ? "" : "s"}
                </span>
                <span>{starter.responseTypes.map(responseTypeLabel).join(" · ")}</span>
              </div>
              {canEdit ? (
                <button
                  className="button small-button"
                  disabled={Boolean(busyId)}
                  onClick={() => void useStarter(starter)}
                  type="button"
                >
                  {busyId === starter.id ? "Creating…" : "Use this starter"}
                </button>
              ) : (
                <p className={styles.readOnlyNote}>Viewers can browse starters.</p>
              )}
            </article>
          );
        })}
      </div>
      {!starters.length && !error ? (
        <div className={styles.emptyState}>
          <h3>No starters are available yet</h3>
          <p>The starter library will appear here when it is enabled for this workspace.</p>
        </div>
      ) : null}
    </>
  );
}
