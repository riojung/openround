import { renderToStaticMarkup } from "react-dom/server";
import type { RecoveryPackLiveCard } from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  RecoveryPackCardPicker,
  RecoveryPackLiveCardView,
  recoveryPackCardKey,
} from "./recovery-pack-live-card";

const card: RecoveryPackLiveCard = {
  reference: {
    insertionId: "insertion",
    packId: "pack",
    packVersionId: "version",
    packVersion: 2,
    contentHash: "hash",
    cardId: "card",
  },
  title: "Contrast the examples",
  body: '<script>alert("body")</script>\nUse the two comparisons.',
  citations: [
    {
      sourceName: "<img src=x>",
      sourceDigest: "a".repeat(64),
      locator: "p. 4",
      excerpt: "One reference < another",
    },
  ],
};

describe("live Recovery Pack card", () => {
  it("renders selected content and citations as escaped, accessible plaintext", () => {
    const markup = renderToStaticMarkup(<RecoveryPackLiveCardView card={card} />);
    expect(markup).toContain('aria-label="Active Recovery Pack card"');
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("&lt;img src=x&gt;");
    expect(markup).toContain("One reference &lt; another");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("version 2");
  });
  it("requires an explicit selection and never previews every available card body", () => {
    const markup = renderToStaticMarkup(
      <RecoveryPackCardPicker cards={[card]} disabled={false} onStart={() => undefined} />,
    );
    expect(markup).toContain("Choose a card to preview");
    expect(markup).toContain("Contrast the examples");
    expect(markup).not.toContain("Use the two comparisons.");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(recoveryPackCardKey(card)).toBe("insertion:card");
    expect(
      renderToStaticMarkup(
        <RecoveryPackCardPicker cards={[]} disabled={false} onStart={() => undefined} />,
      ),
    ).toBe("");
  });
});
