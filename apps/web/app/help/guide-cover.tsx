import type { ReactNode } from "react";
import type { HelpGuideIcon, HelpFeatureGuide } from "../../lib/help-feature-guides";
import { LollipopMark } from "../../components/lollipop-mark";
import styles from "./feature-guides.module.css";

const paths: Record<HelpGuideIcon, ReactNode> = {
  book: (
    <>
      <path d="M4 5h6l2 2 2-2h6v15h-6l-2 2-2-2H4z" />
      <path d="M12 7v15M7 9h2M15 9h2M7 13h2M15 13h2" />
    </>
  ),
  edit: (
    <>
      <path d="m5 15 10-10 4 4L9 19l-5 1zM13 7l4 4M4 4h5M4 4v5M15 20h5v-5" />
    </>
  ),
  choices: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
      <path d="m6 7 1 1 2-2M12 7h6M6 17h3M12 17h6" />
    </>
  ),
  theme: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="15" cy="7" r="1" />
      <circle cx="18" cy="13" r="1" />
      <path d="M4 14c7-5 7 9 13 5M8 18l2-2" />
    </>
  ),
  screen: (
    <>
      <rect x="3" y="3" width="18" height="13" rx="2" />
      <path d="M12 16v5M7 21h10M7 8h9M7 11h6" />
    </>
  ),
  qr: (
    <>
      <path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM12 3v9H3M12 18v3M18 12h3" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="10" r="2" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 15a4 4 0 0 1 5 4v1" />
    </>
  ),
  pulse: (
    <>
      <path d="M2 13h5l3-8 4 15 3-7h5" />
      <path d="M3 4h3M18 4h3" />
    </>
  ),
  chat: (
    <>
      <path d="M3 4h18v13H9l-6 4zM7 8h10M7 12h7" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18M7 17v-5M12 17V7M17 17v-8" />
    </>
  ),
  shield: (
    <>
      <path d="m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5zM8 11l3 3 5-6" />
    </>
  ),
  loop: (
    <>
      <path d="M20 10a8 8 0 0 0-14-5L3 8M3 3v5h5M4 14a8 8 0 0 0 14 5l3-3M21 21v-5h-5" />
    </>
  ),
};

/** Original code-native illustrations; no customer screenshots or external assets. */
export function GuideCover({ guide }: { guide: HelpFeatureGuide }) {
  return (
    <div className={styles.cover} data-topic={guide.topic} aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        className={styles.coverIcon}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
      >
        {paths[guide.icon]}
      </svg>
      <div className={styles.coverLines}>
        <span />
        <span />
        <span />
      </div>
      <LollipopMark className={styles.coverPop} />
    </div>
  );
}
