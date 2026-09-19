import type {
  FollowupHistoryStatus,
  ReportSummary as ContractReportSummary,
} from "@openround/contracts";

export type {
  FollowupSummary,
  RoundFilterOption,
  SessionSummary,
  StarterSummary,
} from "@openround/contracts";

// Keep the beta UI compatible while the additive lifecycle field rolls out with
// the server contract. Once present, it is always rendered rather than reduced
// to a generic "created" state.
export type ReportSummary = ContractReportSummary & {
  followupStatus?: FollowupHistoryStatus | null;
};

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}
