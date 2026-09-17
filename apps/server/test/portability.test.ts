import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { QuizDraft } from "@openround/contracts";
import { checkpointSetCsv, importCheckpointSet, openRoundJson } from "../src/portability.js";

function linkedDraft(): QuizDraft {
  const mainId = randomUUID();
  const recheckId = randomUUID();
  return {
    title: "Safe handling",
    description: "Diagnose, intervene, and recheck.",
    questions: [
      {
        id: mainId,
        type: "single_select",
        prompt: "=Which procedure is safe?",
        purpose: "diagnostic",
        confidence: "required",
        delivery: "main",
        conceptKeys: ["safe-work"],
        linkedRecheckQuestionId: recheckId,
        choices: [
          { id: randomUUID(), label: "Complete procedure", isCorrect: true },
          {
            id: randomUUID(),
            label: "Shortcut",
            isCorrect: false,
            misconceptionKey: "shortcut-is-safe",
          },
        ],
        timeLimitSeconds: 20,
        basePoints: 1_000,
        explanation: "Use the complete procedure.",
        mediaId: randomUUID(),
        mediaAlt: "A worker using protective equipment",
      },
      {
        id: recheckId,
        type: "numeric",
        prompt: "How many checks are required?",
        purpose: "practice",
        confidence: "optional",
        delivery: "recheck",
        conceptKeys: ["safe-work"],
        linkedRecheckQuestionId: null,
        correctValue: "3",
        tolerance: "0",
        unit: "checks",
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "All three checks are required.",
        mediaId: null,
        mediaAlt: null,
      },
      {
        id: randomUUID(),
        type: "rating",
        prompt: "How useful was the example?",
        purpose: "opinion",
        confidence: "off",
        delivery: "main",
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        min: 1,
        max: 5,
        minLabel: "Not useful",
        maxLabel: "Very useful",
        timeLimitSeconds: 20,
        basePoints: 0,
        explanation: "",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
}

describe("checkpoint-set portability", () => {
  it("round-trips OpenRound JSON with fresh IDs and an explicit media warning", () => {
    const source = linkedDraft();
    const imported = importCheckpointSet("openround_json", openRoundJson(source));

    expect(imported.validation.errors).toEqual([]);
    expect(imported.validation).toMatchObject({
      format: "openround_json",
      importedCheckpoints: 3,
      warnings: [{ code: "MEDIA_REFERENCE_REMOVED", row: 1, field: "mediaId" }],
    });
    expect(imported.draft).not.toBeNull();
    expect(imported.draft!.questions[0]!.id).not.toBe(source.questions[0]!.id);
    expect(imported.draft!.questions[0]!.linkedRecheckQuestionId).toBe(
      imported.draft!.questions[1]!.id,
    );
    expect(imported.draft!.questions[0]!.mediaId).toBeNull();
    expect(imported.draft!.questions[0]!.mediaAlt).toBeNull();
  });

  it("round-trips CSV checkpoint types, relationships, and spreadsheet-like text safely", () => {
    const source = linkedDraft();
    source.questions[0]!.mediaId = null;
    source.questions[0]!.mediaAlt = null;
    const csv = checkpointSetCsv(source);

    expect(csv).toContain("'=Which procedure is safe?");
    const imported = importCheckpointSet("csv", csv, "Imported safety set");

    expect(imported.validation.errors).toEqual([]);
    expect(imported.draft).toMatchObject({ title: "Imported safety set" });
    expect(imported.draft!.questions.map((question) => question.type)).toEqual([
      "single_select",
      "numeric",
      "rating",
    ]);
    expect(imported.draft!.questions[0]!.prompt).toBe("=Which procedure is safe?");
    expect(imported.draft!.questions[0]!.linkedRecheckQuestionId).toBe(
      imported.draft!.questions[1]!.id,
    );
  });

  it("returns validation errors instead of partially importing malformed CSV", () => {
    const missingHeaders = importCheckpointSet("csv", "type,prompt\nsingle_select,Question");
    expect(missingHeaders.draft).toBeNull();
    expect(missingHeaders.validation.errors[0]?.code).toBe("MISSING_HEADERS");

    const source = linkedDraft();
    const csv = checkpointSetCsv(source).replace(
      `${source.questions[0]!.id},${source.questions[1]!.id},`,
      `${source.questions[0]!.id},missing-checkpoint,`,
    );
    const brokenLink = importCheckpointSet("csv", csv);
    expect(brokenLink.draft).toBeNull();
    expect(brokenLink.validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_CHECKPOINT",
          message: expect.stringContaining("does not exist"),
        }),
      ]),
    );
  });

  it("imports documented bulk-paste blocks and explains invalid blocks", () => {
    const imported = importCheckpointSet(
      "bulk",
      "Which option is safe?\n* Complete procedure\n- Shortcut\n\nPPE is optional.\n- True\n* False",
      "Bulk safety set",
    );
    expect(imported.validation.errors).toEqual([]);
    expect(imported.draft).toMatchObject({
      title: "Bulk safety set",
      questions: [{ type: "single_select" }, { type: "single_select" }],
    });

    const invalid = importCheckpointSet("bulk", "Question\n* First\n* Second");
    expect(invalid.draft).toBeNull();
    expect(invalid.validation.errors[0]).toMatchObject({
      code: "INVALID_BULK_BLOCK",
      row: 1,
    });
  });
});
