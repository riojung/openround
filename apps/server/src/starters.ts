import { randomUUID } from "node:crypto";
import {
  QuizContentSchema,
  QuizDraftSchema,
  StarterSummarySchema,
  type ChoiceDraft,
  type QuestionDraft,
  type QuizDraft,
  type StarterId,
  type StarterSummary,
} from "@openround/contracts";

const ids = {
  q1: "00000000-0000-4000-8000-000000000001",
  q2: "00000000-0000-4000-8000-000000000002",
  q3: "00000000-0000-4000-8000-000000000003",
  c1: "00000000-0000-4000-8000-000000000011",
  c2: "00000000-0000-4000-8000-000000000012",
  c3: "00000000-0000-4000-8000-000000000013",
  c4: "00000000-0000-4000-8000-000000000014",
} as const;

function choices(
  labels: string[],
  correct: number | null,
  misconception?: { index: number; key: string; feedback: string },
): ChoiceDraft[] {
  return labels.map((label, index) => ({
    id: [ids.c1, ids.c2, ids.c3, ids.c4][index]!,
    label,
    isCorrect: correct === index,
    ...(misconception?.index === index
      ? { misconceptionKey: misconception.key, feedback: misconception.feedback }
      : {}),
  }));
}

function choiceQuestion(
  id: string,
  prompt: string,
  labels: string[],
  correct: number | null,
  input: Partial<QuestionDraft> & {
    type?: "single_select" | "true_false" | "poll";
    misconception?: { index: number; key: string; feedback: string };
  } = {},
): QuestionDraft {
  return {
    id,
    type: input.type ?? "single_select",
    prompt,
    purpose: input.type === "poll" ? "opinion" : (input.purpose ?? "diagnostic"),
    confidence: input.type === "poll" ? "off" : (input.confidence ?? "optional"),
    delivery: input.delivery ?? "main",
    conceptKeys: input.conceptKeys ?? [],
    linkedRecheckQuestionId: input.linkedRecheckQuestionId ?? null,
    choices: choices(labels, correct, input.misconception),
    timeLimitSeconds: input.timeLimitSeconds ?? 30,
    basePoints: input.type === "poll" ? 0 : (input.basePoints ?? 1_000),
    explanation: input.explanation ?? "Review the reasoning together before moving on.",
    mediaId: null,
    mediaAlt: null,
  };
}

