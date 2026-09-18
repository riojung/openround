export type RehearsalWorkspaceRole = "owner" | "editor" | "viewer";
export type RehearsalContentSource = "draft" | "published";

const REHEARSAL_ROLES: readonly RehearsalWorkspaceRole[] = ["owner", "editor", "viewer"];

export function canAccessRecoveryRehearsal(input: {
  role: RehearsalWorkspaceRole;
  recoveryRehearsal: boolean;
  status: "draft" | "published" | "archived";
}) {
  return (
    input.status !== "archived" && input.recoveryRehearsal && REHEARSAL_ROLES.includes(input.role)
  );
}

export function rehearsalReturnLink(input: {
  quizId: string;
  role: RehearsalWorkspaceRole;
  status: "draft" | "published" | "archived";
}) {
  if (input.status === "archived") return { href: "/dashboard", label: "Back to Rounds" };
  if (input.role === "viewer") {
    return { href: `/quiz/${input.quizId}/preview`, label: "Back to Round preview" };
  }
  return { href: `/quiz/${input.quizId}`, label: "Back to editor" };
}

export function defaultRehearsalContentSource(input: {
  status: "draft" | "published" | "archived";
  hasPublishedVersion: boolean;
}): RehearsalContentSource {
  if (input.status === "archived") {
    throw new Error("Archived Rounds cannot be rehearsed.");
  }
  return input.status === "published" && input.hasPublishedVersion ? "published" : "draft";
}
