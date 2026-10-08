"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AuthoringJob, QuestionDraft, RecoveryPackDraft } from "@openround/contracts";
import {
  createRecoveryPackSourceAuthoring,
  recoveryPackSourceApproved,
  recoveryPackSourceGeneration,
  type PackSourceAuthoringState,
  type RecoveryPackRecord,
} from "../lib/recovery-pack-source";

export function PackSourceCitations({ citations }: { citations: RecoveryPackDraft["citations"] }) {
  return citations.length ? (
    <ul aria-label="Source citation details">
      {citations.map((citation, index) => (
        <li key={index}>
          <strong>{citation.sourceName}</strong> · {citation.locator}
          <p>{citation.excerpt}</p>
          <small>
            Source digest: <code>{citation.sourceDigest}</code>
          </small>
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted">No citations on this item.</p>
  );
}

function PackSourceCheckpoint({ label, question }: { label: string; question: QuestionDraft }) {
  return (
    <section role="group" aria-label={label}>
      <h4>{label}</h4>
      <p>{question.prompt}</p>
      <p>{question.explanation}</p>
      <p className="muted">
        {question.type} · {question.purpose ?? "diagnostic"} · {question.delivery ?? "main"} ·
        confidence {question.confidence ?? "off"} · {question.timeLimitSeconds}s ·{" "}
        {question.basePoints} points
      </p>
      <p>Concepts: {(question.conceptKeys ?? []).join(", ") || "None"}</p>
      {"choices" in question ? (
        <ul aria-label={`${label} response options`}>
          {question.choices.map((choice) => (
            <li key={choice.id}>
              {choice.label}
              {choice.isCorrect ? " (correct)" : " (incorrect)"}
              {choice.feedback ? <p>Rationale: {choice.feedback}</p> : null}
              {choice.misconceptionKey ? <p>Misconception: {choice.misconceptionKey}</p> : null}
            </li>
          ))}
        </ul>
      ) : question.type === "numeric" ? (
        <p>
          Accepted value: {question.correctValue} · tolerance {question.tolerance}
          {question.unit ? ` ${question.unit}` : ""}
        </p>
      ) : null}
      <PackSourceCitations citations={question.sourceCitations ?? []} />
    </section>
  );
}

export function PackSourceContentView({ draft }: { draft: RecoveryPackDraft }) {
  return (
    <div style={{ minWidth: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
      <h4>{draft.title}</h4>
      <p>{draft.description}</p>
      <p>Shared concepts: {draft.conceptKeys.join(", ")}</p>
      <p>Misconceptions: {draft.misconceptionKeys.join(", ") || "None"}</p>
      <PackSourceCheckpoint label="Source diagnostic" question={draft.diagnostic} />
      {draft.interventions.map((card, index) => (
        <section role="group" aria-label={`Source intervention card ${index + 1}`} key={card.id}>
          <h4>
            Card {index + 1}: {card.title}
          </h4>
          <p>{card.body}</p>
          <PackSourceCitations citations={card.citations} />
        </section>
      ))}
      <PackSourceCheckpoint label="Source linked recheck" question={draft.recheck} />
      {draft.delayedProbe ? (
        <PackSourceCheckpoint label="Source delayed probe" question={draft.delayedProbe} />
      ) : null}
      <h4>Global Pack citations</h4>
      <PackSourceCitations citations={draft.citations} />
    </div>
  );
}

export interface RecoveryPackSourceTarget {
  disabled: boolean;
  beforeCreate: () => boolean;
  onCreated: (pack: RecoveryPackRecord) => void;
  onBusyChange: (busy: boolean) => void;
  onSourceChanged?: () => void;
}

export function RecoveryPackSourceProposalPanel({
  job,
  canEdit,
  target,
}: {
  job: AuthoringJob;
  canEdit: boolean;
  target: RecoveryPackSourceTarget;
}) {
  const [state, setState] = useState<PackSourceAuthoringState>({
    proposal: null,
    busy: null,
    error: "",
    status: "",
  });
  const current = useRef({ canEdit, target });
  current.current = { canEdit, target };
  const manager = useRef<ReturnType<typeof createRecoveryPackSourceAuthoring> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const error = useRef<HTMLParagraphElement>(null);
  const generation = recoveryPackSourceGeneration(job);
  useEffect(() => {
    let creating = false;
    const instance = createRecoveryPackSourceAuthoring({
      job,
      canCreate: () => current.current.canEdit,
      beforeCreate: () => !current.current.target.disabled && current.current.target.beforeCreate(),
      onCreated: (pack) => current.current.target.onCreated(pack),
      onState: (next) => {
        setState(next);
        if (creating || next.busy === "create")
          current.current.target.onBusyChange(next.busy === "create");
        creating = next.busy === "create";
      },
    });
    manager.current = instance;
    return () => {
      instance.cancel();
      if (creating) current.current.target.onBusyChange(false);
    };
    // A generation binds the manager to the complete immutable source output.
  }, [generation]);
  useEffect(() => {
    if (state.error) error.current?.focus();
    else if (state.proposal) heading.current?.focus();
  }, [state.error, state.proposal]);
  return (
    <section
      aria-label={`Pack source proposal: ${job.sourceName}`}
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <p className="muted">
        Source conversion proposes a diagnostic, linked recheck, and cited facilitator card. Create
        a draft to edit; saved content and citations require your explicit review before
        publication.
      </p>
      <button
        className="button-quiet"
        type="button"
        disabled={Boolean(state.busy) || target.disabled}
        onClick={() => void manager.current?.preview()}
      >
        {state.error && !state.proposal
          ? "Retry Pack source proposal"
          : "Review Pack source proposal"}
      </button>
      <p role="status" aria-live="polite">
        {state.status}
      </p>
      {state.error ? (
        <p className="error" role="alert" tabIndex={-1} ref={error}>
          {state.error}
        </p>
      ) : null}
      {state.proposal ? (
        <>
          <h4 tabIndex={-1} ref={heading}>
            Source Pack proposal
          </h4>
          <p>Source: {state.proposal.sourceName}</p>
          <p>
            Source digest: <code>{state.proposal.sourceDigest}</code>
          </p>
          <p>
            Content hash: <code>{state.proposal.contentHash}</code>
          </p>
          <PackSourceContentView draft={state.proposal.draft} />
          {state.proposal.conversionNotes.length ? (
            <div className="notice">
              <strong>Conversion review</strong>
              <ul>
                {state.proposal.conversionNotes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <button
            className="button"
            type="button"
            disabled={!canEdit || target.disabled || Boolean(state.busy)}
            onClick={() => void manager.current?.create()}
          >
            {state.busy === "create"
              ? "Creating source Pack draft…"
              : state.error
                ? "Retry creating source Pack draft"
                : "Create source Pack draft"}
          </button>
        </>
      ) : null}
    </section>
  );
}

export function RecoveryPackSourceReviewPanel({
  pack,
  draft,
  dirty,
  invalidated,
  canEdit,
  busy,
  contentChecked,
  citationsChecked,
  onContentChecked,
  onCitationsChecked,
  onApprove,
}: {
  pack: RecoveryPackRecord;
  draft: RecoveryPackDraft;
  dirty: boolean;
  invalidated: boolean;
  canEdit: boolean;
  busy: boolean;
  contentChecked: boolean;
  citationsChecked: boolean;
  onContentChecked: (checked: boolean) => void;
  onCitationsChecked: (checked: boolean) => void;
  onApprove: () => void;
}) {
  const headingId = useId();
  if (!pack.sourceReview) return null;
  const approved = !dirty && !invalidated && recoveryPackSourceApproved(pack);
  return (
    <section
      aria-labelledby={headingId}
      style={{ minWidth: 0, overflowWrap: "anywhere", marginTop: 24 }}
    >
      <h3 id={headingId}>Source content and citation review</h3>
      <p>Source: {pack.sourceReview.sourceName}</p>
      <p>
        Source digest: <code>{pack.sourceReview.sourceDigest}</code>
      </p>
      <p role="status" aria-live="polite">
        {dirty
          ? "Save your edits before reviewing and approving this revision."
          : approved
            ? `Saved revision ${pack.draftRevision} has content and citation approval. Publishing is a separate action.`
            : `Saved revision ${pack.draftRevision} needs content and citation approval before publishing.`}
      </p>
      {!canEdit ? (
        <p className="notice">
          Source review is readable. Your workspace role or paused Pack authoring prevents approval.
        </p>
      ) : null}
      <details>
        <summary>Review complete Pack content and every citation</summary>
        <PackSourceContentView draft={draft} />
      </details>
      <fieldset disabled={!canEdit || busy || dirty} style={{ minWidth: 0 }}>
        <legend>Explicit approval of the saved revision</legend>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={contentChecked}
            onChange={(event) => onContentChecked(event.target.checked)}
          />
          I reviewed the full saved content, answer keys, and facilitator guidance.
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={citationsChecked}
            onChange={(event) => onCitationsChecked(event.target.checked)}
          />
          I verified every citation and excerpt against the source.
        </label>
        <button
          className="button-quiet"
          type="button"
          disabled={!contentChecked || !citationsChecked}
          onClick={onApprove}
        >
          Approve saved content and citations
        </button>
      </fieldset>
    </section>
  );
}
