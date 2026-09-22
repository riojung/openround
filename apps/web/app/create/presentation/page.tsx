"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { PresentationDraft } from "@openround/contracts";
import { AuthoringAssistant } from "../../../components/authoring-assistant";
import { useLocale } from "../../../components/locale-provider";
import { apiFetch, humanError } from "../../../lib/api";
import type { MessageKey } from "../../../lib/i18n/catalog";
import { clientUuid } from "../../../lib/uuid";
import { WorkspaceProvider, useWorkspace } from "../../../components/workspace/workspace-provider";
import { WorkspaceShell } from "../../../components/workspace/workspace-shell";
import {
  recordAuthoringEvent,
  recordCreationEvent,
} from "../../../components/workspace/product-events";
import styles from "../../../components/workspace/workspace-hub.module.css";

type PresentationTemplateKind = "review" | "training" | "meeting";

const presentationTemplates: Array<{
  kind: PresentationTemplateKind;
  titleKey: MessageKey;
  descriptionKey: MessageKey;
}> = [
  {
    kind: "review",
    titleKey: "create.presentation.template.review.title",
    descriptionKey: "create.presentation.template.review.description",
  },
  {
    kind: "training",
    titleKey: "create.presentation.template.training.title",
    descriptionKey: "create.presentation.template.training.description",
  },
  {
    kind: "meeting",
    titleKey: "create.presentation.template.meeting.title",
    descriptionKey: "create.presentation.template.meeting.description",
  },
];

function PresentationLauncher() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLocale();
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
        body: JSON.stringify({
          title: "Untitled presentation",
          description: "",
        }),
      });
      recordCreationEvent("creation_completed", "blank", "presentation");
      router.push(`/presentation/${response.presentation.id}`);
    } catch (caught) {
      setError(humanError(caught));
      setCreating(false);
    }
  }

  async function createTemplate(kind: PresentationTemplateKind) {
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
          {t("create.presentation.switchToRound")}
        </Link>
      }
      description={t("create.presentation.description")}
      eyebrow={t("create.presentation.eyebrow")}
      requiredFeature="presentations"
      title={t("create.presentation.title")}
      translationLevel="full"
    >
      {!canEdit ? (
        <div className={styles.emptyCanvas}>
          <div>
            <span className={styles.emptyMark} aria-hidden="true">
              P
            </span>
            <h2>{t("create.common.readOnlyTitle")}</h2>
            <p>{t("create.presentation.readOnlyDescription")}</p>
            <Link className="button-quiet" href="/discover">
              {t("create.presentation.browseDiscover")}
            </Link>
          </div>
        </div>
      ) : (
        <>
          {selectedStart ? (
            <div className={styles.methodToolbar}>
              <Link className="button-quiet small-button" href="/create/presentation">
                {t("create.common.allStartingPoints")}
              </Link>
              <span>
                {selectedStart === "source"
                  ? t("create.common.sourceGrounded")
                  : t("create.common.presentationTemplate")}
              </span>
            </div>
          ) : null}
          {!selectedStart ? (
            <div className={styles.methodGrid}>
              <Link className={styles.methodCard} href="/create/presentation?start=source">
                <span className={styles.cardIcon} data-tone="violet">
                  S
                </span>
                <small>{t("create.presentation.method.source.kicker")}</small>
                <h2>{t("create.presentation.method.source.title")}</h2>
                <p>{t("create.presentation.method.source.description")}</p>
                <span className={styles.cardLink}>
                  {t("create.presentation.method.source.action")}
                </span>
              </Link>
              <Link className={styles.methodCard} href="/create/presentation?start=template">
                <span className={styles.cardIcon}>T</span>
                <small>{t("create.common.fastestStart")}</small>
                <h2>{t("create.presentation.method.template.title")}</h2>
                <p>{t("create.presentation.method.template.description")}</p>
                <span className={styles.cardLink}>
                  {t("create.presentation.method.template.action")}
                </span>
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
                <small>{t("create.common.fullControl")}</small>
                <h2>{t("create.presentation.method.blank.title")}</h2>
                <p>{t("create.presentation.method.blank.description")}</p>
                <span className={styles.cardLink}>
                  {creating
                    ? t("create.presentation.method.blank.creating")
                    : t("create.presentation.method.blank.action")}
                </span>
              </button>
            </div>
          ) : null}

          {selectedStart === "source" ? (
            <section className={styles.panel}>
              <p className="eyebrow">{t("create.presentation.source.eyebrow")}</p>
              <h2>{t("create.presentation.source.title")}</h2>
              <p>{t("create.presentation.source.description")}</p>
              <div lang="en-CA">
                <AuthoringAssistant
                  artifactType="presentation"
                  canEdit
                  plain
                  terminology="round"
                  trackCreation
                />
              </div>
            </section>
          ) : null}

          {selectedStart === "template" ? (
            <section className={styles.panel}>
              <p className="eyebrow">{t("create.presentation.templates.eyebrow")}</p>
              <h2>{t("create.presentation.templates.title")}</h2>
              <div className={styles.methodGrid}>
                {presentationTemplates.map(({ kind, titleKey, descriptionKey }) => (
                  <button
                    className={styles.methodCard}
                    disabled={creating}
                    key={kind}
                    onClick={() => void createTemplate(kind)}
                    type="button"
                  >
                    <small>{t("create.common.presentationTemplate")}</small>
                    <h3>{t(titleKey)}</h3>
                    <p>{t(descriptionKey)}</p>
                    <span className={styles.cardLink}>
                      {t("create.presentation.templates.use")}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {error ? (
            <p className="error" lang="en-CA" role="alert">
              {error}
            </p>
          ) : null}

          <p className={styles.notice}>
            <strong>{t("create.presentation.notice.title")}</strong>{" "}
            {t("create.presentation.notice.description")}
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
