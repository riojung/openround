import { QUESTION_TYPE_REGISTRY, type QuestionType } from "@openround/contracts";

export const questionTypeOptions: Array<{
  type: QuestionType;
  label: string;
  description: string;
}> = Object.values(QUESTION_TYPE_REGISTRY).map(({ type, label, description }) => ({
  type,
  label,
  description,
}));

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
  return QUESTION_TYPE_REGISTRY[type].label;
}

export function prioritizeStartersForSegment<
  T extends { segment: "all" | "education" | "workplace" },
>(starters: readonly T[], segment: "education" | "workplace" | null | undefined): T[] {
  if (!segment) return [...starters];

  const recommended: T[] = [];
  const remaining: T[] = [];
  for (const starter of starters) {
    (starter.segment === "all" || starter.segment === segment ? recommended : remaining).push(
      starter,
    );
  }
  return [...recommended, ...remaining];
}

export function formatStarterCategory(category: string) {
  return category
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase("en-CA") + word.slice(1))
    .join(" ");
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
