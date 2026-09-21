"use client";

import Link from "next/link";
import { StarterGallery } from "../../components/workspace/starter-gallery";
import { useWorkspace, WorkspaceProvider } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import styles from "../../components/workspace/workspace-content.module.css";

function TemplatesWorkspace() {
  const { canEdit } = useWorkspace();

  return (
    <WorkspaceShell
      actions={
        canEdit ? (
          <Link className="button" href="/create?start=blank">
            Start blank
          </Link>
        ) : null
      }
      description="Start from an OpenRound pattern, then make every prompt, response, and recheck your own."
      eyebrow="First-party library"
      title="Templates"
    >
      <div className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <h2>Proven starting points</h2>
            <p>
              Templates are versioned and read-only. Using one creates a fresh draft with new IDs
              inside your workspace.
            </p>
          </div>
        </div>
        <StarterGallery />
      </div>
    </WorkspaceShell>
  );
}

export default function TemplatesPage() {
  return (
    <WorkspaceProvider>
      <TemplatesWorkspace />
    </WorkspaceProvider>
  );
}
