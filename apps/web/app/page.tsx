"use client";

import { HomeCreatorActions } from "../components/home-creator-actions";
import { JoinCodeForm } from "../components/join-code-form";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";
import { useLocale } from "../components/locale-provider";

export default function HomePage() {
  const { t } = useLocale();
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="shell hero">
          <div>
            <p className="eyebrow">{t("delivery.landing.eyebrow")}</p>
            <h1>{t("delivery.landing.title")}</h1>
            <p className="lead">{t("delivery.landing.description")}</p>
            <HomeCreatorActions />
          </div>
          <aside className="join-card" aria-labelledby="join-title">
            <p className="eyebrow">{t("delivery.landing.participantEntry")}</p>
            <h2 id="join-title">{t("delivery.landing.joinTitle")}</h2>
            <p className="muted">{t("delivery.landing.joinDescription")}</p>
            <JoinCodeForm compact />
          </aside>
        </section>

        <section className="section" id="how-it-works">
          <div className="shell">
            <div className="section-heading">
              <p className="eyebrow">{t("delivery.landing.loopEyebrow")}</p>
              <h2>{t("delivery.landing.loopTitle")}</h2>
              <p className="lead">{t("delivery.landing.loopDescription")}</p>
            </div>
            <div className="feature-grid">
              <article className="card">
                <span className="feature-number">1</span>
                <h3>{t("delivery.landing.askTitle")}</h3>
                <p>{t("delivery.landing.askDescription")}</p>
              </article>
              <article className="card">
                <span className="feature-number">2</span>
                <h3>{t("delivery.landing.interveneTitle")}</h3>
                <p>{t("delivery.landing.interveneDescription")}</p>
              </article>
              <article className="card">
                <span className="feature-number">3</span>
                <h3>{t("delivery.landing.proveTitle")}</h3>
                <p>{t("delivery.landing.proveDescription")}</p>
              </article>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
