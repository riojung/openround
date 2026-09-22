import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";

export const metadata = { title: "Status" };

export default function StatusPage() {
  return (
    <>
      <SiteHeader />
      <main className="shell page-main" id="main" lang="en-CA">
        <p className="eyebrow">Service status</p>
        <h1 style={{ fontSize: "clamp(2.8rem, 7vw, 5rem)" }}>All systems are in development.</h1>
        <div className="panel" style={{ maxWidth: 720 }}>
          <span className="status-pill">Pre-release</span>
          <p style={{ marginTop: 20, marginBottom: 0 }}>
            Connect this page to an independent status provider before paid beta. The status surface
            must remain available during an application outage.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
