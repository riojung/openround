import Link from "next/link";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export const metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <main className="shell page-main" id="main" lang="en-CA">
        <div className="section-heading">
          <p className="eyebrow">Simple launch pricing</p>
          <h1 style={{ fontSize: "clamp(2.8rem, 7vw, 5.4rem)" }}>
            Start free. Pay for room to grow.
          </h1>
          <p className="lead">
            Self-hosting remains free under Apache 2.0. Hosted plans cover operations and support.
          </p>
        </div>
        <div className="pricing-grid">
          <article className="card">
            <span className="status-pill">Free</span>
            <h2 style={{ marginTop: 28 }}>$0</h2>
            <p>
              Hosted Free: 20 participants, five published checkpoint sets, the complete Recovery
              Loop and Q&A, aggregate 30-day reports, and three authoring jobs monthly when enabled.
            </p>
            <Link className="button-quiet" href="/signin">
              Create an account
            </Link>
          </article>
          <article className="card">
            <span className="status-pill">Pro</span>
            <h2 style={{ marginTop: 28 }}>$15 USD monthly</h2>
            <p>
              Hosted Pro: 100 participants, unlimited checkpoint sets, cohosting, CSV/JSON/QTI,
              accountless follow-up, 100 authoring jobs, 365-day reports, and one contrast-checked
              workspace theme.
            </p>
            <Link className="button" href="/signin">
              Start with Free
            </Link>
          </article>
        </div>
        <p className="notice" style={{ marginTop: 28 }}>
          Pricing is a launch hypothesis. Taxes, live payment replay, and provider operations must
          be completed and validated before general availability.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
