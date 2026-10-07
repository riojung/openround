import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FollowupInterventionCard } from "./followup-intervention-card";

describe("active followup intervention card", () => {
  const intervention = {
    index: 0,
    count: 2,
    card: {
      id: "active-card",
      title: "Review < evidence",
      body: "<script>window.privateCard=true</script>\nUse observed data.",
      citations: [
        {
          sourceName: "Frozen notes",
          sourceDigest: "a".repeat(64),
          locator: "p. 3",
          excerpt: "Observed evidence",
        },
      ],
    },
  };
  it("renders one plaintext card, its citations, focus target, and no response/countdown controls", () => {
    const markup = renderToStaticMarkup(
      <FollowupInterventionCard
        intervention={intervention}
        busy={false}
        onContinue={() => undefined}
      />,
    );
    expect(markup).toContain("card 1 of 2");
    expect(markup).toContain("Review &lt; evidence");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("Frozen notes, p. 3");
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("min-width:0;overflow-wrap:anywhere");
    expect(markup).toContain("No countdown");
    expect(markup).toContain("Next guidance card");
    expect(markup).not.toContain("Submit response");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("deadline");
  });
  it("fences Continue and names the recheck only on the final active card", () => {
    const markup = renderToStaticMarkup(
      <FollowupInterventionCard
        intervention={{ ...intervention, index: 1 }}
        busy
        onContinue={() => undefined}
      />,
    );
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Continue to recheck");
    expect(markup).not.toContain("Next guidance card");
  });
});
