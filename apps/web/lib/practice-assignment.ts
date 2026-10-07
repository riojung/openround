import type { RecoveryPackPracticeSource } from "@openround/contracts";

export type PracticePurpose = "recovery" | "assignment";
export type PracticeTimeMode = "flex" | "timed";

export interface PracticeRecord {
  id: string;
  purpose: PracticePurpose;
  sourceSessionId: string | null;
  sourceReportId: string | null;
  sourceQuizVersionId: string | null;
  recoveryPackSource?: RecoveryPackPracticeSource | null;
  title: string;
  conceptKeys: string[];
  checkpointCount: number;
  timeMode: PracticeTimeMode;
  opensAt: string;
  closesAt: string;
  expiresAt: string;
  closedAt: string | null;
  createdAt: string;
}

export interface PracticeAccess {
  id: string;
  kind: "personal" | "assignment_personal" | "accommodation";
  participantId: string | null;
  nickname: string | null;
  label: string;
  timeMultiplier: 1 | 1.5 | 2;
  expiresAt: string;
  revokedAt: string | null;
  url?: string;
}

export interface CreatedPractice {
  followup: PracticeRecord;
  genericUrl: string;
  personalAccess: PracticeAccess[];
}

export type PracticeContext =
  | {
      sourceType?: "round";
      quizId: string;
      quizTitle: string;
      version: number;
      publishedAt: string;
    }
  | {
      sourceType: "recovery_pack";
      packId: string;
      packTitle: string;
      version: number;
      publishedAt: string;
    };

export function practiceSourceDetails(context: PracticeContext, canEdit: boolean) {
  return context.sourceType === "recovery_pack"
    ? {
        title: context.packTitle,
        label: "Recovery Pack delayed probe",
        href: "/recovery-packs",
        linkLabel: "Open Recovery Pack library",
      }
    : {
        title: context.quizTitle,
        label: "Published Round",
        href: `/quiz/${context.quizId}${canEdit ? "" : "/preview"}`,
        linkLabel: "Open source Round",
      };
}

export type PracticeStatus = "scheduled" | "open" | "closed" | "expired";

const DAY_MS = 24 * 60 * 60_000;

export function localDateTimeValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function defaultPracticeWindow(now: Date, retentionDays: number) {
  const retentionLimit = new Date(now.getTime() + retentionDays * DAY_MS - 60_000);
  const suggestedClose = new Date(Math.min(now.getTime() + 7 * DAY_MS, retentionLimit.getTime()));
  return {
    closesAt: localDateTimeValue(suggestedClose),
    maxClosesAt: localDateTimeValue(retentionLimit),
  };
}

export function parsePersonalLabels(value: string) {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const label = line.trim();
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

export function personalLabelsError(labels: string[], maximum = 250) {
  if (labels.length > maximum) {
    return `Add no more than ${maximum} personal link label${maximum === 1 ? "" : "s"}.`;
  }
  if (labels.some((label) => label.length > 80)) {
    return "Keep every personal link label to 80 characters or fewer.";
  }
  return null;
}

export function practicePersonalLinkLimit(
  entitlements: { maxPracticePersonalLinks: number } | null,
) {
  return Math.min(250, entitlements?.maxPracticePersonalLinks ?? 0);
}

export function practiceStatus(practice: PracticeRecord, now = new Date()): PracticeStatus {
  if (new Date(practice.expiresAt) <= now) return "expired";
  if (practice.closedAt || new Date(practice.closesAt) <= now) return "closed";
  if (new Date(practice.opensAt) > now) return "scheduled";
  return "open";
}

export function practicePurposeLabel(purpose: PracticePurpose) {
  return purpose === "assignment" ? "Practice assignment" : "Recovery follow-up";
}

function csvCell(value: string) {
  const protectedValue = /^(?:\s*[=+@-]|[\t\r\n])/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function practiceLinksCsv(created: CreatedPractice) {
  const rows = [
    ["access", "participant", "link"],
    ["generic", "Anonymous", created.genericUrl],
    ...created.personalAccess.map((access) => [
      "personal",
      access.nickname ?? access.label,
      access.url ?? "",
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
