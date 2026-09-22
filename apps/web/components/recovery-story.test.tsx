import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { withEnglishLocale } from "../test-utils/english-locale";
import { RecoveryStorySummary, type RecoveryStoryModel } from "./recovery-story";

vi.mock("next/navigation", () => ({
  usePathname: () => "/report/example",
}));

const model: RecoveryStoryModel = {
  recovered: 2,
  denominator: 3,
  recoveryPercent: 66.7,
  initialAccuracyPercent: 50,
  evidenceLabel: "vérification liée",
  unresolvedCount: 1,
  unresolvedNarrative: "Une notion reste à revoir.",
  interventions: [{ id: "one", label: "Discussion entre pairs" }],
  nextActionLabel: "Réviser",
  nextAction: "Reprendre la notion demain.",
  highConfidenceWrong: 0,
  correctButUnsure: 0,
  smallSample: false,
  evidenceNote: "Preuve de séance uniquement.",
};

describe("RecoveryStorySummary", () => {
  it("preserves the declared language of generated narrative content", () => {
    const markup = renderToStaticMarkup(
      withEnglishLocale(<RecoveryStorySummary contentLanguage="fr-FR" model={model} />),
    );

    expect(markup).toContain('lang="fr-FR">Une notion reste à revoir.</p>');
    expect(markup).toContain('lang="fr-FR">Réviser</strong>');
    expect(markup).toContain('lang="fr-FR">Preuve de séance uniquement.</p>');
  });
});
