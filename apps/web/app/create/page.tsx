"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { QuestionType } from "@openround/contracts";
import { AuthoringAssistant } from "../../components/authoring-assistant";
import { CheckpointSetImport } from "../../components/checkpoint-set-import";
import { StarterGallery } from "../../components/workspace/starter-gallery";
import { questionTypeOptions } from "../../components/workspace/workspace-model";
import { WorkspaceProvider, useWorkspace } from "../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../components/workspace/workspace-shell";
import styles from "../../components/workspace/workspace-content.module.css";
import { apiFetch, humanError } from "../../lib/api";
import { recordCreationEvent } from "../../components/workspace/product-events";

const starts = [
  {
    href: "#starters",
    title: "Use a starter",
    description: "Begin with a focused, editable Round built for a familiar moment.",
  },
  {
    href: "#source",
    title: "Create from a source",
    description: "Turn trusted text, PDF, Word, or PowerPoint material into a review draft.",
  },
  {
    href: "#import",
    title: "Import existing work",
    description: "Validate OpenRound JSON, CSV, bulk text, or a QTI 3 package.",
  },
  {
    href: "#blank",
    title: "Start blank",
    description: "Name the Round, choose the first response type, and begin writing.",
  },
];

function CreateContent() {
  const router = useRouter();
  const { canEdit, entitlements } = useWorkspace();
  const [title, setTitle] = useState("");
  const [questionType, setQuestionType] = useState<QuestionType>("single_select");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function createBlank(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    recordCreationEvent("creation_started", "blank");
    try {
      const response = await apiFetch<{ quiz: { id: string } }>("/v1/quizzes", {
        method: "POST",
        body: JSON.stringify({ title, description: "" }),
      });
      recordCreationEvent("creation_completed", "blank");
      router.push(`/quiz/${response.quiz.id}?insert=${questionType}`);
    } catch (caught) {
      setError(humanError(caught));
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <div className={styles.emptyState}>
        <h2>This workspace role is read-only</h2>
        <p>Viewers can browse Rounds and templates, but only owners and editors can create one.</p>
        <Link className="button-quiet" href="/templates">
          Browse templates
        </Link>
      </div>
    );
  }

  return (
    <>
      <nav className={styles.startGrid} aria-label="Ways to create a Round">
        {starts.map((start, index) => (
          <a className={styles.startCard} href={start.href} key={start.href}>
            <span className={styles.startNumber} aria-hidden="true">
              {index + 1}
            </span>
            <h2>{start.title}</h2>
            <p>{start.description}</p>
            <span className={styles.startLink}>Choose this path →</span>
          </a>
        ))}
      </nav>

      <section className={`${styles.section} ${styles.panel}`} id="starters">
        <div className={styles.sectionHeader}>
          <div>
            <p className="eyebrow">Fastest start</p>
            <h2>Use a starter</h2>
            <p>Every starter becomes an independent draft you can change freely.</p>
          </div>
          <Link href="/templates">See all templates</Link>
        </div>
        <StarterGallery compact />
      </section>

      <section className={`${styles.section} ${styles.panel}`} id="source">
        <div className={styles.sectionHeader}>
          <div>
            <p className="eyebrow">Grounded authoring</p>
            <h2>Create from a source</h2>
            <p>Proposals stay unpublished until a person verifies every answer and citation.</p>
          </div>
        </div>
        <AuthoringAssistant canEdit plain terminology="round" trackCreation />
      </section>

      <section className={`${styles.section} ${styles.panel}`} id="import">
        <CheckpointSetImport
          enabled={Boolean(entitlements?.csvExport)}
          onImported={async (quiz) => {
            router.push(`/quiz/${quiz.id}`);
          }}
          onUpgrade={() => router.push("/pricing")}
          plain
          terminology="round"
          trackCreation
        />
      </section>

      <section className={`${styles.section} ${styles.panel}`} id="blank">
        <div className={styles.sectionHeader}>
          <div>
            <p className="eyebrow">Full control</p>
            <h2>Start a blank Round</h2>
            <p>Choose the response you want to write first. You can mix types later.</p>
          </div>
        </div>
        <form className={styles.blankForm} onSubmit={createBlank}>
          <label className="field">
            <span>Round title</span>
            <input
              className="input"
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Friday knowledge check"
              required
              value={title}
            />
          </label>
          <fieldset>
            <legend>First response type</legend>
            <div className={styles.typeGrid}>
              {questionTypeOptions.map((option) => (
                <label className={styles.typeChoice} key={option.type}>
                  <input
                    checked={questionType === option.type}
                    name="question-type"
                    onChange={() => setQuestionType(option.type)}
                    type="radio"
                    value={option.type}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <div>
            <button className="button" disabled={busy} type="submit">
              {busy ? "Creating Round…" : "Create Round and write question"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

export default function CreatePage() {
  return (
    <WorkspaceProvider>
      <WorkspaceShell
        actions={
          <Link className="button-quiet" href="/dashboard">
            Back to Rounds
          </Link>
        }
        description="Choose the shortest path from an idea or trusted source to a ready-to-run Round."
        eyebrow="Create"
        title="How do you want to start?"
      >
        <CreateContent />
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
