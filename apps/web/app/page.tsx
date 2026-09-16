import Link from "next/link";
import { JoinCodeForm } from "../components/join-code-form";
import { SiteFooter } from "../components/site-footer";
import { SiteHeader } from "../components/site-header";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="shell hero">
          <div>
            <p className="eyebrow">Live comprehension without the noise</p>
            <h1>See what landed while it still matters.</h1>
            <p className="lead">
              OpenRound gives classrooms and teams a dependable, low-friction way to ask, answer,
              recover, and follow up—without participant accounts.
            </p>
            <div className="hero-actions">
              <Link className="button" href="/signin">
                Create a free quiz
              </Link>
              <Link className="button-quiet" href="#how-it-works">
                See how it works
              </Link>
            </div>
          </div>
          <aside className="join-card" aria-labelledby="join-title">
            <p className="eyebrow">Participant entry</p>
            <h2 id="join-title">Join a live round</h2>
            <p className="muted">No account needed. Enter the code shown by your facilitator.</p>
            <JoinCodeForm compact />
          </aside>
        </section>

        <section className="section" id="how-it-works">
          <div className="shell">
            <div className="section-heading">
              <p className="eyebrow">A clear operating loop</p>
              <h2>From question to useful evidence.</h2>
              <p className="lead">Every screen is designed for the job in front of it.</p>
            </div>
            <div className="feature-grid">
              <article className="card">
                <span className="feature-number">1</span>
                <h3>Prepare simply</h3>
                <p>
                  Create focused multiple-choice checks, review the draft, and publish a frozen
                  version.
                </p>
              </article>
              <article className="card">
                <span className="feature-number">2</span>
                <h3>Run calmly</h3>
                <p>
                  Share one code, control the pace, recover from interruptions, and keep timing
                  fair.
                </p>
              </article>
              <article className="card">
                <span className="feature-number">3</span>
                <h3>Follow up</h3>
                <p>
                  Find difficult questions and people who may need support, then export the
                  evidence.
                </p>
              </article>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
