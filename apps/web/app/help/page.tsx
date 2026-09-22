"use client";

import Link from "next/link";
import { useLocale } from "../../components/locale-provider";
import { WorkspacePage } from "../../components/workspace/workspace-shell";
import styles from "../../components/workspace/workspace-hub.module.css";
import { HelpGuidance } from "./help-guidance";

export default function HelpPage() {
  const { t } = useLocale();
  return (
    <WorkspacePage
      description={t("page.help.description")}
      eyebrow={t("page.help.eyebrow")}
      requireBeta={false}
      title={t("page.help.title")}
      translationLevel="full"
    >
      <HelpGuidance />

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>{t("pages.help.support.title")}</h2>
            <p>{t("pages.help.support.description")}</p>
          </div>
        </div>
        <div className={styles.quickGrid}>
          <Link className={styles.featureCard} href="/status">
            <small>{t("pages.help.support.operations")}</small>
            <h3>{t("pages.help.support.statusTitle")}</h3>
            <p>{t("pages.help.support.statusDescription")}</p>
            <span className={styles.cardLink}>{t("pages.help.support.viewStatus")} →</span>
          </Link>
          <Link className={styles.featureCard} href="/account">
            <small>{t("pages.help.support.administration")}</small>
            <h3>{t("pages.help.support.settingsTitle")}</h3>
            <p>{t("pages.help.support.settingsDescription")}</p>
            <span className={styles.cardLink}>{t("pages.help.support.openSettings")} →</span>
          </Link>
          <Link className={styles.featureCard} href="/privacy">
            <small>{t("pages.help.support.trust")}</small>
            <h3>{t("pages.help.support.privacyTitle")}</h3>
            <p>{t("pages.help.support.privacyDescription")}</p>
            <span className={styles.cardLink}>{t("pages.help.support.readPrivacy")} →</span>
          </Link>
        </div>
      </section>
    </WorkspacePage>
  );
}
