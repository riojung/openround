"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  WorkspaceProvider,
  useWorkspace,
} from "../../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../../components/workspace/workspace-shell";
import { PracticeLinkReceipt } from "../../../../components/practice/practice-link-receipt";
import styles from "../../../../components/practice/practice.module.css";
import { apiFetch, humanError } from "../../../../lib/api";
import { clientUuid } from "../../../../lib/uuid";
import {
  defaultPracticeWindow,
  localDateTimeValue,
  parsePersonalLabels,
  personalLabelsError,
  practicePersonalLinkLimit,
  type CreatedPractice,
  type PracticeTimeMode,
} from "../../../../lib/practice-assignment";
import {
  createPackPracticeCreation,
  packPracticeAccessSeed,
  packPracticeDates,
  packPracticeUnavailableReason,
  type PackPracticeCreationState,
  type PublishedPracticePack,
} from "../../../../lib/recovery-pack-practice";

function AssignPackPracticeContent({ packId }: { packId: string }) {
  const searchParams = useSearchParams();
  const expectedVersionId = searchParams.get("version");
  const { productFeatures, entitlements, canEdit } = useWorkspace();
  const [version, setVersion] = useState<PublishedPracticePack | null>(null);
  const [loading, setLoading] = useState(true);
  const [sourceConflict, setSourceConflict] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [title, setTitle] = useState("");
  const [timeMode, setTimeMode] = useState<PracticeTimeMode>("flex");
  const [opensLater, setOpensLater] = useState(false);
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [maxClosesAt, setMaxClosesAt] = useState("");
  const [minOpensAt, setMinOpensAt] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const [error, setError] = useState("");
  const [creation, setCreation] = useState<PackPracticeCreationState>({
    busy: false,
    pending: false,
    created: null,
  });
  const alive = useRef(true);
  const windowInitialized = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const recovery = useRef<ReturnType<typeof createPackPracticeCreation> | null>(null);
  if (!recovery.current) {
    recovery.current = createPackPracticeCreation({
      execute: (body) =>
        apiFetch<CreatedPractice>(
          `/v1/recovery-packs/${encodeURIComponent(packId)}/practice-assignments`,
          { method: "POST", body },
        ),
      onState: (state) => {
        if (alive.current) setCreation(state);
      },
    });
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setVersion(null);
    setError("");
    void apiFetch<{ pack: { id: string; currentVersionId: string | null } }>(
      `/v1/recovery-packs/${encodeURIComponent(packId)}`,
      { signal: abort.signal },
    )
      .then(async ({ pack }) => {
        if (!pack.currentVersionId) return null;
        if (!refresh && expectedVersionId && pack.currentVersionId !== expectedVersionId) {
          throw new Error(
            "The published Pack changed. Refresh the published source and review its delayed probe before creating practice.",
          );
        }
        const response = await apiFetch<{ version: PublishedPracticePack }>(
          `/v1/recovery-packs/versions/${encodeURIComponent(pack.currentVersionId)}`,
          { signal: abort.signal },
        );
        if (response.version.id !== pack.currentVersionId || response.version.packId !== packId)
          throw new Error(
            "The published Pack source does not match. Refresh and review the source again.",
          );
        return response.version;
      })
      .then((published) => {
        if (abort.signal.aborted) return;
        setVersion(published);
        setSourceConflict(false);
        setTitle(published ? `Delayed probe: ${published.content.title}`.slice(0, 160) : "");
      })
      .catch((caught) => {
        if (abort.signal.aborted) return;
        setSourceConflict(true);
        setError(humanError(caught));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [expectedVersionId, packId, refresh]);

  useEffect(() => {
    if (!entitlements || windowInitialized.current) return;
    const now = new Date();
    const defaults = defaultPracticeWindow(now, entitlements.reportRetentionDays);
    setClosesAt(defaults.closesAt);
    setMaxClosesAt(defaults.maxClosesAt);
    setMinOpensAt(localDateTimeValue(now));
    setOpensAt(localDateTimeValue(new Date(now.getTime() + 60 * 60_000)));
    windowInitialized.current = true;
  }, [entitlements]);

  const unavailable = packPracticeUnavailableReason({
    version,
    recoveryPacksEnabled: productFeatures?.recoveryPacks === true,
    practiceAssignmentsEnabled: productFeatures?.practiceAssignments === true,
    canEdit,
    followups: entitlements?.followups === true,
  });
  const personalLabels = parsePersonalLabels(labelsText);
  const labelLimit = practicePersonalLinkLimit(entitlements);
  const labelError = personalLabelsError(personalLabels, labelLimit);
  const locked = creation.busy || creation.pending;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!version || unavailable || labelError || sourceConflict || locked || !maxClosesAt) return;
    setError("");
    try {
      const dates = packPracticeDates({ opensLater, opensAt, closesAt, maxClosesAt });
      await recovery.current!.run(() => ({
        sourcePackVersionId: version.id,
        mutationId: clientUuid(),
        accessSeed: packPracticeAccessSeed(),
        ...(title.trim() ? { title: title.trim() } : {}),
        timeMode,
        ...dates,
        personalLabels,
      }));
    } catch (caught) {
      reportError(caught);
    }
  }

  function reportError(caught: unknown) {
    if (!alive.current) return;
    if ((caught as { status?: number }).status === 409) setSourceConflict(true);
    setError(humanError(caught));
    window.requestAnimationFrame(() => errorRef.current?.focus());
  }

  async function retry() {
    setError("");
    try {
      await recovery.current!.retry();
    } catch (caught) {
      reportError(caught);
    }
  }

  return (
    <WorkspaceShell
      title="Assign delayed-probe practice"
      eyebrow="Recovery Packs"
      requireBeta={false}
      description="One standalone delayed probe from a frozen published Recovery Pack version."
      actions={
        <Link className="button-quiet" href="/recovery-packs">
          Back to Recovery Packs
        </Link>
      }
    >
      <div lang="en-CA">
        {creation.created ? (
          <PracticeLinkReceipt created={creation.created} />
        ) : (
          <>
            <p className="notice">
              This assignment contains only the Pack’s delayed probe. It is not full Pack recovery
              or a delayed recovery trail, and does not include the diagnostic, intervention cards,
              or recheck.
            </p>
            {error ? (
              <p className="error" role="alert" ref={errorRef} tabIndex={-1}>
                {error}
              </p>
            ) : null}
            <p className={creation.pending ? "notice" : "sr-only"} aria-live="polite" role="status">
              {creation.busy
                ? "Creating or recovering the same practice assignment…"
                : creation.pending
                  ? "Creation was not acknowledged. Keep this page open and retry the same private request to recover its result. Settings stay locked; no new assignment is created by changing settings."
                  : ""}
            </p>
            {creation.pending ? (
              <button
                className="button"
                disabled={creation.busy}
                onClick={() => void retry()}
                type="button"
              >
                Retry assignment acknowledgement
              </button>
            ) : null}
            {loading ? <p role="status">Loading the published delayed probe…</p> : null}
            {!loading && unavailable ? <p className="notice">{unavailable}</p> : null}
            {sourceConflict && !locked ? (
              <button
                className="button-quiet"
                onClick={() => setRefresh((value) => value + 1)}
                type="button"
              >
                Refresh published Pack
              </button>
            ) : null}
            {!loading && version ? (
              <div className={styles.stack}>
                <section
                  className={styles.sourceCard}
                  aria-labelledby="pack-practice-source-heading"
                >
                  <p className="eyebrow">
                    Frozen published Recovery Pack · version {version.version}
                  </p>
                  <h2 id="pack-practice-source-heading">{version.content.title}</h2>
                  <p>Published {new Date(version.publishedAt).toLocaleString("en-CA")}.</p>
                  {version.content.delayedProbe ? (
                    <p>{version.content.delayedProbe.prompt}</p>
                  ) : null}
                  <p>
                    Only this published delayed probe is copied. Draft edits and future Pack changes
                    do not update the assignment.
                  </p>
                </section>
                {!unavailable && !sourceConflict ? (
                  <form className={styles.formCard} onSubmit={create}>
                    <fieldset disabled={locked} style={{ border: 0, margin: 0, padding: 0 }}>
                      <legend>
                        <h2>Practice settings</h2>
                      </legend>
                      <div className={styles.fields}>
                        <label
                          className={`field ${styles.fullField}`}
                          htmlFor="pack-practice-title"
                        >
                          <span>Practice title</span>
                          <input
                            className="input"
                            id="pack-practice-title"
                            maxLength={160}
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                          />
                        </label>
                        <fieldset
                          className={styles.fullField}
                          style={{ border: 0, margin: 0, padding: 0 }}
                        >
                          <legend className="field-label">Participant pacing</legend>
                          <div className={styles.optionGrid}>
                            <label className={styles.option}>
                              <input
                                name="pack-practice-time"
                                checked={timeMode === "flex"}
                                onChange={() => setTimeMode("flex")}
                                type="radio"
                              />
                              <span>
                                <strong>Time-flex</strong>No countdown. Participants respond at
                                their own pace.
                              </span>
                            </label>
                            <label className={styles.option}>
                              <input
                                name="pack-practice-time"
                                checked={timeMode === "timed"}
                                onChange={() => setTimeMode("timed")}
                                type="radio"
                              />
                              <span>
                                <strong>Use the published timer</strong>The server enforces the
                                delayed probe’s published time limit.
                              </span>
                            </label>
                          </div>
                        </fieldset>
                        <fieldset
                          className={styles.fullField}
                          style={{ border: 0, margin: 0, padding: 0 }}
                        >
                          <legend className="field-label">Open practice</legend>
                          <div className={styles.optionGrid}>
                            <label className={styles.option}>
                              <input
                                name="pack-practice-open"
                                checked={!opensLater}
                                onChange={() => setOpensLater(false)}
                                type="radio"
                              />
                              <span>
                                <strong>Now</strong>Participants can start once creation is
                                acknowledged.
                              </span>
                            </label>
                            <label className={styles.option}>
                              <input
                                name="pack-practice-open"
                                checked={opensLater}
                                onChange={() => setOpensLater(true)}
                                type="radio"
                              />
                              <span>
                                <strong>Schedule later</strong>Choose a future opening time.
                              </span>
                            </label>
                          </div>
                        </fieldset>
                        {opensLater ? (
                          <label className="field" htmlFor="pack-practice-opens">
                            <span>Open date and time</span>
                            <input
                              className="input"
                              id="pack-practice-opens"
                              type="datetime-local"
                              min={minOpensAt || undefined}
                              max={maxClosesAt || undefined}
                              required
                              value={opensAt}
                              onChange={(event) => setOpensAt(event.target.value)}
                            />
                          </label>
                        ) : null}
                        <label className="field" htmlFor="pack-practice-closes">
                          <span>Close date and time</span>
                          <input
                            className="input"
                            id="pack-practice-closes"
                            type="datetime-local"
                            min={(opensLater ? opensAt : minOpensAt) || undefined}
                            max={maxClosesAt || undefined}
                            required
                            value={closesAt}
                            onChange={(event) => setClosesAt(event.target.value)}
                          />
                        </label>
                      </div>
                      <details className={styles.disclosure}>
                        <summary>Create one-attempt personal links</summary>
                        <label className="field" htmlFor="pack-practice-labels">
                          <span>One personal link label per line</span>
                          <textarea
                            className="textarea"
                            id="pack-practice-labels"
                            rows={5}
                            aria-describedby="pack-practice-labels-help"
                            aria-invalid={Boolean(labelError)}
                            value={labelsText}
                            onChange={(event) => setLabelsText(event.target.value)}
                          />
                        </label>
                        <p className={styles.muted} id="pack-practice-labels-help">
                          Use non-sensitive labels. {personalLabels.length} of {labelLimit} personal
                          links. A generic anonymous link is also created.
                        </p>
                        {labelError ? (
                          <p className="error" role="alert">
                            {labelError}
                          </p>
                        ) : null}
                      </details>
                      <div className={styles.formActions}>
                        <button
                          className="button"
                          disabled={Boolean(labelError) || !maxClosesAt}
                          type="submit"
                        >
                          {creation.busy ? "Creating…" : "Create delayed-probe practice"}
                        </button>
                      </div>
                    </fieldset>
                  </form>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

export default function AssignPackPracticePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <WorkspaceProvider>
      <AssignPackPracticeContent key={id} packId={id} />
    </WorkspaceProvider>
  );
}
