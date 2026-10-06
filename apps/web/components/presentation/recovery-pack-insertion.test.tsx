import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RecoveryPackContentSchema,
  recoveryPackContentHash,
  type RecoveryPackInsertion,
} from "@openround/contracts";
import { describe, expect, it } from "vitest";
import {
  RecoveryPackPresentationPicker,
  RecoveryPackPresentationReferences,
} from "./recovery-pack-insertion";

function insertion(): RecoveryPackInsertion {
  const recheckId = randomUUID();
  const diagnostic = {
    id: randomUUID(),
    type: "numeric",
    prompt: "What is half of 8?",
    correctValue: "4",
    tolerance: "0",
    unit: null,
    purpose: "diagnostic",
    delivery: "main",
    confidence: "off",
    conceptKeys: ["halves"],
    linkedRecheckQuestionId: recheckId,
    timeLimitSeconds: 30,
    basePoints: 1_000,
    explanation: "Divide by two.",
    mediaId: null,
    mediaAlt: null,
  };
  const content = RecoveryPackContentSchema.parse({
    schemaVersion: 1,
    title: "Half < whole",
    description: "",
    diagnostic,
    recheck: {
      ...diagnostic,
      id: recheckId,
      prompt: "What is half of 12?",
      correctValue: "6",
      delivery: "recheck",
      linkedRecheckQuestionId: null,
    },
    interventions: [
      {
        id: randomUUID(),
        title: "Compare < quantities",
        body: '<script>alert("card")</script>\nDraw two equal groups.',
        citations: [
          {
            sourceName: "Teacher < notes",
            sourceDigest: "a".repeat(64),
            locator: "p. 2",
            excerpt: "Equal groups",
          },
        ],
      },
    ],
    delayedProbe: null,
    conceptKeys: ["halves"],
    misconceptionKeys: [],
    citations: [],
  });
  return {
    id: randomUUID(),
    packId: randomUUID(),
    packVersionId: randomUUID(),
    packVersion: 2,
    contentHash: recoveryPackContentHash(content),
    diagnosticQuestionId: randomUUID(),
    recheckQuestionId: randomUUID(),
    originalContent: content,
  };
}

describe("Presentation Recovery Pack authoring", () => {
  it("renders frozen plaintext references without fetching the source or exposing checkpoint answers", () => {
    const markup = renderToStaticMarkup(
      <RecoveryPackPresentationReferences insertions={[insertion()]} />,
    );
    expect(markup).toContain('aria-label="Recovery Pack facilitator references"');
    expect(markup).toContain("Half &lt; whole");
    expect(markup).toContain('<h2 lang="">Compare &lt; quantities</h2>');
    expect(markup).toContain("version 2");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("Teacher &lt; notes, p. 2");
    expect(markup).toContain("Equal groups");
    expect(markup).toContain("Presentation live card playback is not available yet");
    expect(markup).not.toContain("What is half of 8?");
    expect(renderToStaticMarkup(<RecoveryPackPresentationReferences insertions={[]} />)).toBe("");
  });

  it("reads accepted update context while retaining the original inserted snapshot", () => {
    const original = insertion();
    const acceptedContent = {
      ...original.originalContent,
      title: "Accepted newer Pack",
      interventions: original.originalContent.interventions.map((card) => ({
        ...card,
        body: "New accepted guidance",
      })),
    };
    const markup = renderToStaticMarkup(
      <RecoveryPackPresentationReferences
        insertions={[
          {
            ...original,
            updateBaseline: {
              packVersionId: randomUUID(),
              packVersion: 3,
              contentHash: recoveryPackContentHash(acceptedContent),
              content: acceptedContent,
            },
          },
        ]}
      />,
    );
    expect(markup).toContain("Accepted newer Pack");
    expect(markup).toContain("version 3");
    expect(markup).toContain("New accepted guidance");
    expect(markup).not.toContain("Draw two equal groups");
    expect(original.originalContent.title).toBe("Half < whole");
  });

  it("keeps initial insertion unavailable until a published version has loaded", () => {
    const markup = renderToStaticMarkup(
      <RecoveryPackPresentationPicker
        busy={false}
        error=""
        retryVersionId={null}
        afterSelectedBlock
        onInsert={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("Loading published Packs");
    expect(markup).toContain("after the selected block");
    expect(markup).toContain('<button disabled="" type="button">Insert Pack checkpoints</button>');
  });

  it("offers only the retained operation on a lost acknowledgement and prevents cancellation", () => {
    const markup = renderToStaticMarkup(
      <RecoveryPackPresentationPicker
        busy={false}
        error="Network failure"
        retryVersionId={randomUUID()}
        afterSelectedBlock={false}
        onInsert={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(markup).toContain("Retry Pack insertion");
    expect(markup).toContain("without creating another copy");
    expect(markup).toContain('<button disabled="" type="button">Cancel</button>');
    expect(markup).not.toContain("Open Recovery Pack library");
  });
});
