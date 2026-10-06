"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { type RecoveryPackContent, type RecoveryPackInsertion } from "@openround/contracts";
import { apiFetch, humanError } from "../../lib/api";
import styles from "./recovery-pack-insertion.module.css";

interface PublishedPack {
  id: string;
  title: string;
  currentVersionId: string | null;
}
interface PackVersion {
  id: string;
  version: number;
  content: RecoveryPackContent;
}

export function RecoveryPackPresentationReferences({
  insertions,
}: {
  insertions: readonly RecoveryPackInsertion[];
}) {
  if (!insertions.length) return null;
  return (
    <section
      aria-label="Recovery Pack facilitator references"
      className={styles.references}
      lang="en-CA"
    >
      {insertions.map((insertion) => {
        const content = insertion.updateBaseline?.content ?? insertion.originalContent;
        return (
          <details key={insertion.id}>
            <summary>
              Recovery Pack references: <span lang="">{content.title}</span> · version{" "}
              {insertion.updateBaseline?.packVersion ?? insertion.packVersion}
            </summary>
            <p>
              Frozen facilitator references from the accepted source baseline, initially copied at
              insertion. Checkpoint edits and source Pack changes do not update these cards until
              you accept an update. Presentation live card playback is not available yet.
            </p>
            {content.interventions.map((card) => (
              <section key={card.id}>
                <h2 lang="">{card.title}</h2>
                <p className={styles.plaintext} lang="">
                  {card.body}
                </p>
                {card.citations.length ? (
                  <ul aria-label="Card citations">
                    {card.citations.map((citation, index) => (
                      <li key={index} lang="">
                        {citation.sourceName}, {citation.locator}
                        {citation.excerpt ? ` — ${citation.excerpt}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
            {content.citations.length ? (
              <ul aria-label="Pack citations">
                {content.citations.map((citation, index) => (
                  <li key={index} lang="">
                    {citation.sourceName}, {citation.locator}
                  </li>
                ))}
              </ul>
            ) : null}
            <Link href="/recovery-packs">Open Recovery Pack library</Link>
          </details>
        );
      })}
    </section>
  );
}

export function RecoveryPackPresentationPicker({
  busy,
  error,
  retryVersionId,
  afterSelectedBlock,
  onInsert,
  onClose,
}: {
  busy: boolean;
  error: string;
  retryVersionId: string | null;
  afterSelectedBlock: boolean;
  onInsert: (versionId: string) => void;
  onClose: () => void;
}) {
  const [packs, setPacks] = useState<PublishedPack[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [version, setVersion] = useState<PackVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const abort = new AbortController();
    void apiFetch<{ packs: PublishedPack[] }>("/v1/recovery-packs", { signal: abort.signal })
      .then(({ packs: records }) => {
        if (abort.signal.aborted) return;
        const published = records.filter((pack) => pack.currentVersionId);
        setPacks(published);
        setSelectedId(published[0]?.id ?? "");
      })
      .catch((caught) => {
        if (!abort.signal.aborted) setLoadError(humanError(caught));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    setVersion(null);
    const id = packs.find((pack) => pack.id === selectedId)?.currentVersionId;
    if (!id) return;
    const abort = new AbortController();
    setLoadError("");
    void apiFetch<{ version: PackVersion }>(
      `/v1/recovery-packs/versions/${encodeURIComponent(id)}`,
      { signal: abort.signal },
    )
      .then(({ version: published }) => {
        if (!abort.signal.aborted && published.id === id) setVersion(published);
      })
      .catch((caught) => {
        if (!abort.signal.aborted) setLoadError(humanError(caught));
      });
    return () => abort.abort();
  }, [packs, selectedId]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !busy && !retryVersionId) {
      event.preventDefault();
      onClose();
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), [tabindex="0"]',
      ),
    ).filter((control) => control.offsetParent !== null);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      event.preventDefault();
      event.currentTarget.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialog.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={styles.backdrop}>
      <div
        ref={dialog}
        aria-labelledby="pack-presentation-insert-title"
        aria-modal="true"
        className={styles.dialog}
        lang="en-CA"
        onKeyDown={trapFocus}
        role="dialog"
        tabIndex={-1}
      >
        <h2 id="pack-presentation-insert-title">Insert a published Recovery Pack</h2>
        <p>
          Copy its diagnostic and linked recheck{" "}
          {afterSelectedBlock ? "after the selected block" : "at the end"}, with frozen facilitator
          cards and citations. The checkpoints remain editable copies. Cards are not audience slides
          or live playback.
        </p>
        {loading ? <p role="status">Loading published Packs…</p> : null}
        {!loading && !packs.length && !loadError ? (
          <p>No published Recovery Packs are available. Publish a Pack in the library first.</p>
        ) : null}
        {packs.length ? (
          <label className={styles.field}>
            <span>Published Recovery Pack</span>
            <select
              disabled={busy || Boolean(retryVersionId)}
              onChange={(event) => setSelectedId(event.target.value)}
              value={selectedId}
            >
              {packs.map((pack) => (
                <option key={pack.id} lang="" value={pack.id}>
                  {pack.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {version ? (
          <section aria-label="Published Pack preview" className={styles.preview}>
            <h3>
              <span lang="">{version.content.title}</span> · version {version.version}
            </h3>
            <p lang="">{version.content.description}</p>
            <dl>
              <dt>Diagnostic</dt>
              <dd lang="">{version.content.diagnostic.prompt}</dd>
              <dt>Linked recheck</dt>
              <dd lang="">{version.content.recheck.prompt}</dd>
            </dl>
            <p>{version.content.interventions.length} facilitator cards copied as references.</p>
          </section>
        ) : null}
        {error || loadError ? <p role="alert">{error || loadError}</p> : null}
        {retryVersionId ? (
          <p role="status">
            The insertion was not acknowledged. Retry the same operation to recover its result
            without creating another copy. Editing stays paused until it is acknowledged.
          </p>
        ) : null}
        {busy ? <p role="status">Saving and inserting…</p> : null}
        <div className={styles.actions}>
          <button
            disabled={busy || (!retryVersionId && (!version || Boolean(loadError)))}
            onClick={() => {
              const id = retryVersionId ?? version?.id;
              if (id) onInsert(id);
            }}
            type="button"
          >
            {retryVersionId ? "Retry Pack insertion" : "Insert Pack checkpoints"}
          </button>
          <button disabled={busy || Boolean(retryVersionId)} onClick={onClose} type="button">
            Cancel
          </button>
          {!retryVersionId && !busy ? (
            <Link href="/recovery-packs">Open Recovery Pack library</Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
