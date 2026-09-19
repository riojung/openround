"use client";

import type { RoundLibraryView } from "../../lib/round-library-view";
import styles from "./workspace-content.module.css";

export function RoundLibraryViewToggle({
  value,
  onChange,
}: {
  value: RoundLibraryView;
  onChange: (view: RoundLibraryView) => void;
}) {
  return (
    <div aria-label="Round library view" className={styles.viewToggle} role="group">
      <button
        aria-label="Grid view"
        aria-pressed={value === "grid"}
        onClick={() => onChange("grid")}
        type="button"
      >
        Grid
      </button>
      <button
        aria-label="List view"
        aria-pressed={value === "list"}
        onClick={() => onChange("list")}
        type="button"
      >
        List
      </button>
    </div>
  );
}
