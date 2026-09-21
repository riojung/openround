"use client";

import Link from "next/link";
import { useWorkspace } from "../../components/workspace/workspace-provider";
import { VideoGuide } from "../../components/workspace/video-guide";
import guideStyles from "../../components/workspace/video-guide.module.css";
import styles from "../../components/workspace/workspace-hub.module.css";
import {
  professionalBuilderGuidesAvailable,
  professionalRoundBuilderAvailable,
} from "../../lib/help-guide-availability";

const quickStartTranscript = [
  "Welcome to OpenRound. Your workspace keeps Rounds, Presentations, Sessions, Assignments, Results, Discover, and Groups together. Use Create whenever you are ready to begin.",
  "For a new Round, choose a starter, bring a trusted source, import structured work, or start blank. Every route creates a reviewable draft. Nothing publishes automatically.",
  "The Round Builder keeps the question map, direct-edit canvas, and inspector in view. Write the prompt and answers, mark the correct response, then use Diagnose to require confidence and tag the concepts you want to measure.",
  "Use Recover to add a fresh recheck. OpenRound links the diagnostic and recheck so reports can show whether understanding improved after support. Resolve the readiness items and wait for Saved.",
  "Preview the learner experience, publish the exact saved revision, then return to Library to host live or assign the Round for account-free practice. You are ready to try it.",
] as const;

const builderGuideTranscript = [
  "OpenRound is organized around a professional workspace. Home summarizes active work. Library holds Rounds and Presentations. Sessions and Assignments track delivery, Results collects evidence, and Groups supports facilitator collaboration. Universal search and Create stay available from the header.",
  "Creating a Round begins with one clear choice. Use a Recovery starter for speed, a trusted document for source-grounded proposals, a structural import for existing work, or a blank canvas for full control. Source and import results remain drafts until a person reviews them.",
  "The Builder has three working areas. The map on the left shows order, type, readiness, and recovery relationships. The central canvas is where you edit the prompt and responses directly. The inspector on the right holds settings that should not compete with the content. Autosave, undo, preview, and publish remain in the command bar.",
  "Build controls timing, points, and the explanation shown after reveal. Diagnose captures purpose, required or optional confidence, concept keys, and misconception feedback. Recover creates a fresh recheck and pairs it with the diagnostic question. The readiness panel links every blocker back to the field that needs attention.",
  "Presentations have their own grounded starting methods. Bring a trusted PDF, Word document, PowerPoint deck, or pasted text; choose a facilitation starter; or begin with a blank Presentation. The conversion is structured and responsive rather than a promise of pixel-perfect slide reproduction.",
  "Inside the Presentation Builder, content slides and interactive questions share one ordered map. Content blocks expose layout, media, notes, and accessibility controls. Question blocks reuse the same Build, Diagnose, and Recover model as a Round. You can also insert independent question copies from a published Round.",
  "Preview moves through the authored sequence. Content slides communicate context but are never treated as evidence of learning. The facilitator controls when to advance and when to launch an interaction.",
  "Interactive blocks switch to a participant-safe view. Learners see the prompt and choices, while answer keys, private notes, citations marked private, and facilitator metadata stay out of participant projections until the appropriate reveal phase.",
  "After publishing, use Sessions to host live, Assignments for account-free Round practice, and Results to review response and Recovery Loop evidence. Groups lets facilitator teams curate and schedule together without forcing learners to become workspace members.",
] as const;

