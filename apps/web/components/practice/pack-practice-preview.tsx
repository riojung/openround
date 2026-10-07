import type { PackPracticeMode, PublishedPracticePack } from "../../lib/recovery-pack-practice";

export function PackPracticePreview({
  version,
  mode,
}: {
  version: PublishedPracticePack;
  mode: PackPracticeMode;
}) {
  return mode === "full_sequence" ? (
    <section
      aria-label="Frozen full-sequence preview"
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h3>Diagnostic</h3>
      <p lang="">{version.content.diagnostic.prompt}</p>
      <h3>Intervention cards in order</h3>
      <ol>
        {version.content.interventions.map((card) => (
          <li key={card.id}>
            <h4 lang="">{card.title}</h4>
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
          </li>
        ))}
      </ol>
      <h3>Linked recheck</h3>
      <p lang="">{version.content.recheck.prompt}</p>
      <p>
        The participant sees only the active checkpoint or card. Cards have no countdown. This
        sequence does not include the optional delayed probe or form a delayed recovery trail.
      </p>
    </section>
  ) : (
    <>
      {version.content.delayedProbe ? <p lang="">{version.content.delayedProbe.prompt}</p> : null}
      <p>
        Only this published delayed probe is copied. Draft edits and future Pack changes do not
        update the assignment.
      </p>
    </>
  );
}
