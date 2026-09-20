"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { PresentationDraft } from "@openround/contracts";
import { AuthoringAssistant } from "../../../components/authoring-assistant";
import { apiFetch, humanError } from "../../../lib/api";
import { clientUuid } from "../../../lib/uuid";
import { WorkspaceProvider, useWorkspace } from "../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import {
  recordAuthoringEvent,
  recordCreationEvent,
} from "../../../components/workspace/product-events";
import styles from "../../../components/workspace/workspace-hub.module.css";

function PresentationLauncher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canEdit } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function createBlankPresentation() {
    setCreating(true);
    setError("");
    recordCreationEvent("creation_started", "blank", "presentation");
    try {
      const response = await apiFetch<{ presentation: { id: string } }>("/v1/presentations", {
        method: "POST",
        body: JSON.stringify({ title: "Untitled presentation", description: "" }),
      });
      recordCreationEvent("creation_completed", "blank", "presentation");
      router.push(`/presentation/${response.presentation.id}`);
    } catch (caught) {
      setError(humanError(caught));
      setCreating(false);
    }
  }

  async function createTemplate(kind: "review" | "training" | "meeting") {
    setCreating(true);
    setError("");
    recordCreationEvent("creation_started", "starter", "presentation");
    try {
      const labels = {
        review: "Evidence review",
        training: "Training and recovery",
        meeting: "Team meeting",
      };
      const created = await apiFetch<{
        presentation: { id: string; draftRevision: number };
      }>("/v1/presentations", {
        method: "POST",
        body: JSON.stringify({ title: labels[kind], description: "" }),
      });
      const questionId = clientUuid();
      const recheckId = clientUuid();
      const mainQuestion = {
        id: questionId,
        type: kind === "meeting" ? ("poll" as const) : ("single_select" as const),
        prompt:
          kind === "meeting"
            ? "Which topic should we discuss first?"
            : "Which idea is best supported by the material?",
        choices: [
          { id: clientUuid(), label: "Option one", isCorrect: kind !== "meeting" },
          { id: clientUuid(), label: "Option two", isCorrect: false },
        ],
        purpose: kind === "meeting" ? ("opinion" as const) : ("diagnostic" as const),
        confidence: kind === "meeting" ? ("off" as const) : ("optional" as const),
        delivery: "main" as const,
        conceptKeys: kind === "meeting" ? [] : ["core-idea"],
        linkedRecheckQuestionId: kind === "training" ? recheckId : null,
        timeLimitSeconds: 30,
        basePoints: kind === "meeting" ? 0 : 1_000,
        explanation: "Replace this guidance with an evidence-based explanation.",
        mediaId: null,
        mediaAlt: null,
      };
      const draft: PresentationDraft = {
        title: labels[kind],
        description: "Adapt this structured template to the facilitation goal.",
        experiencePreset: { id: "focus", version: 1 },
        schemaVersion: 1,
        blocks: [
          {
            id: clientUuid(),
            kind: "content",
            layout: kind === "meeting" ? "section" : "title_body",
            title: labels[kind],
            body: "Set the context, desired outcome, and evidence participants need before responding.",
            mediaId: null,
            mediaAlt: null,
            speakerNotes: "Confirm the purpose and invite questions before advancing.",
          },
          { id: clientUuid(), kind: "question", question: mainQuestion },
          ...(kind === "training"
            ? [
                {
                  id: clientUuid(),
                  kind: "content" as const,
                  layout: "callout" as const,
                  title: "Intervention",
                  body: "Clarify the misconception using a worked example before the recheck.",
                  mediaId: null,
                  mediaAlt: null,
                  speakerNotes: "Do not reveal the recheck answer.",
                },
                {
                  id: clientUuid(),
                  kind: "question" as const,
                  question: {
                    ...mainQuestion,
                    id: recheckId,
                    prompt: "Apply the clarified idea in a new situation.",
                    choices: mainQuestion.choices.map((choice) => ({
                      ...choice,
                      id: clientUuid(),
                    })),
                    delivery: "recheck" as const,
                    linkedRecheckQuestionId: null,
                  },
                },
              ]
            : []),
        ],
      };
      await apiFetch(`/v1/presentations/${created.presentation.id}/draft`, {
        method: "PUT",
        body: JSON.stringify({
          draft,
          expectedRevision: created.presentation.draftRevision,
          mutationId: clientUuid(),
          schemaVersion: 1,
        }),
      });
      recordCreationEvent("creation_completed", "starter", "presentation");
      recordAuthoringEvent("first_block_created", "presentation");
      router.push(`/presentation/${created.presentation.id}`);
    } catch (caught) {
      setError(humanError(caught));
      setCreating(false);
    }
  }

  const selectedStart = searchParams.get("start");

  return (
    <WorkspaceShell
      actions={
        <Link className="button-quiet" href="/create">
          Create a Round instead
        </Link>
      }
      description="Choose the shortest path from existing material to an interactive, Recovery-ready session."
      eyebrow="Create presentation"
      requiredFeature="presentations"
      title="How do you want to start?"
    >
      {!canEdit ? (
        <div className={styles.emptyCanvas}>
          <div>
            <span className={styles.emptyMark} aria-hidden="true">
              P
            </span>
            <h2>This workspace role is read-only</h2>
            <p>Viewers can browse presentation starters but cannot create a new draft.</p>
            <Link className="button-quiet" href="/discover">
              Browse Discover
            </Link>
          </div>
        </div>
      ) : (
        <>
          {selectedStart ? (
            <div className={styles.methodToolbar}>
              <Link className="button-quiet small-button" href="/create/presentation">
                ← All starting points
              </Link>
              <span>
                {selectedStart === "source" ? "Source-grounded" : "Presentation template"}
              </span>
            </div>
          ) : null}
          {!selectedStart ? (
            <div className={styles.methodGrid}>
              <Link className={styles.methodCard} href="/create/presentation?start=source">
                <span className={styles.cardIcon} data-tone="violet">
                  S
                </span>
                <small>Slides or source</small>
                <h2>Bring your material</h2>
                <p>
                  Upload PowerPoint, PDF, Word, or trusted text and review source-grounded
                  proposals.
                </p>
                <span className={styles.cardLink}>Add material →</span>
              </Link>
              <Link className={styles.methodCard} href="/create/presentation?start=template">
                <span className={styles.cardIcon}>T</span>
                <small>Fastest start</small>
                <h2>Use a starter</h2>
                <p>Begin with a facilitated pattern and adapt the prompts, checks, and rechecks.</p>
                <span className={styles.cardLink}>Choose a starter →</span>
              </Link>
              <button
                className={styles.methodCard}
                disabled={creating}
                onClick={() => void createBlankPresentation()}
                type="button"
              >
                <span className={styles.cardIcon} data-tone="coral">
                  B
                </span>
                <small>Full control</small>
                <h2>Start a blank presentation</h2>
                <p>Create a presentation canvas, then add slides and audience interactions.</p>
                <span className={styles.cardLink}>
                  {creating ? "Creating presentation…" : "Start blank →"}
                </span>
              </button>
            </div>
          ) : null}

          {selectedStart === "source" ? (
            <section className={styles.panel}>
              <p className="eyebrow">Grounded conversion</p>
              <h2>Create from trusted material</h2>
              <p>
                PDF, DOCX, PPTX, and pasted text become structured OpenRound blocks. The result is
                reviewable and responsive—not a promise of pixel-perfect slide reproduction.
              </p>
              <AuthoringAssistant
                artifactType="presentation"
                canEdit
                plain
                terminology="round"
                trackCreation
              />
            </section>
          ) : null}

          {selectedStart === "template" ? (
            <section className={styles.panel}>
              <p className="eyebrow">Structured templates</p>
              <h2>Choose a facilitation pattern</h2>
              <div className={styles.methodGrid}>
                {(
                  [
                    ["review", "Evidence review", "Context followed by a diagnostic question."],
                    [
                      "training",
                      "Training + Recovery",
                      "Diagnostic, intervention, and linked recheck.",
                    ],
                    [
                      "meeting",
                      "Team meeting",
                      "A concise opening and an inclusive priority poll.",
                    ],
                  ] as const
                ).map(([kind, title, description]) => (
                  <button
                    className={styles.methodCard}
                    disabled={creating}
                    key={kind}
                    onClick={() => void createTemplate(kind)}
                    type="button"
                  >
                    <small>Presentation template</small>
                    <h3>{title}</h3>
                    <p>{description}</p>
                    <span className={styles.cardLink}>Use template →</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}

          <p className={styles.notice}>
            <strong>Built for live facilitation.</strong> Content slides and interactive questions
            stay together as one Presentation. Self-paced assignment remains available for Rounds.
          </p>
        </>
      )}
    </WorkspaceShell>
  );
}

export default function CreatePresentationPage() {
  return (
    <WorkspaceProvider>
      <PresentationLauncher />
    </WorkspaceProvider>
  );
}
