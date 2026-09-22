import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { QuizDraft, SupportedLocale } from "@openround/contracts";
import {
  createRecoveryRehearsalController,
  type RecoveryRehearsalController,
} from "@openround/rehearsal";
import { LocaleProvider } from "../locale-provider";
import { loadMessages, localeDomains } from "../../lib/i18n/catalog";
import { ActiveRehearsal } from "./recovery-rehearsal";

vi.mock("next/navigation", () => ({
  usePathname: () => "/quiz/test-round/rehearse",
}));

function id(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

const quiz: QuizDraft = {
  title: "Habitat recovery",
  description: "A deterministic rehearsal fixture",
  category: "education",
  experiencePreset: { id: "campus", version: 1 },
  questions: [
    {
      id: id(1),
      type: "single_select",
      prompt: "Which change best protects the habitat?",
      purpose: "diagnostic",
      confidence: "off",
      delivery: "main",
      conceptKeys: ["habitat.change"],
      linkedRecheckQuestionId: null,
      choices: [
        { id: id(2), label: "Restore the wetland", isCorrect: true },
        { id: id(3), label: "Pave the wetland", isCorrect: false },
      ],
      timeLimitSeconds: 20,
      basePoints: 1_000,
      explanation: "Wetlands provide habitat and absorb water.",
      mediaId: null,
      mediaAlt: null,
    },
  ],
};

function controllerAtStep(
  controller: RecoveryRehearsalController,
  stepIndex: number,
): RecoveryRehearsalController {
  return {
    plan: controller.plan,
    view: () => controller.view(stepIndex),
    next: (index) => controller.next(index),
    previous: (index) => controller.previous(index),
    apply: (index, command) => controller.apply(index, command),
  };
}

async function renderRehearsalSteps(locale: SupportedLocale) {
  const messages = await loadMessages(locale, localeDomains);
  const controller = createRecoveryRehearsalController({
    quiz,
    scenarioId: "low_participation",
    questionId: id(1),
  });
  const localized = (children: ReactNode) => (
    <LocaleProvider
      initialDomains={localeDomains}
      initialLocale={locale}
      initialMessages={messages}
    >
      {children}
    </LocaleProvider>
  );

  return controller.plan.steps.map((_, stepIndex) =>
    renderToStaticMarkup(
      localized(
        <ActiveRehearsal
          controller={controllerAtStep(controller, stepIndex)}
          onExit={() => undefined}
          startedAtMs={0}
        />,
      ),
    ),
  );
}

describe("localized recovery rehearsal", () => {
  it("renders every English rehearsal step, including the debrief display phase", async () => {
    const steps = await renderRehearsalSteps("en-CA");

    expect(steps).toHaveLength(9);
    expect(steps.every((markup) => markup.includes('data-testid="rehearsal-step"'))).toBe(true);
    expect(steps[0]).toContain("Start round");
    expect(steps.at(-1)).toContain("Recovery debrief");
  });

  it("renders every non-English rehearsal step with localized host labels", async () => {
    const steps = await renderRehearsalSteps("fr-FR");

    expect(steps).toHaveLength(9);
    expect(steps.every((markup) => markup.includes('data-testid="rehearsal-step"'))).toBe(true);
    expect(steps[0]).toContain("Hall d&#x27;entrée");
    expect(steps[0]).toContain("Tour de départ");
    expect(steps.at(-1)).toContain("Débriefing de récupération");
    expect(steps.join(" ")).not.toMatch(/live\.host\.(?:phase|command)\./);
  });
});
