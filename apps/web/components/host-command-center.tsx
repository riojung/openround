"use client";

import type { ReactNode } from "react";
import type { SessionSnapshot } from "@openround/contracts";
import type { HostPhaseCommand, HostPhaseView } from "../lib/host-phase";

export function HostStage({
  children,
  className = "",
  enhanced = true,
}: {
  children: ReactNode;
  className?: string;
  enhanced?: boolean;
}) {
  return (
    <section
      className={`live-card ${enhanced ? "host-stage" : ""} ${className}`.trim()}
      data-testid="host-stage"
    >
      {children}
    </section>
  );
}

export function RecoveryCompass({
  snapshot,
  phaseView,
  showSteps = true,
  synthetic = false,
  children,
}: {
  snapshot: SessionSnapshot;
  phaseView: HostPhaseView;
  showSteps?: boolean;
  synthetic?: boolean;
  children?: ReactNode;
}) {
  const guidance = phaseView.suggestionKind === "none" ? null : snapshot.insight;

  if (!showSteps) {
    return (
      <aside className="panel">
        <h2 style={{ fontSize: "1.35rem" }}>Host controls</h2>
        <div className="metric-grid" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 18 }}>
          <div className="metric">
            <strong>{snapshot.participants.length}</strong>
            <span>joined</span>
          </div>
          <div className="metric">
            <strong>{snapshot.answerCount}</strong>
            <span>answered</span>
          </div>
        </div>
        {guidance ? (
          <div className="notice" aria-live="polite" style={{ marginBottom: 18 }}>
            <p className="eyebrow">Facilitator guidance</p>
            <strong>{guidance.recommendation.title}</strong>
            <p>{guidance.recommendation.reason}</p>
            <small>
              Based on {guidance.sampleSize} responses · {guidance.participationPercent}%
              participation
              {guidance.correctnessPercent === null
                ? " · unscored"
                : ` · ${guidance.correctnessPercent}% correct`}
              . This is a deterministic suggestion; use your judgment.
            </small>
          </div>
        ) : null}
        {children}
      </aside>
    );
  }

  return (
    <aside
      aria-label={synthetic ? "Synthetic Recovery Compass" : "Recovery Compass"}
      className="panel recovery-rail"
      data-synthetic={synthetic || undefined}
      data-testid="recovery-rail"
    >
      <p className="eyebrow">Recovery Compass</p>
      <h2 style={{ fontSize: "1.35rem" }}>{phaseView.phaseLabel}</h2>
      {synthetic ? <p className="synthetic-label">Synthetic evidence · never saved</p> : null}
      <ol className="recovery-steps" aria-label="Recovery process">
        {[
          ["Ask", snapshot.phase !== "lobby"],
          ["Diagnose", Boolean(snapshot.insight)],
          ["Act", Boolean(snapshot.intervention)],
          ["Recheck", snapshot.roundKind !== "main"],
          ["Prove", snapshot.phase === "finished"],
        ].map(([label, complete]) => (
          <li data-complete={complete || undefined} key={String(label)}>
            {label}
          </li>
        ))}
      </ol>
      <div className="metric-grid recovery-compass-metrics">
        <div className="metric">
          <strong>{snapshot.participants.length}</strong>
          <span>{synthetic ? "synthetic learners" : "joined"}</span>
        </div>
        <div className="metric">
          <strong>{snapshot.answerCount}</strong>
          <span>answered</span>
        </div>
      </div>
      {guidance ? (
        <div className="notice recovery-guidance" aria-live="polite">
          <p className="eyebrow">
            {phaseView.suggestionKind === "guidance" ? "Guidance only" : "Facilitator guidance"}
          </p>
          <strong>{guidance.recommendation.title}</strong>
          <p>{guidance.recommendation.reason}</p>
          <small>
            Based on {guidance.sampleSize} responses · {guidance.participationPercent}%
            participation
            {guidance.correctnessPercent === null
              ? " · unscored"
              : ` · ${guidance.correctnessPercent}% correct`}
            . This is a deterministic suggestion; use your judgment.
          </small>
        </div>
      ) : null}
      {children}
    </aside>
  );
}

export function HostCommandBar({
  phaseView,
  busy,
  onCommand,
  primary = phaseView.primary,
  secondary = phaseView.secondary,
  primaryDisabled = false,
  leading,
  trailing,
  fallback,
  synthetic = false,
  inert = false,
}: {
  phaseView: HostPhaseView;
  busy: boolean;
  onCommand: (command: HostPhaseCommand) => void;
  primary?: HostPhaseCommand | null;
  secondary?: HostPhaseCommand[];
  primaryDisabled?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  fallback?: ReactNode;
  synthetic?: boolean;
  inert?: boolean;
}) {
  return (
    <nav
      aria-label={synthetic ? "Synthetic host commands" : "Host commands"}
      className="host-command-bar"
      data-synthetic={synthetic || undefined}
      data-testid="host-command-bar"
      inert={inert}
    >
      <div>
        <span className="eyebrow">{synthetic ? "Guided next action" : "Next action"}</span>
        <strong>{primary?.label ?? "Review results"}</strong>
      </div>
      <div className="button-row">
        <div className="host-command-primary">
          {primary ? (
            <button
              className="button"
              disabled={busy || primaryDisabled}
              onClick={() => onCommand(primary)}
              type="button"
            >
              {busy ? "Applying…" : primary.label}
            </button>
          ) : (
            fallback
          )}
        </div>
        <div className="host-command-overflow">
          {leading}
          {secondary.map((item) => (
            <button
              className="button-quiet"
              disabled={busy}
              key={`${item.action}:${item.interventionType ?? item.recheckMode ?? ""}`}
              onClick={() => onCommand(item)}
              type="button"
            >
              {item.label}
            </button>
          ))}
          {trailing}
        </div>
      </div>
    </nav>
  );
}
