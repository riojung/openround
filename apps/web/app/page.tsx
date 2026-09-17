import { HomeCreatorActions } from "../components/home-creator-actions";
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
              Ask everyone, diagnose what did not land, intervene, and recheck whether understanding
              recovered—without participant accounts.
            </p>
            <HomeCreatorActions />
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
              <h2>Ask → diagnose → intervene → recheck → prove.</h2>
              <p className="lead">One calm loop for evidence while there is still time to act.</p>
            </div>
            <div className="feature-grid">
              <article className="card">
                <span className="feature-number">1</span>
                <h3>Ask and diagnose</h3>
                <p>
                  Use six response types, confidence, and misconception signals to see not just who
                  was right, but where uncertainty remains.
                </p>
              </article>
              <article className="card">
                <span className="feature-number">2</span>
                <h3>Intervene and recheck</h3>
                <p>
                  Explain, show an example, or invite peer discussion, then run a linked recheck
                  without interrupting the room with account setup.
                </p>
              </article>
              <article className="card">
                <span className="feature-number">3</span>
                <h3>Prove carefully</h3>
                <p>
                  Separate linked recovery from revote improvement, find unresolved concepts, and
                  create an accountless follow-up with honest evidence limits.
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
