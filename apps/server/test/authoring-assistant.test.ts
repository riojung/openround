import { describe, expect, it } from "vitest";
import type { ExtractedSource } from "../src/source-extraction.js";
import { validateAuthoringOutput } from "../src/authoring-assistant.js";

const source: ExtractedSource = {
  sourceName: "Safety guide",
  sourceType: "pasted_text",
  characterCount: 128,
  sections: [
    {
      locator: "paragraph 1",
      text: "Lockout physically isolates hazardous energy before maintenance begins.",
    },
    {
      locator: "paragraph 2",
      text: "A warning sign alone does not isolate the machine from its energy source.",
    },
  ],
};

function generatedOutput() {
  return {
    title: "Hazardous energy checkpoint",
    description: "Check the isolation principle.",
    conceptKey: "hazardous-energy",
    citations: [
      {
        locator: "paragraph 1",
        excerpt: "Lockout physically isolates hazardous energy",
      },
      {
        locator: "paragraph 2",
        excerpt: "A warning sign alone does not isolate the machine",
      },
    ],
    main: {
      type: "single_select",
      prompt: "What physically isolates hazardous energy?",
      purpose: "diagnostic",
      confidence: "required",
      explanation: "Lockout creates the required physical isolation.",
      timeLimitSeconds: 30,
      citationIndexes: [0, 1],
      choices: [
        {
          label: "Lockout",
          isCorrect: true,
          rationale: "It physically isolates the energy source.",
          misconceptionLabel: null,
        },
        {
          label: "A warning sign",
          isCorrect: false,
          rationale: "A sign communicates danger but does not isolate energy.",
          misconceptionLabel: "warning-equals-isolation",
        },
      ],
    },
    recheck: {
      type: "single_select",
      prompt: "Before maintenance, which action separates the machine from hazardous energy?",
      purpose: "diagnostic",
      confidence: "optional",
      explanation: "Use lockout before maintenance begins.",
      timeLimitSeconds: 30,
      citationIndexes: [0],
      choices: [
        {
          label: "Apply lockout",
          isCorrect: true,
          rationale: "Lockout creates physical separation.",
          misconceptionLabel: null,
        },
        {
          label: "Post a warning",
          isCorrect: false,
          rationale: "A warning is not physical isolation.",
          misconceptionLabel: "warning-equals-isolation",
        },
      ],
    },
  };
}

describe("source-grounded authoring validation", () => {
  it("creates a linked, unscored recheck with grounded citations and misconception metadata", () => {
    const output = validateAuthoringOutput({
      raw: generatedOutput(),
      source,
      sourceDigest: "a".repeat(64),
      provider: "test-provider",
      model: "test-model",
      generatedAt: new Date("2026-09-17T12:00:00.000Z"),
    });

    const [main, recheck] = output.checkpointSet.questions;
    expect(main).toMatchObject({
      delivery: "main",
      confidence: "required",
      linkedRecheckQuestionId: recheck!.id,
      conceptKeys: ["hazardous-energy"],
      basePoints: 1_000,
      sourceCitations: [
        expect.objectContaining({ sourceName: "Safety guide", locator: "paragraph 1" }),
        expect.objectContaining({ sourceName: "Safety guide", locator: "paragraph 2" }),
      ],
    });
    expect(recheck).toMatchObject({
      delivery: "recheck",
      linkedRecheckQuestionId: null,
      basePoints: 0,
    });
    expect(main?.type === "single_select" ? main.choices[1] : null).toMatchObject({
      feedback: "A sign communicates danger but does not isolate energy.",
      misconceptionKey: "warning-equals-isolation",
    });
    expect(output.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkpointId: main!.id, locator: "paragraph 1" }),
        expect.objectContaining({ checkpointId: recheck!.id, locator: "paragraph 1" }),
      ]),
    );
  });

  it("rejects invented locations, excerpts, and identical recheck wording", () => {
    const inventedLocator = generatedOutput();
    inventedLocator.citations[0]!.locator = "paragraph 99";
    expect(() =>
      validateAuthoringOutput({
        raw: inventedLocator,
        source,
        sourceDigest: "b".repeat(64),
        provider: "test",
        model: "test",
        generatedAt: new Date(),
      }),
    ).toThrow("Citation locator is not in the source");

    const inventedExcerpt = generatedOutput();
    inventedExcerpt.citations[0]!.excerpt = "This sentence never appeared";
    expect(() =>
      validateAuthoringOutput({
        raw: inventedExcerpt,
        source,
        sourceDigest: "b".repeat(64),
        provider: "test",
        model: "test",
        generatedAt: new Date(),
      }),
    ).toThrow("Citation excerpt is not grounded");

    const copiedRecheck = generatedOutput();
    copiedRecheck.recheck.prompt = copiedRecheck.main.prompt;
    expect(() =>
      validateAuthoringOutput({
        raw: copiedRecheck,
        source,
        sourceDigest: "b".repeat(64),
        provider: "test",
        model: "test",
        generatedAt: new Date(),
      }),
    ).toThrow("worded differently");
  });
});
