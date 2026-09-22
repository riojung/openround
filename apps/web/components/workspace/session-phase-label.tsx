"use client";

import { useLocale } from "../locale-provider";

const phaseMessageKeys = {
  lobby: "pages.sessions.phase.lobby",
  content: "pages.sessions.phase.content",
  question_open: "pages.sessions.phase.question_open",
  paused: "pages.sessions.phase.paused",
  question_locked: "pages.sessions.phase.question_locked",
  question_reveal: "pages.sessions.phase.question_reveal",
  intervention: "pages.sessions.phase.intervention",
  leaderboard: "pages.sessions.phase.leaderboard",
  finished: "pages.sessions.phase.finished",
} as const;

export function SessionPhaseLabel({ phase }: { phase: string }) {
  const { locale, t } = useLocale();
  const key = phaseMessageKeys[phase as keyof typeof phaseMessageKeys];

  return <span lang={key ? locale : "en-CA"}>{key ? t(key) : phase.replaceAll("_", " ")}</span>;
}
