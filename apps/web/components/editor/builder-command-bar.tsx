import Link from "next/link";
import { Brand } from "../brand";
import styles from "./round-builder.module.css";

type SaveState = "idle" | "saving" | "saved" | "error" | "conflict";

function saveStateLabel(saveState: SaveState) {
  if (saveState === "saving") return "Saving…";
  if (saveState === "saved") return "Saved";
  if (saveState === "conflict") return "Edit conflict";
  if (saveState === "error") return "Save failed";
  return "Ready";
}

export function BuilderCommandBar({
  title,
  status,
  saveState,
  canUndo,
  canRedo,
  previewDisabled,
  publishDisabled,
  publishLabel,
  assignHref,
  questionMapOpen,
  inspectorOpen,
  onTitleChange,
  onUndo,
  onRedo,
  onPreview,
  onPublish,
  onToggleQuestionMap,
  onToggleInspector,
}: {
  title: string;
  status?: string;
  saveState: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  previewDisabled: boolean;
  publishDisabled: boolean;
  publishLabel: string;
  assignHref?: string;
  questionMapOpen: boolean;
  inspectorOpen: boolean;
  onTitleChange: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onPreview: () => void;
  onPublish: () => void;
  onToggleQuestionMap: () => void;
  onToggleInspector: () => void;
}) {
  return (
    <header className={styles.commandBar}>
      <Brand />
      <div className={styles.titleGroup}>
        <label className="sr-only" htmlFor="quiz-title">
          Title
        </label>
        <input
          aria-invalid={!title.trim()}
          className={styles.titleInput}
          id="quiz-title"
          maxLength={160}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="Untitled Round"
          value={title}
        />
        {status ? <span className="status-pill">{status}</span> : null}
      </div>
      <div className={styles.commandActions}>
        <div className={styles.viewActions}>
          <button
            aria-expanded={questionMapOpen}
            className={styles.viewButton}
            onClick={onToggleQuestionMap}
            type="button"
          >
            Questions
          </button>
          <button
            aria-expanded={inspectorOpen}
            className={styles.viewButton}
            onClick={onToggleInspector}
            type="button"
          >
            Inspector
          </button>
        </div>
        <span className={styles.saveState} data-state={saveState} role="status">
          <span className={styles.saveDot} aria-hidden="true" />
          {saveStateLabel(saveState)}
        </span>
        <div className={styles.historyActions}>
          <Link className={styles.iconButton} href="/dashboard">
            Dashboard
          </Link>
          <button
            aria-label="Undo last edit"
            className={styles.iconButton}
            disabled={!canUndo}
            onClick={onUndo}
            title="Undo"
            type="button"
          >
            ↶
          </button>
          <button
            aria-label="Redo last edit"
            className={styles.iconButton}
            disabled={!canRedo}
            onClick={onRedo}
            title="Redo"
            type="button"
          >
            ↷
          </button>
        </div>
        <button
          className="button-quiet small-button"
          disabled={previewDisabled}
          onClick={onPreview}
          type="button"
        >
          Preview
        </button>
        {assignHref ? (
          <Link className="button-quiet small-button" href={assignHref}>
            Assign practice
          </Link>
        ) : null}
        <button
          className="button small-button"
          disabled={publishDisabled}
          onClick={onPublish}
          type="button"
        >
          {publishLabel}
        </button>
      </div>
    </header>
  );
}
