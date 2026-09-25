import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  buildCompanionPrototypeProjection,
  type CompanionPrototypeAction,
  type CompanionPrototypeConnectionState,
  type CompanionPrototypeInput,
} from "@openround/rehearsal";
import styles from "./research-prototype-lab.module.css";

export interface CompanionPrototypeObservation {
  completion: "in_progress" | "completed" | "abandoned";
  overlayOpenCount: number;
  primaryActionCount: number;
  returnedToSidecar: boolean;
}

export const INITIAL_COMPANION_PROTOTYPE_OBSERVATION: CompanionPrototypeObservation = {
  completion: "in_progress",
  overlayOpenCount: 0,
  primaryActionCount: 0,
  returnedToSidecar: false,
};

export const INITIAL_COMPANION_PROTOTYPE_INPUT: CompanionPrototypeInput = {
  phase: "lobby",
  roundKind: "main",
  joinedCount: 24,
  connectedCount: 22,
  answeredCount: 0,
  connectionState: "connected",
  hasLinkedRecheck: true,
  interventionFinished: false,
};

export function isOverlayDismissKey(key: string) {
  return key === "Escape";
}

export function advanceCompanionPrototype(
  current: CompanionPrototypeInput,
  action: CompanionPrototypeAction,
): CompanionPrototypeInput {
  switch (action) {
    case "start":
      return { ...current, phase: "question_open", answeredCount: 18 };
    case "lock":
      return { ...current, phase: "question_locked" };
    case "resume":
      return { ...current, phase: "question_open" };
    case "reveal":
      return { ...current, phase: "question_reveal" };
    case "intervention.start":
      return { ...current, phase: "intervention" };
    case "intervention.finish":
      return { ...current, phase: "question_reveal", interventionFinished: true };
    case "recheck.open":
      return {
        ...current,
        phase: "question_open",
        roundKind: "linked_recheck",
        answeredCount: 0,
      };
    case "next":
      return { ...current, phase: "finished" };
    case "none":
      return current;
  }
}

