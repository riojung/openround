import type { SessionSnapshot } from "@openround/contracts";

export function ResponseDistributionView({
  distribution,
}: {
  distribution: NonNullable<SessionSnapshot["responseDistribution"]>;
}) {
  if (distribution.kind === "numeric") {
    const correctPercent = Math.round((distribution.correct / distribution.respondents) * 100);
    return (
      <section aria-label="Post-lock response distribution" className="distribution-card">
        <strong>Post-lock distribution</strong>
        <p>
          {distribution.correct} correct · {distribution.incorrect} incorrect · {correctPercent}%
          correct
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Post-lock response distribution" className="distribution-card">
      <strong>Post-lock distribution</strong>
      <p className="muted">
        {distribution.respondents} respondents
        {distribution.kind === "choice" && distribution.percentBasis === "respondents"
          ? " · percentages are percent of respondents and may total over 100%"
          : ""}
      </p>
      <ul className="distribution-list">
        {distribution.buckets.map((bucket) => (
          <li key={bucket.value}>
            <span>{bucket.label}</span>
            <span aria-hidden="true" className="distribution-track">
              <span style={{ width: `${bucket.percent}%` }} />
            </span>
            <strong>
              {bucket.count} · {bucket.percent}%
            </strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
