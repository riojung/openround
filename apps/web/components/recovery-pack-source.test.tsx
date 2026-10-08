import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { sourcePackFixtures } from "../test-utils/recovery-pack-source";
import {
  PackSourceContentView,
  RecoveryPackSourceProposalPanel,
  RecoveryPackSourceReviewPanel,
} from "./recovery-pack-source";

describe("source Pack review components", () => {
  it("shows every item and global citation, full answer keys, and source excerpts as wrapping plaintext", () => {
    const { draft } = sourcePackFixtures();
    const markup = renderToStaticMarkup(<PackSourceContentView draft={draft} />);
    for (const visible of [
      "Source diagnostic",
      "Source linked recheck",
      "Private explanation",
      "Facilitator guidance",
      "Global Pack citations",
      "Accepted value: 4",
      "Source digest:",
      "paragraph 1",
    ])
      expect(markup).toContain(visible);
    expect(markup.match(/Divide a whole into two equal groups/g)).toHaveLength(4);
    expect(markup).toContain("&lt;script&gt;plain text&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("min-width:0;overflow-wrap:anywhere");
    // Proposal and saved review can be open together: nested items must not
    // produce duplicate landmarks with the same source-item names.
    expect(markup.match(/<section role="group"/g)).toHaveLength(3);
  });

  it.each(["dirty", "viewer", "paused", "unchecked"])(
    "blocks %s approval while the saved source stays readable",
    (mode) => {
      const { pack, draft } = sourcePackFixtures();
      const markup = renderToStaticMarkup(
        <RecoveryPackSourceReviewPanel
          pack={pack}
          draft={draft}
          dirty={mode === "dirty"}
          invalidated={false}
          canEdit={mode !== "viewer" && mode !== "paused"}
          busy={false}
          contentChecked={false}
          citationsChecked={false}
          onContentChecked={vi.fn()}
          onCitationsChecked={vi.fn()}
          onApprove={vi.fn()}
        />,
      );
      expect(markup).toContain("Review complete Pack content and every citation");
      expect(markup).toContain(
        "I reviewed the full saved content, answer keys, and facilitator guidance.",
      );
      expect(markup).toContain("I verified every citation and excerpt against the source.");
      expect(markup).toMatch(/disabled=""[^>]*>Approve saved content and citations/);
      expect(markup).not.toContain('checked=""');
      if (mode === "dirty") expect(markup).toContain("Save your edits before reviewing");
      if (mode === "paused" || mode === "viewer")
        expect(markup).toContain("paused Pack authoring prevents approval");
    },
  );

  it("invalidates a prior approval immediately on edits, and keeps manual Pack behavior unchanged", () => {
    const { approvedPack, draft, pack } = sourcePackFixtures();
    const props = {
      draft,
      dirty: false,
      invalidated: false,
      canEdit: true,
      busy: false,
      contentChecked: false,
      citationsChecked: false,
      onContentChecked: vi.fn(),
      onCitationsChecked: vi.fn(),
      onApprove: vi.fn(),
    };
    expect(
      renderToStaticMarkup(<RecoveryPackSourceReviewPanel {...props} pack={approvedPack} />),
    ).toContain("has content and citation approval");
    expect(
      renderToStaticMarkup(
        <RecoveryPackSourceReviewPanel {...props} pack={approvedPack} invalidated />,
      ),
    ).toContain("needs content and citation approval");
    expect(
      renderToStaticMarkup(<RecoveryPackSourceReviewPanel {...props} pack={approvedPack} dirty />),
    ).toContain("Save your edits");
    const manual = { ...pack };
    delete manual.sourceReview;
    expect(renderToStaticMarkup(<RecoveryPackSourceReviewPanel {...props} pack={manual} />)).toBe(
      "",
    );
  });

  it("fetches no proposal on render and exposes a read-only review action for viewers", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const { job } = sourcePackFixtures();
    const target = {
      disabled: false,
      beforeCreate: vi.fn(),
      onCreated: vi.fn(),
      onBusyChange: vi.fn(),
    };
    const markup = renderToStaticMarkup(
      <RecoveryPackSourceProposalPanel job={job} canEdit={false} target={target} />,
    );
    expect(markup).toContain("Review Pack source proposal");
    expect(markup).not.toContain("Create source Pack draft</button>");
    expect(markup).toContain('role="status" aria-live="polite"');
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});