export function HelpGuidance() {
  const { canEdit, productFeatures } = useWorkspace();
  const showProfessionalVideos = professionalBuilderGuidesAvailable(productFeatures);
  const roundBuilderAvailable = professionalRoundBuilderAvailable(productFeatures);
  const workspaceAvailable = productFeatures?.uxBeta && productFeatures.workspaceShell;
  const assignmentsAvailable = productFeatures?.practiceAssignments === true;
  const createHref = roundBuilderAvailable ? "/create?start=starters" : "/dashboard";
  const libraryHref = workspaceAvailable ? "/library" : "/dashboard";
  const resultsHref = workspaceAvailable ? "/results" : "/dashboard";
  const fallbackHref = canEdit ? createHref : libraryHref;

  return (
    <>
      <section
        aria-labelledby="video-guides-title"
        className={`${styles.section} ${guideStyles.section}`}
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="video-guides-title">
              {showProfessionalVideos
                ? "Watch, then try it yourself"
                : "Guidance for your current workspace"}
            </h2>
            <p>
              {showProfessionalVideos
                ? "Start with the one-minute tour, then go deeper into authoring and delivery."
                : "OpenRound shows only guidance for capabilities that are enabled in this workspace."}
            </p>
          </div>
        </div>

        {showProfessionalVideos ? (
          <div className={guideStyles.grid}>
            <VideoGuide
              captionsSrc="/guides/openround-quick-start.vtt"
              description="Learn the shortest path from your workspace to a reviewed, published Round."
              duration="1:05"
              id="quick-start"
              posterSrc="/guides/openround-quick-start-poster.jpg"
              title="Quick start: create your first Round"
              transcript={quickStartTranscript}
              tryHref={canEdit ? "/create?start=starters" : "/library"}
              tryLabel={canEdit ? "Try a starter Round" : "Open Library"}
              videoSrc="/guides/openround-quick-start.mp4"
            />
            <VideoGuide
              captionsSrc="/guides/openround-builder-guide.vtt"
              description="Tour the workspace, Round Builder, Presentation Builder, previews, and delivery paths."
              duration="2:55"
              id="round-builder-guide"
              posterSrc="/guides/openround-builder-guide-poster.jpg"
              title="Workspace and builder guide"
              transcript={builderGuideTranscript}
              tryHref={canEdit ? "/create?start=blank" : "/library"}
              tryLabel={canEdit ? "Start a blank Round" : "Open Library"}
              videoSrc="/guides/openround-builder-guide.mp4"
            />
          </div>
        ) : (
          <div className={styles.notice}>
            <strong>
              {roundBuilderAvailable
                ? "Use the enabled Round Builder"
                : "Use the classic Round workflow"}
            </strong>{" "}
            The combined videos are hidden because they demonstrate capabilities that are not all
            enabled for this workspace. Your available workflow remains fully supported.
            <div className={guideStyles.noticeAction}>
              <Link className="button" href={fallbackHref}>
                {canEdit
                  ? roundBuilderAvailable
                    ? "Create a Round"
                    : "Open Round dashboard"
                  : workspaceAvailable
                    ? "Open Library"
                    : "Open Round dashboard"}
              </Link>
            </div>
          </div>
        )}
      </section>

      <section className={styles.cardGrid}>
        <Link className={styles.quickCard} href={createHref}>
          <span className={styles.cardIcon}>01</span>
          <h3>Create your first Round</h3>
          <p>
            {roundBuilderAvailable
              ? "Choose a starter, trusted source, structural import, or blank Round."
              : "Open the dashboard, name a checkpoint set, and add the first question."}
          </p>
          <span className={styles.cardLink}>
            {roundBuilderAvailable ? "Open creation guide →" : "Open Round dashboard →"}
          </span>
        </Link>
        <Link className={styles.quickCard} href={libraryHref}>
          <span className={styles.cardIcon} data-tone="coral">
            02
          </span>
          <h3>{assignmentsAvailable ? "Host or assign" : "Host a Round"}</h3>
          <p>
            {assignmentsAvailable
              ? "Publish a reusable Round, then choose live delivery or account-free practice."
              : "Publish a reusable Round, then open a live room for account-free participation."}
          </p>
          <span className={styles.cardLink}>
            {workspaceAvailable ? "Open Library →" : "Choose a Round →"}
          </span>
        </Link>
        <Link className={styles.quickCard} href={resultsHref}>
          <span className={styles.cardIcon} data-tone="violet">
            03
          </span>
          <h3>Read the Recovery Story</h3>
          <p>Interpret initial understanding, interventions, rechecks, and unresolved concepts.</p>
          <span className={styles.cardLink}>
            {workspaceAvailable ? "Open Results →" : "Open Round dashboard →"}
          </span>
        </Link>
      </section>
    </>
  );
}
