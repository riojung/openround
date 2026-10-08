"use client";

import Link from "next/link";
import { WorkspacePage } from "../../components/workspace/workspace-shell";
import { useWorkspace } from "../../components/workspace/workspace-provider";
import {
  helpFeatureGuides,
  helpGuideAction,
  helpGuideAvailable,
  helpGuideTopics,
  helpGuideVideoLink,
  type HelpFeatureGuide,
} from "../../lib/help-feature-guides";
import { GuideCover } from "./guide-cover";
import styles from "./feature-guides.module.css";

export function FeatureGuidePage({ guide }: { guide: HelpFeatureGuide }) {
  return (
    <WorkspacePage
      title={guide.title}
      titleLanguage="en-CA"
      eyebrow="Written feature guide"
      description={guide.summary}
      requireBeta={false}
      translationLevel="none"
    >
      <FeatureGuideContent guide={guide} />
    </WorkspacePage>
  );
}

export function FeatureGuideContent({ guide }: { guide: HelpFeatureGuide }) {
  const { productFeatures, canEdit } = useWorkspace();
  const available = helpGuideAvailable(guide, productFeatures);
  const action = helpGuideAction(guide, productFeatures, canEdit);
  const video = helpGuideVideoLink(guide, productFeatures);
  const related = helpFeatureGuides
    .filter((item) => item.topic === guide.topic && item.id !== guide.id)
    .slice(0, 3);

  return (
    <article className={styles.article} lang="en-CA">
      <nav className={styles.breadcrumb} aria-label="Guide navigation">
        <Link href="/help#feature-guides">All feature guides</Link>
        <span aria-hidden="true">/</span>
        <span>{helpGuideTopics[guide.topic]}</span>
      </nav>
      <div className={styles.detailCover}>
        <GuideCover guide={guide} />
        <div>
          <p className="eyebrow">{helpGuideTopics[guide.topic]}</p>
          <p>
            <strong>For:</strong> {guide.audience}
          </p>
          <p>{guide.steps.length} steps · English written guide</p>
        </div>
      </div>
      {!available ? (
        <p className={styles.notice}>
          This optional feature is not enabled in this workspace. You can read the guide, but its
          feature action is unavailable. Ask your workspace owner or operator about access; a guide
          does not bypass rollout gates.
        </p>
      ) : null}
      {!canEdit && guide.action.editorOnly ? (
        <p className={styles.notice}>
          Your workspace role is read-only. You can learn this workflow here; an owner or editor
          must perform content changes.
        </p>
      ) : null}
      <nav className={styles.contents} aria-label="On this page">
        <a href="#before-you-start">Before you start</a>
        <a href="#steps">Steps</a>
        <a href="#success-check">Success check</a>
        <a href="#good-to-know">Good to know</a>
        <a href="#troubleshooting">Troubleshooting</a>
      </nav>
      <section
        id="before-you-start"
        className={styles.detailSection}
        aria-labelledby="before-title"
      >
        <h2 id="before-title">Before you start</h2>
        <ul>
          {guide.before.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section id="steps" className={styles.detailSection} aria-labelledby="steps-title">
        <h2 id="steps-title">Step-by-step guide</h2>
        <ol className={styles.steps}>
          {guide.steps.map((step) => (
            <li key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>
      <section id="success-check" className={styles.success} aria-labelledby="success-title">
        <h2 id="success-title">Success check</h2>
        <p>{guide.check}</p>
      </section>
      <section id="good-to-know" className={styles.detailSection} aria-labelledby="notes-title">
        <h2 id="notes-title">Good to know</h2>
        <ul>
          {guide.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
      <section
        id="troubleshooting"
        className={styles.detailSection}
        aria-labelledby="troubleshooting-title"
      >
        <h2 id="troubleshooting-title">Troubleshooting</h2>
        <dl className={styles.troubleshooting}>
          {guide.troubleshooting.map((item) => (
            <div key={item.symptom}>
              <dt>{item.symptom}</dt>
              <dd>{item.fix}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className={styles.actions}>
        {action ? (
          <Link className="button" href={action.href}>
            {action.label}
          </Link>
        ) : null}
        {video ? (
          <Link className="button-quiet" href={video.href}>
            Watch related chapter: {video.title}
          </Link>
        ) : null}
        <Link className="button-quiet" href="/help#feature-guides">
          Back to all guides
        </Link>
      </div>
      {related.length ? (
        <section className={styles.detailSection} aria-labelledby="related-title">
          <h2 id="related-title">Related guides</h2>
          <ul className={styles.related}>
            {related.map((item) => (
              <li key={item.id}>
                <Link href={`/help/${item.id}`}>{item.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
