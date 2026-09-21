import Link from "next/link";
import { WorkspacePage } from "../../components/workspace/workspace-shell";
import styles from "../../components/workspace/workspace-hub.module.css";
import { HelpGuidance } from "./help-guidance";

export default function HelpPage() {
  return (
    <WorkspacePage
      description="Short paths to the workflow, service health, and workspace controls."
      eyebrow="Guidance"
      requireBeta={false}
      title="Help centre"
    >
      <HelpGuidance />

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
