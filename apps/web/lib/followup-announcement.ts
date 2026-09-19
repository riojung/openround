import type { FollowupSnapshot } from "@openround/contracts";

export function followupStatusAnnouncement(snapshot: FollowupSnapshot | null) {
  if (!snapshot) return "Opening your private practice.";
  if (snapshot.status === "completed" || snapshot.phase === "completed") {
    return snapshot.purpose === "assignment" ? "Practice complete." : "Follow-up complete.";
  }

  const position = (snapshot.questionIndex ?? 0) + 1;
  return snapshot.phase === "answer_reveal"
    ? `Question ${position} of ${snapshot.questionCount}: feedback available.`
    : `Question ${position} of ${snapshot.questionCount}: ready for your response.`;
}
