import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createdPackPractice,
  packPracticeIds,
  publishedPracticePack,
} from "../../test-utils/recovery-pack-practice";
import { PackPracticeAction } from "./pack-practice-action";
import { PackPracticeAttribution } from "./pack-practice-attribution";
import { PracticeLinkReceipt } from "./practice-link-receipt";

describe("Recovery Pack practice presentation", () => {
  const gates = {
    recoveryPacksEnabled: true,
    practiceAssignmentsEnabled: true,
    canEdit: true,
    followups: true,
  };

  it("links only the exact published delayed probe and disables missing-probe practice", () => {
    const ready = renderToStaticMarkup(
      <PackPracticeAction
        packId={packPracticeIds.pack}
        version={publishedPracticePack()}
        {...gates}
      />,
    );
    expect(ready).toContain(
      `/recovery-packs/${packPracticeIds.pack}/assign?version=${packPracticeIds.version}`,
    );
    expect(ready).not.toContain("Facilitator guidance");
    expect(ready).not.toContain("Diagnostic only");
    const missing = renderToStaticMarkup(
      <PackPracticeAction
        packId={packPracticeIds.pack}
        version={publishedPracticePack(false)}
        {...gates}
      />,
    );
    expect(missing).toContain("no delayed probe");
    expect(missing).toContain("not substitutes");
    expect(missing).toContain('disabled=""');
    expect(missing).not.toContain("/assign?");
  });

  it("keeps receipt private links readable independently of source deletion or gate pause", () => {
    const created = createdPackPractice();
    const markup = renderToStaticMarkup(<PracticeLinkReceipt created={created} />);
    expect(markup).toContain("Save your private links");
    expect(markup).toContain("one frozen delayed probe");
    expect(markup).toContain("stores only token hashes");
    expect(markup).toContain("Download links CSV");
    expect(markup).toContain(created.genericUrl);
    expect(markup).toContain(created.personalAccess[0]!.url);
    expect(markup).toContain(`/practice/${created.followup.id}`);
    expect(markup).not.toContain("accessSeed");
    expect(markup).not.toContain("Diagnostic only");
    expect(markup).not.toContain("Facilitator guidance");
  });

  it("renders frozen Pack history context and a library link without source bodies or answers", () => {
    const source = createdPackPractice().followup.recoveryPackSource!;
    const markup = renderToStaticMarkup(<PackPracticeAttribution source={source} />);
    expect(markup).toContain("Recovery Pack delayed probe");
    expect(markup).toContain("Halves &lt; whole");
    expect(markup).toContain("published version 2");
    expect(markup).toContain('href="/recovery-packs"');
    expect(markup).not.toContain(source.contentHash);
    expect(markup).not.toContain(source.sourceItemId);
    expect(markup).not.toContain("correctValue");
    expect(renderToStaticMarkup(<PackPracticeAttribution source={null} />)).toBe("");
  });

  it.each(["recoveryPacksEnabled", "practiceAssignmentsEnabled", "canEdit", "followups"] as const)(
    "does not offer a new assignment while %s is false",
    (gate) => {
      const markup = renderToStaticMarkup(
        <PackPracticeAction
          packId={packPracticeIds.pack}
          version={publishedPracticePack()}
          {...gates}
          {...{ [gate]: false }}
        />,
      );
      expect(markup).toContain('disabled=""');
      expect(markup).not.toContain("/assign?");
    },
  );
});
