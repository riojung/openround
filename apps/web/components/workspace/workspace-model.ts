import type { QuestionType } from "@openround/contracts";

export const questionTypeOptions: Array<{
  type: QuestionType;
  label: string;
  description: string;
}> = [
  {
    type: "single_select",
    label: "Single choice",
    description: "One correct response with clear feedback.",
  },
  {
    type: "true_false",
    label: "True or false",
    description: "A fast check for one precise claim.",
  },
  {
    type: "multi_select",
    label: "Multiple choice",
    description: "Learners select every correct response.",
  },
  {
    type: "numeric",
    label: "Number",
    description: "A numeric answer with optional tolerance and unit.",
  },
  {
    type: "rating",
    label: "Rating scale",
    description: "An unscored sentiment or reflection scale.",
  },
  {
    type: "poll",
    label: "Poll",
    description: "An unscored choice with no right answer.",
  },
];

export function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatPercent(value: number | null) {
  return value === null ? "Not enough evidence" : `${Math.round(value)}%`;
}

export function responseTypeLabel(type: QuestionType) {
  return questionTypeOptions.find((option) => option.type === type)?.label ?? type;
}

export function dashboardMessage(params: URLSearchParams) {
  if (params.get("billing") === "success") return "Your plan update is being activated.";
  if (params.get("invitation") === "accepted") return "Workspace invitation accepted.";
  if (params.get("federated") === "1") return "Institution sign-in connected.";
  if (params.get("lti") === "1") return "Learning-platform connection completed.";
  if (params.get("welcome") === "1")
    return "Welcome to OpenRound. Create or open a Round to begin.";
  return "";
}
