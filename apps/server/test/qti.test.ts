import { randomUUID } from "node:crypto";
import * as yazl from "yazl";
import { describe, expect, it } from "vitest";
import type { QuizDraft } from "@openround/contracts";
import { exportQtiPackage, importQtiPackage } from "../src/qti.js";

async function zip(files: Array<{ path: string; content: string }>) {
  const archive = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const file of files) {
    archive.addBuffer(Buffer.from(file.content, "utf8"), file.path, {
      mtime: new Date("1980-01-01T00:00:00.000Z"),
    });
  }
  archive.end();
  return completed;
}

function completeDraft(): QuizDraft {
  const mainId = randomUUID();
  const multiId = randomUUID();
  const recheckId = randomUUID();
  return {
    title: "Portable diagnostics",
    description: "QTI round trip",
    questions: [
      {
        id: mainId,
        type: "single_select",
        prompt: "Which control prevents the hazard?",
        purpose: "diagnostic",
        confidence: "required",
        delivery: "main",
        conceptKeys: ["hazard-control"],
        linkedRecheckQuestionId: recheckId,
        choices: [
          { id: randomUUID(), label: "Isolation", isCorrect: true },
          {
            id: randomUUID(),
            label: "Warning only",
            isCorrect: false,
            feedback: "Warnings do not remove the hazard.",
            misconceptionKey: "warning-is-control",
          },
        ],
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "Isolation separates people from the hazard.",
        mediaId: randomUUID(),
        mediaAlt: "A guarded machine",
      },
      {
        id: multiId,
        type: "multi_select",
        prompt: "Select both required checks.",
        purpose: "practice",
        confidence: "optional",
        delivery: "main",
        conceptKeys: ["preflight"],
        linkedRecheckQuestionId: null,
        choices: [
          { id: randomUUID(), label: "Guard", isCorrect: true },
          { id: randomUUID(), label: "Permit", isCorrect: true },
          { id: randomUUID(), label: "Shortcut", isCorrect: false },
        ],
        timeLimitSeconds: 45,
        basePoints: 800,
        explanation: "Both checks are mandatory.",
        mediaId: null,
        mediaAlt: null,
      },
      {
        id: recheckId,
        type: "numeric",
        prompt: "What is the safe clearance?",
        purpose: "diagnostic",
        confidence: "optional",
        delivery: "recheck",
        conceptKeys: ["hazard-control"],
        linkedRecheckQuestionId: null,
        correctValue: "1.5",
        tolerance: "0.25",
        unit: "m",
        timeLimitSeconds: 35,
        basePoints: 0,
        explanation: "Maintain 1.5 metres of clearance.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
}

const packageNamespace = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1";
const itemNamespace = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

function manifest(href = "items/item.xml") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="${packageNamespace}" identifier="manifest_1">
  <resources>
    <resource identifier="resource_1" type="imsqti_item_xmlv3p0" href="${href}">
      <file href="${href}"/>
    </resource>
  </resources>
</manifest>`;
}

function unsupportedItem() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${itemNamespace}" identifier="item_1" title="Essay">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-item-body><qti-extended-text-interaction response-identifier="RESPONSE"/></qti-item-body>
</qti-assessment-item>`;
}

describe("QTI 3 portability", () => {
  it("round-trips supported checkpoints with fresh ids and recovery metadata", async () => {
    const source = completeDraft();
    const exported = await exportQtiPackage(source);

    expect(exported.archive?.subarray(0, 2).toString("binary")).toBe("PK");
    expect(exported.validation).toMatchObject({
      format: "qti3",
      importedCheckpoints: 3,
      errors: [],
      warnings: [{ code: "QTI_MEDIA_OMITTED" }],
    });

    const imported = await importQtiPackage(exported.archive!.toString("base64"), "Imported QTI");
    expect(imported.validation.errors).toEqual([]);
    expect(imported.validation.importedCheckpoints).toBe(3);
    expect(imported.draft).not.toBeNull();
    expect(imported.draft?.title).toBe("Imported QTI");
    expect(imported.draft?.questions.map((question) => question.type)).toEqual([
      "single_select",
      "multi_select",
      "numeric",
    ]);

    const [main, multi, recheck] = imported.draft!.questions;
    expect(main!.id).not.toBe(source.questions[0]!.id);
    expect(main).toMatchObject({
      purpose: "diagnostic",
      confidence: "required",
      conceptKeys: ["hazard-control"],
      linkedRecheckQuestionId: recheck!.id,
      mediaId: null,
    });
    expect(main!.type === "single_select" ? main!.choices[1] : null).toMatchObject({
      feedback: "Warnings do not remove the hazard.",
      misconceptionKey: "warning-is-control",
    });
    expect(
      multi!.type === "multi_select" ? multi!.choices.filter((choice) => choice.isCorrect) : [],
    ).toHaveLength(2);
    expect(recheck).toMatchObject({
      delivery: "recheck",
      correctValue: "1.5",
      tolerance: "0.25",
      unit: "m",
    });
  });

  it("reports unsupported checkpoint types instead of silently dropping them", async () => {
    const draft = completeDraft();
    draft.questions = [
      {
        id: randomUUID(),
        type: "rating",
        prompt: "How useful was this?",
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
    ];

    const exported = await exportQtiPackage(draft);
    expect(exported.archive).toBeNull();
    expect(exported.validation.errors).toMatchObject([
      { code: "UNSUPPORTED_QTI_CHECKPOINT", row: 1, field: "type" },
    ]);
  });

  it("rejects invalid, unsafe, and unsupported packages with actionable validation", async () => {
    const notZip = await importQtiPackage(Buffer.from("not a zip").toString("base64"));
    expect(notZip.validation.errors[0]).toMatchObject({ code: "INVALID_QTI_PACKAGE" });

    const noManifest = await importQtiPackage(
      (await zip([{ path: "items/item.xml", content: unsupportedItem() }])).toString("base64"),
    );
    expect(noManifest.validation.errors[0]).toMatchObject({ code: "QTI_MANIFEST_MISSING" });

    const entityPackage = await zip([
      {
        path: "imsmanifest.xml",
        content: `<?xml version="1.0"?><!DOCTYPE manifest [<!ENTITY secret "unsafe">]><manifest xmlns="${packageNamespace}" identifier="m"><resources/></manifest>`,
      },
    ]);
    const entityResult = await importQtiPackage(entityPackage.toString("base64"));
    expect(entityResult.validation.errors[0]).toMatchObject({ code: "INVALID_QTI_MANIFEST" });
    expect(entityResult.validation.errors[0]?.message).toContain("prohibited");

    const traversalPackage = await zip([
      { path: "imsmanifest.xml", content: manifest("../item.xml") },
    ]);
    const traversalResult = await importQtiPackage(traversalPackage.toString("base64"));
    expect(traversalResult.validation.errors).toMatchObject([{ code: "INVALID_QTI_ITEM", row: 1 }]);
    expect(traversalResult.validation.errors[0]?.message).toContain("Unsafe archive path");

    const unsupportedPackage = await zip([
      { path: "imsmanifest.xml", content: manifest() },
      { path: "items/item.xml", content: unsupportedItem() },
    ]);
    const unsupportedResult = await importQtiPackage(unsupportedPackage.toString("base64"));
    expect(unsupportedResult.validation.errors[0]).toMatchObject({
      code: "INVALID_QTI_ITEM",
      row: 1,
    });
    expect(unsupportedResult.validation.errors[0]?.message).toContain(
      "Unsupported QTI interaction",
    );
  });
});
