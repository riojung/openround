import {
  PresentationCompanionRecoveryPackCatalogSchema,
  type PresentationCompanionCommand,
} from "@openround/contracts";
import { apiFetch } from "./api";

export type CompanionRecoveryPackCatalog = ReturnType<
  typeof PresentationCompanionRecoveryPackCatalogSchema.parse
>;

/** Pass-only catalog requests have no ambient creator authority. */
export async function fetchPresentationCompanionRecoveryPacks(
  sessionId: string,
  companionToken: string,
) {
  const response = await apiFetch(
    `/v1/presentation-sessions/${encodeURIComponent(sessionId)}/companion-recovery-packs`,
    {
      credentials: "omit",
      headers: { authorization: `Bearer ${companionToken}` },
    },
  );
  return PresentationCompanionRecoveryPackCatalogSchema.parse(response);
}

export function companionCommandRetryMessageKey(command: PresentationCompanionCommand) {
  if (command.action === "insert_published_question")
    return "live.companion.publishedQuestions.retryAcknowledgement" as const;
  if (command.action === "insert_quick_check")
    return "live.companion.quickCheck.retryAcknowledgement" as const;
  if (command.action === "insert_recovery_pack")
    return "live.companion.packs.retryInsertion" as const;
  if (command.action === "start_recovery_card") return "live.companion.packs.retryCard" as const;
  return "live.companion.retryAck" as const;
}
