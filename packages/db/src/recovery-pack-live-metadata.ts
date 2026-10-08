import type { RecoveryPackContent } from "@openround/contracts";

const LIVE_TEXT_ONLY_ROLES = ["diagnostic", "recheck", "delayedProbe"] as const;

/** Live copies have no independent media owner, so every frozen Pack item must be textual. */
export function recoveryPackTextOnlyLiveEligible(
  content: Pick<RecoveryPackContent, (typeof LIVE_TEXT_ONLY_ROLES)[number]>,
) {
  return LIVE_TEXT_ONLY_ROLES.every((role) => content[role]?.mediaId == null);
}

/** The metadata query uses the same eligibility fields without fetching unpublished content. */
export const RECOVERY_PACK_TEXT_ONLY_LIVE_SQL = LIVE_TEXT_ONLY_ROLES.map(
  (role) => `version.content -> '${role}' ->> 'mediaId' IS NULL`,
).join(" AND ");
