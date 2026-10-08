import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../../test-utils/english-locale";
import {
  CompanionRecoveryCardPicker,
  CompanionRecoveryPackPicker,
} from "./companion-recovery-packs";

vi.mock("next/navigation", () => ({
  usePathname: () => "/presentation-session/session/companion",
}));

const pack = {
  packId: "pack",
  packVersionId: "version",
  packVersion: 2,
  title: "Published <text-only> Pack",
};
const card = {
  title: "Compare the <examples>",
  reference: {
    insertionId: "insertion",
    packId: "pack",
    packVersionId: "version",
    packVersion: 2,
    contentHash: "hash",
    cardId: "card",
  },
  body: "UNSELECTED CARD BODY MUST STAY HIDDEN",
  citations: [{ sourceName: "UNSELECTED SOURCE MUST STAY HIDDEN" }],
};

describe("Companion metadata-only Recovery Pack controls", () => {
  it("shows published title/version and requires an explicit insertion selection", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <CompanionRecoveryPackPicker
          catalog={{ packs: [pack] }}
          loading={false}
          error=""
          disabled={false}
          onReload={vi.fn()}
          onInsert={vi.fn()}
        />,
      ),
    );
    expect(markup).toContain("Published &lt;text-only&gt; Pack");
    expect(markup).toContain("version 2");
    expect(markup).toContain("Choose a published text-only Pack");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Insert and start Pack<\/button>/);
    expect(markup).not.toContain("correct");
  });

  it("disables stale or unavailable insertion and handles empty catalogs", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <CompanionRecoveryPackPicker
          catalog={{ packs: [] }}
          loading={false}
          error=""
          disabled={true}
          onReload={vi.fn()}
          onInsert={vi.fn()}
        />,
      ),
    );
    expect(markup).toContain("No published text-only Packs are available.");
    expect(markup).toContain("eligible pause between blocks");
    expect(markup).toMatch(/<select[^>]*disabled=""/);
  });

  it("offers title-only card choices with no unselected body, citations, or host preview", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <CompanionRecoveryCardPicker cards={[card]} disabled={false} onStart={vi.fn()} />,
      ),
    );
    expect(markup).toContain("Compare the &lt;examples&gt;");
    expect(markup).toContain("Choose a card");
    expect(markup).toContain("Explain with selected card");
    expect(markup).toContain("Work an example with selected card");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).not.toContain(card.body);
    expect(markup).not.toContain(card.citations[0]!.sourceName);
    expect(markup).not.toContain("Host-only preview");
  });

  it("disables all card controls while another action is pending", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(
        <CompanionRecoveryCardPicker cards={[card]} disabled={true} onStart={vi.fn()} />,
      ),
    );
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
    expect(
      renderToStaticMarkup(
        withEnglishLocale(
          <CompanionRecoveryCardPicker cards={[]} disabled={false} onStart={vi.fn()} />,
        ),
      ),
    ).toBe("");
  });
});
