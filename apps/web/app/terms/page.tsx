import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="shell page-main legal-copy" id="main" lang="en-CA">
        <p className="eyebrow">Draft for legal review</p>
        <h1 style={{ fontSize: "clamp(2.8rem, 7vw, 5rem)" }}>Terms of service</h1>
        <p>
          This implementation includes a visible placeholder so legal approval remains an explicit
          launch gate. Operators must replace it with jurisdiction-specific terms, acceptable-use
          rules, content licensing, support terms, payment terms, and liability provisions before
          accepting public users or payment.
        </p>
        <h2>Community edition</h2>
        <p>
          The source code is distributed under Apache License 2.0. Hosting, content moderation,
          privacy compliance, backups, and support are the self-hosting operator’s responsibility.
        </p>
        <h2>Hosted service</h2>
        <p>
          Hosted plan limits are enforced by the server. Browser redirects do not grant paid access;
          verified billing events control entitlements.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
