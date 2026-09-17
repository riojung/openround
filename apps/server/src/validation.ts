import type { ZodError } from "zod";

export function validationIssueMessage(issue: ZodError["issues"][number]) {
  const [root, itemIndex, field, choiceIndex] = issue.path;
  let source = "Request";
  if (root === "questions" && typeof itemIndex === "number") {
    source = `Checkpoint ${itemIndex + 1}`;
    if (field === "choices" && typeof choiceIndex === "number") {
      source += `, answer ${choiceIndex + 1}`;
    }
  } else if (root === "title") {
    source = "Checkpoint set title";
  } else if (typeof root === "string") {
    source = root
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (character) => character.toUpperCase());
  }
  return `${source}: ${issue.message}`;
}
