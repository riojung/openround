import Link from "next/link";
import { WorkspacePage } from "../../components/workspace/workspace-shell";
import styles from "../../components/workspace/workspace-hub.module.css";

export default function HelpPage() {
  return (
    <WorkspacePage
      description="Short paths to the workflow, service health, and workspace controls."
      eyebrow="Guidance"
      title="Help centre"
    >
      <section className={styles.cardGrid}>
        <Link className={styles.quickCard} href="/create">
          <span className={styles.cardIcon}>01</span>
          <h3>Create your first Round</h3>
          <p>Choose a starter, trusted source, structured import, or blank Round.</p>
          <span className={styles.cardLink}>Open creation guide →</span>
        </Link>
        <Link className={styles.quickCard} href="/library">
          <span className={styles.cardIcon} data-tone="coral">
            02
          </span>
          <h3>Host or assign</h3>
          <p>Publish a reusable Round, then choose live delivery or account-free practice.</p>
          <span className={styles.cardLink}>Open Library →</span>
        </Link>
        <Link className={styles.quickCard} href="/results">
          <span className={styles.cardIcon} data-tone="violet">
            03
          </span>
          <h3>Read the Recovery Story</h3>
          <p>Interpret initial understanding, interventions, rechecks, and unresolved concepts.</p>
          <span className={styles.cardLink}>Open Results →</span>
        </Link>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Workspace support</h2>
            <p>Check service health or review the settings that control privacy and access.</p>
          </div>
        </div>
        <div className={styles.quickGrid}>
          <Link className={styles.featureCard} href="/status">
            <small>Operations</small>
            <h3>Service status</h3>
            <p>Check the current availability of OpenRound services.</p>
            <span className={styles.cardLink}>View status →</span>
          </Link>
          <Link className={styles.featureCard} href="/account">
            <small>Administration</small>
            <h3>Workspace settings</h3>
            <p>Manage roles, integrations, retention, billing, and account data.</p>
            <span className={styles.cardLink}>Open settings →</span>
          </Link>
          <Link className={styles.featureCard} href="/privacy">
            <small>Trust</small>
            <h3>Privacy</h3>
            <p>Review how OpenRound handles session-scoped learning data.</p>
            <span className={styles.cardLink}>Read privacy information →</span>
          </Link>
        </div>
      </section>
    </WorkspacePage>
  );
}