export function CompanionPrototypePanel({
  observation,
  onObservationChange,
  onReset,
}: {
  observation: CompanionPrototypeObservation;
  onObservationChange: (next: CompanionPrototypeObservation) => void;
  onReset: () => void;
}) {
  const [prototypeInput, setPrototypeInput] = useState(INITIAL_COMPANION_PROTOTYPE_INPUT);
  const [overlay, setOverlay] = useState<"none" | "join" | "result">("none");
  const closeOverlayRef = useRef<HTMLButtonElement>(null);
  const overlayTriggerRef = useRef<HTMLButtonElement>(null);
  const projection = useMemo(
    () => buildCompanionPrototypeProjection(prototypeInput),
    [prototypeInput],
  );
  const resultAvailable = ["question_reveal", "intervention", "leaderboard", "finished"].includes(
    projection.phase,
  );

  useEffect(() => {
    if (overlay !== "none") closeOverlayRef.current?.focus();
  }, [overlay]);

  function setConnectionState(connectionState: CompanionPrototypeConnectionState) {
    setPrototypeInput((current) => ({ ...current, connectionState }));
  }

  function applyPrimaryAction() {
    if (!projection.primaryAction.enabled) return;
    setPrototypeInput((current) =>
      advanceCompanionPrototype(current, projection.primaryAction.action),
    );
    onObservationChange({
      ...observation,
      primaryActionCount: observation.primaryActionCount + 1,
    });
  }

  function openOverlay(next: "join" | "result", event: MouseEvent<HTMLButtonElement>) {
    overlayTriggerRef.current = event.currentTarget;
    setOverlay(next);
    onObservationChange({
      ...observation,
      overlayOpenCount: observation.overlayOpenCount + 1,
    });
  }

  function returnToSidecar() {
    setOverlay("none");
    onObservationChange({ ...observation, returnedToSidecar: true });
    window.setTimeout(() => overlayTriggerRef.current?.focus(), 0);
  }

  function handleOverlayKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      event.preventDefault();
      closeOverlayRef.current?.focus();
      return;
    }
    if (!isOverlayDismissKey(event.key)) return;
    event.preventDefault();
    returnToSidecar();
  }

  return (
    <section aria-labelledby="companion-title" className={styles.panel}>
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>Prototype 01</p>
          <h2 id="companion-title">Companion sidecar</h2>
          <p>
            Test a compact facilitator surface beside an external deck. Counts are synthetic and
            commands update only this browser-memory prototype.
          </p>
        </div>
        <div className={styles.safetyNote}>
          <strong>Participant-safe projection</strong>
          <span>
            No identities, answer keys, citations, notes, diagnostics, room code, link, or
            credential enter the sidecar.
          </span>
        </div>
      </div>

      <div className={styles.companionWorkspace}>
        <div className={styles.sidecar} data-testid="companion-sidecar">
          <div className={styles.sidecarTopline}>
            <span className={styles.phasePill}>{projection.phaseLabel}</span>
            <span className={styles.connection} data-state={projection.connectionState}>
              <i aria-hidden="true" /> {projection.connectionState}
            </span>
          </div>
          <dl className={styles.roomStats}>
            <div>
              <dt>Joined</dt>
              <dd>{projection.roomStatus.joinedCount}</dd>
            </div>
            <div>
              <dt>Connected</dt>
              <dd>{projection.roomStatus.connectedCount}</dd>
            </div>
            <div>
              <dt>Disconnected</dt>
              <dd>{projection.roomStatus.disconnectedCount}</dd>
            </div>
            <div>
              <dt>Answered</dt>
              <dd>{projection.roomStatus.answeredCount}</dd>
            </div>
          </dl>
          <button
            className={styles.primaryButton}
            disabled={!projection.primaryAction.enabled}
            onClick={applyPrimaryAction}
            type="button"
          >
            {projection.primaryAction.label}
          </button>
          <div className={styles.overlayActions}>
            <button onClick={(event) => openOverlay("join", event)} type="button">
              Show join overlay
            </button>
            <button
              disabled={!resultAvailable}
              onClick={(event) => openOverlay("result", event)}
              type="button"
            >
              Show safe result
            </button>
          </div>
        </div>

        <div className={styles.prototypeControls}>
          <h3>Research controls</h3>
          <label htmlFor="prototype-connection-state">
            <span>Simulate connection</span>
            <select
              id="prototype-connection-state"
              onChange={(event) =>
                setConnectionState(event.target.value as CompanionPrototypeConnectionState)
              }
              value={prototypeInput.connectionState}
            >
              <option value="connected">Connected</option>
              <option value="reconnecting">Reconnecting</option>
              <option value="disconnected">Disconnected</option>
            </select>
          </label>
          <label htmlFor="companion-task-outcome">
            <span>Task outcome</span>
            <select
              id="companion-task-outcome"
              onChange={(event) =>
                onObservationChange({
                  ...observation,
                  completion: event.target.value as CompanionPrototypeObservation["completion"],
                })
              }
              value={observation.completion}
            >
              <option value="in_progress">Not recorded</option>
              <option value="completed">Completed</option>
              <option value="abandoned">Abandoned</option>
            </select>
          </label>
          <button
            className={styles.textButton}
            onClick={() => {
              setPrototypeInput(INITIAL_COMPANION_PROTOTYPE_INPUT);
              setOverlay("none");
              onObservationChange({ ...INITIAL_COMPANION_PROTOTYPE_OBSERVATION });
              onReset();
            }}
            type="button"
          >
            Reset prototype
          </button>
          <p aria-live="polite" className={styles.inlineStatus} role="status">
            {projection.connectionState === "connected"
              ? `${projection.phaseLabel}. ${projection.roomStatus.answeredCount} of ${projection.roomStatus.joinedCount} answered.`
              : `${projection.primaryAction.label}. Commands are unavailable until connected.`}
          </p>
        </div>
      </div>

      {overlay !== "none" ? (
        <div
          aria-describedby="prototype-overlay-description"
          aria-labelledby="prototype-overlay-title"
          aria-modal="true"
          className={styles.overlay}
          onKeyDown={handleOverlayKeyDown}
          role="dialog"
        >
          <div className={styles.overlayCard}>
            {overlay === "join" ? (
              <>
                <p className={styles.eyebrow}>Participant overlay preview</p>
                <h3 id="prototype-overlay-title">Join this Round</h3>
                <div aria-hidden="true" className={styles.qrPlaceholder}>
                  QR
                </div>
                <p id="prototype-overlay-description">
                  Use the join page and room code already shown by the live session.
                </p>
                <small>No room code, link, or credential is created by this prototype.</small>
              </>
            ) : (
              <>
                <p className={styles.eyebrow}>Participant-safe result preview</p>
                <h3 id="prototype-overlay-title">Responses are in</h3>
                <div
                  className={styles.mockBars}
                  aria-label="Synthetic response distribution"
                  id="prototype-overlay-description"
                >
                  <span style={{ "--mock-width": "58%" } as CSSProperties}>Option A · 58%</span>
                  <span style={{ "--mock-width": "42%" } as CSSProperties}>Option B · 42%</span>
                </div>
                <small>Synthetic aggregate only. No answer is marked correct.</small>
              </>
            )}
            <button
              className={styles.primaryButton}
              onClick={returnToSidecar}
              ref={closeOverlayRef}
              type="button"
            >
              Return to deck
            </button>
            <p className={styles.microcopy}>
              In this prototype, “return to deck” closes the overlay. A browser cannot promise to
              focus another desktop application.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
