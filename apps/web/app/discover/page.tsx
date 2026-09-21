"use client";

import Link from "next/link";
import { StarterGallery } from "../../components/workspace/starter-gallery";
import { WorkspacePage } from "../../components/workspace/workspace-shell";
import { useWorkspace } from "../../components/workspace/workspace-provider";
import hub from "../../components/workspace/workspace-hub.module.css";
import content from "../../components/workspace/workspace-content.module.css";

function PresentationCreateLink({ card = false }: { card?: boolean }) {
  const { productFeatures } = useWorkspace();
  if (!productFeatures?.presentations) return null;
  return card ? (
    <Link className={hub.quickCard} href="/create/presentation">
      <span className={hub.cardIcon} data-tone="violet">
        P
      </span>
      <h3>Engage a presentation</h3>
      <p>Add purposeful checks and audience voice to slides, meetings, and workshops.</p>
      <span className={hub.cardLink}>Choose a method →</span>
    </Link>
  ) : (
    <Link className={hub.heroPrimary} href="/create/presentation">
      Create a presentation
    </Link>
  );
}

function RoundSourceLink({ card = false }: { card?: boolean }) {
  const { productFeatures } = useWorkspace();
  if (!productFeatures?.builderV2) return null;
  return card ? (
    <Link className={hub.quickCard} href="/create?start=source">
      <span className={hub.cardIcon} data-tone="coral">
        S
      </span>
      <h3>Build from source material</h3>
      <p>Create reviewable proposals with citations from text, documents, or slides.</p>
      <span className={hub.cardLink}>Add a source →</span>
    </Link>
  ) : (
    <Link className={hub.heroSecondary} href="/create?start=source">
      Create from a source
    </Link>
  );
}

export default function DiscoverPage() {
  return (
    <WorkspacePage
      actions={
        <Link className="button-quiet" href="/templates">
          Browse all templates
        </Link>
      }
      description="Start with trusted OpenRound patterns and adapt them to your audience."
      eyebrow="Curated by OpenRound"
      requiredFeature="discover"
      title="Discover"
    >
      <section className={hub.hero}>
        <div className={hub.heroContent}>
          <p className={hub.heroEyebrow}>Presentation companion</p>
          <h2>Bring interaction into the material you already trust.</h2>
          <p>
            Begin with a Recovery-ready pattern, upload source material, or turn an existing deck
            into a focused interactive Round.
          </p>
          <div className={hub.heroActions}>
            <PresentationCreateLink />
            <RoundSourceLink />
          </div>
        </div>
      </section>

      <section className={hub.section}>
        <div className={hub.sectionHeading}>
          <div>
            <h2>Explore by learning moment</h2>
            <p>
              Purpose-led paths keep discovery useful without turning it into a public marketplace.
            </p>
          </div>
        </div>
        <div className={hub.cardGrid}>
          <Link className={hub.quickCard} href="/templates">
            <span className={hub.cardIcon}>D</span>
            <h3>Diagnose a concept</h3>
            <p>Surface uncertainty and likely misconceptions before choosing an intervention.</p>
            <span className={hub.cardLink}>Explore starters →</span>
          </Link>
          <PresentationCreateLink card />
          <RoundSourceLink card />
        </div>
      </section>

      <section className={`${hub.section} ${content.panel}`}>
        <div className={content.sectionHeader}>
          <div>
            <p className="eyebrow">First-party library</p>
            <h2>Recovery-ready starters</h2>
            <p>Use one as an independent draft, then make every prompt and recheck your own.</p>
          </div>
          <Link href="/templates">See all</Link>
        </div>
        <StarterGallery compact />
      </section>
    </WorkspacePage>
  );
}
