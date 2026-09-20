"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "../../../../components/brand";
import { WorkspaceProvider } from "../../../../components/workspace/workspace-provider";
import { WorkspaceFeatureGate } from "../../../../components/workspace/workspace-shell";
import styles from "../../../../components/presentation-live/presentation-live.module.css";
import { recordAuthoringEvent } from "../../../../components/workspace/product-events";
import { apiFetch, humanError } from "../../../../lib/api";

interface PresentationRecord {
  id: string;
  title: string;
  description: string;
  currentVersionId: string | null;
  hasUnpublishedChanges: boolean;
  draft: { blocks: Array<{ kind: "content" | "question" }> };
}

function PresentationHostSetupContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [presentation, setPresentation] = useState<PresentationRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiFetch<{ presentation: PresentationRecord }>(`/v1/presentations/${id}`)
      .then(({ presentation: loaded }) => setPresentation(loaded))
      .catch((caught) => {
        if ((caught as { status?: number }).status === 401) router.replace("/signin");
        else setError(humanError(caught));
      });
  }, [id, router]);

  async function startSession() {
    setBusy(true);
    setError("");
    try {
      const { snapshot } = await apiFetch<{ snapshot: { id: string } }>(
        "/v1/presentation-sessions",
        {
          method: "POST",
          body: JSON.stringify({ presentationId: id }),
        },
      );
      recordAuthoringEvent("presentation_host_started", "presentation");
      router.push(`/presentation-session/${snapshot.id}/host`);
    } catch (caught) {
      setError(humanError(caught));
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <Brand />
        <Link href={`/presentation/${id}`}>Back to builder</Link>
      </div>
      <section className={styles.setup}>
        <span className={styles.statusPill}>Live Presentation</span>
        <h1>{presentation?.title ?? "Preparing Presentation…"}</h1>
        <p>
          Content slides and interactive questions will run in their authored order. Participants
          join without workspace accounts, and only question responses become learning evidence.
        </p>
        {presentation ? (
          <div className={styles.metricRow}>
            <div className={styles.metric}>
              <strong>{presentation.draft.blocks.length}</strong>
              <span>Total blocks</span>
            </div>
            <div className={styles.metric}>
              <strong>
                {presentation.draft.blocks.filter((block) => block.kind === "question").length}
              </strong>
              <span>Interactive questions</span>
            </div>
          </div>
        ) : null}
        {presentation?.hasUnpublishedChanges ? (
          <p className="notice">
            This session will use the latest published version. Unpublished builder changes are not
            included.
          </p>
        ) : null}
        {!presentation?.currentVersionId && presentation ? (
          <p className="error" role="alert">
            Publish this Presentation before hosting it.
          </p>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="button-row">
          <button
            className="button"
            disabled={busy || !presentation?.currentVersionId}
            onClick={() => void startSession()}
            type="button"
          >
            {busy ? "Opening room…" : "Open participant room"}
          </button>
          <Link className="button-quiet" href="/sessions">
            Session history
          </Link>
        </div>
      </section>
    </main>
  );
}

export default function PresentationHostSetupPage() {
  return (
    <WorkspaceProvider>
      <WorkspaceFeatureGate feature="presentations">
        <PresentationHostSetupContent />
      </WorkspaceFeatureGate>
    </WorkspaceProvider>
  );
}
