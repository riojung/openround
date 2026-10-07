import type { FollowupSnapshot } from "@openround/contracts";

export function FollowupInterventionCard({
  intervention,
  busy,
  onContinue,
}: {
  intervention: NonNullable<FollowupSnapshot["intervention"]>;
  busy: boolean;
  onContinue: () => void;
}) {
  const { card } = intervention;
  return (
    <section
      className="live-card"
      aria-labelledby="followup-intervention-heading"
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <p className="eyebrow">
        Recovery guidance · card {intervention.index + 1} of {intervention.count}
      </p>
      <h1 id="followup-intervention-heading" tabIndex={-1} lang="">
        {card.title}
      </h1>
      <p lang="" style={{ whiteSpace: "pre-wrap" }}>
        {card.body}
      </p>
      {card.citations.length ? (
        <ul aria-label="Card citations">
          {card.citations.map((citation, index) => (
            <li key={index} lang="">
              {citation.sourceName}, {citation.locator}
              {citation.excerpt ? ` — ${citation.excerpt}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <p>No countdown while you review this guidance. Continue when you are ready.</p>
      <button className="button" disabled={busy} onClick={onContinue} type="button">
        {intervention.index + 1 < intervention.count ? "Next guidance card" : "Continue to recheck"}
      </button>
    </section>
  );
}
