/** Shared learning-audience rules. Organizer-blind feedback needs a separate projection. */
export function qnaDefaults(segment: "education" | "workplace") {
  return {
    enabled: true,
    displayMode:
      segment === "education" ? ("anonymous_public" as const) : ("alias_public" as const),
    moderationMode: segment === "education" ? ("pre" as const) : ("post" as const),
    participantReplies: segment === "workplace",
  };
}
export function qnaIsPublic(status: string) {
  return status === "published" || status === "answered";
}
export function qnaQuestionVisible(status: string, moderator: boolean, mine: boolean) {
  return moderator || qnaIsPublic(status) || mine;
}
export function qnaInitialStatus(moderationMode: "pre" | "post") {
  return moderationMode === "pre" ? ("pending" as const) : ("published" as const);
}
export function qnaDisplayName(input: {
  alias: string;
  moderator: boolean;
  mine: boolean;
  displayMode: "anonymous_public" | "alias_public";
}) {
  return input.moderator
    ? input.alias
    : input.mine
      ? "You"
      : input.displayMode === "anonymous_public"
        ? "Anonymous"
        : input.alias;
}