const starterDrafts: Record<StarterId, QuizDraft> = {
  "exit-ticket": {
    title: "Exit ticket",
    description:
      "Close a lesson or workshop with understanding, confidence, and next-step evidence.",
    category: "education",
    experiencePreset: { id: "focus", version: 1 },
    questions: [
      choiceQuestion(
        ids.q1,
        "Which statement best captures today’s most important idea?",
        ["Replace with the key idea", "Replace with a plausible misconception", "I am not sure"],
        0,
        {
          confidence: "required",
          conceptKeys: ["session.key-idea"],
          linkedRecheckQuestionId: ids.q2,
          misconception: {
            index: 1,
            key: "session.key-idea.misconception",
            feedback: "Revisit the distinction highlighted in the explanation.",
          },
        },
      ),
      choiceQuestion(
        ids.q2,
        "Apply the same idea in a new example.",
        [
          "Replace with the best application",
          "Replace with a distractor",
          "Replace with another distractor",
        ],
        0,
        {
          delivery: "recheck",
          purpose: "practice",
          confidence: "required",
          conceptKeys: ["session.key-idea"],
        },
      ),
    ],
  },
  "misconception-check": {
    title: "Misconception check",
    description:
      "Surface a common wrong model, discuss it, and verify recovery with a linked recheck.",
    category: "education",
    experiencePreset: { id: "campus", version: 1 },
    questions: [
      choiceQuestion(
        ids.q1,
        "Which explanation is most accurate?",
        [
          "Replace with the accurate explanation",
          "Replace with the common misconception",
          "Replace with a less likely distractor",
        ],
        0,
        {
          confidence: "required",
          conceptKeys: ["topic.core-model"],
          linkedRecheckQuestionId: ids.q2,
          misconception: {
            index: 1,
            key: "topic.core-model.common-error",
            feedback: "This choice uses the common model that the explanation will correct.",
          },
        },
      ),
      choiceQuestion(
        ids.q2,
        "Which new case follows the corrected model?",
        ["Replace with the transfer case", "Replace with the misconception applied again"],
        0,
        {
          delivery: "recheck",
          purpose: "practice",
          confidence: "required",
          conceptKeys: ["topic.core-model"],
        },
      ),
    ],
  },
  "technical-concept-check": {
    title: "Technical concept check",
    description: "Check a technical decision and the reasoning behind it before work continues.",
    category: "technical",
    experiencePreset: { id: "blueprint", version: 1 },
    questions: [
      choiceQuestion(
        ids.q1,
        "Which option best satisfies the stated technical constraint?",
        [
          "Replace with the best option",
          "Replace with a tempting trade-off",
          "Replace with an unsafe option",
        ],
        0,
        {
          confidence: "required",
          conceptKeys: ["technical.constraint"],
          misconception: {
            index: 1,
            key: "technical.constraint.tradeoff",
            feedback: "This option overlooks one of the stated constraints.",
          },
        },
      ),
      {
        id: ids.q2,
        type: "numeric",
        prompt: "Enter the expected result for the worked example.",
        purpose: "practice",
        confidence: "optional",
        delivery: "main",
        conceptKeys: ["technical.calculation"],
        linkedRecheckQuestionId: null,
        correctValue: "42",
        tolerance: "0",
        unit: null,
        timeLimitSeconds: 45,
        basePoints: 1_000,
        explanation: "Replace this with the calculation steps and assumptions.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  },
  "compliance-scenario": {
    title: "Compliance scenario",
    description: "Practise the safest response to a realistic policy scenario and explain why.",
    category: "safety_compliance",
    experiencePreset: { id: "signal", version: 1 },
    questions: [
      choiceQuestion(
        ids.q1,
        "What is the safest first action in this scenario?",
        [
          "Pause and follow the approved escalation path",
          "Continue and document it later",
          "Handle it informally without a record",
        ],
        0,
        {
          confidence: "required",
          conceptKeys: ["compliance.safe-response"],
          misconception: {
            index: 1,
            key: "compliance.safe-response.delay",
            feedback: "Delaying escalation can increase risk and may breach policy.",
          },
          explanation:
            "Stop the risky activity, protect people and data, then use the approved escalation path.",
        },
      ),
      choiceQuestion(
        ids.q2,
        "Who should receive the escalation next?",
        [
          "Replace with the approved role",
          "A colleague who is not accountable",
          "Nobody unless harm occurs",
        ],
        0,
        { conceptKeys: ["compliance.escalation"] },
      ),
    ],
  },
  "new-hire-knowledge-check": {
    title: "New-hire knowledge check",
    description: "Confirm essential first-week knowledge without relying on a high-stakes test.",
    category: "business",
    experiencePreset: { id: "studio", version: 1 },
    questions: [
      choiceQuestion(
        ids.q1,
        "Where should you go first when you need help with this process?",
        [
          "Replace with the approved support channel",
          "Ask anyone who is available",
          "Wait until the next team meeting",
        ],
        0,
        { conceptKeys: ["onboarding.support"] },
      ),
      choiceQuestion(
        ids.q2,
        "True or false: it is safe to share your account credentials with a teammate.",
        ["True", "False"],
        1,
        {
          type: "true_false",
          conceptKeys: ["onboarding.account-security"],
          explanation:
            "Credentials are personal. Use approved access and delegation processes instead.",
        },
      ),
    ],
  },
  "icebreaker-poll": {
    title: "Icebreaker poll",
    description: "Open the room with two low-pressure prompts that everyone can answer.",
    category: "icebreaker",
    experiencePreset: { id: "spark", version: 1 },
    questions: [
      choiceQuestion(
        ids.q1,
        "What kind of energy are you bringing today?",
        ["Ready to dive in", "Curious", "Still warming up", "Here to listen"],
        null,
        { type: "poll" },
      ),
      {
        id: ids.q2,
        type: "rating",
        prompt: "How familiar are you with today’s topic?",
        purpose: "opinion",
        confidence: "off",
        delivery: "main",
        conceptKeys: [],
        linkedRecheckQuestionId: null,
        min: 1,
        max: 5,
        minLabel: "New to it",
        maxLabel: "Very familiar",
        timeLimitSeconds: 20,
        basePoints: 0,
        explanation: "Use the spread to calibrate pace and examples.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  },
};

const metadata: Record<StarterId, Pick<StarterSummary, "description" | "segment">> = {
  "exit-ticket": {
    description: "Close with a key-idea check and linked transfer question.",
    segment: "education",
  },
  "misconception-check": {
    description: "Surface a common wrong model and verify recovery.",
    segment: "education",
  },
  "technical-concept-check": {
    description: "Check a technical choice and a worked result.",
    segment: "all",
  },
  "compliance-scenario": {
    description: "Practise a safe response to a realistic policy scenario.",
    segment: "workplace",
  },
  "new-hire-knowledge-check": {
    description: "Confirm essential first-week knowledge with low stakes.",
    segment: "workplace",
  },
  "icebreaker-poll": {
    description: "Open the room with two low-pressure prompts.",
    segment: "all",
  },
};

for (const [id, draft] of Object.entries(starterDrafts)) {
  starterDrafts[id as StarterId] = QuizContentSchema.parse(draft);
}

export const starterSummaries = (Object.keys(starterDrafts) as StarterId[]).map((id) => {
  const draft = starterDrafts[id];
  return StarterSummarySchema.parse({
    id,
    title: draft.title,
    description: metadata[id].description,
    segment: metadata[id].segment,
    category: draft.category,
    experiencePreset: draft.experiencePreset,
    questionCount: draft.questions.length,
    responseTypes: [...new Set(draft.questions.map((question) => question.type))],
    version: 1,
  });
});

export function instantiateStarter(id: StarterId): QuizDraft {
  const source = starterDrafts[id];
  const questionIds = new Map(source.questions.map((question) => [question.id, randomUUID()]));
  return QuizDraftSchema.parse({
    ...structuredClone(source),
    questions: source.questions.map((question) => ({
      ...structuredClone(question),
      id: questionIds.get(question.id)!,
      linkedRecheckQuestionId: question.linkedRecheckQuestionId
        ? questionIds.get(question.linkedRecheckQuestionId)!
        : null,
      ...(question.type === "single_select" ||
      question.type === "true_false" ||
      question.type === "multi_select" ||
      question.type === "poll"
        ? {
            choices: question.choices.map((choice) => ({ ...choice, id: randomUUID() })),
          }
        : {}),
    })),
  });
}
