import { createHash } from "node:crypto";
import type { QuestionDraft } from "@openround/contracts";
import type { RecoveryPackVersionRecord } from "@openround/db";

export function recoveryPackHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function recoveryPackCopyId(seed: string) {
  const chars = recoveryPackHash(seed).slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = (8 + (parseInt(chars[16]!, 16) & 3)).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/** Copy the immediate pair; cards and the delayed probe stay in its frozen baseline. */
export function recoveryPackQuestions(
  version: RecoveryPackVersionRecord,
  mutationId: string,
): QuestionDraft[] {
  const diagnosticId = recoveryPackCopyId(`${mutationId}:diagnostic:${version.id}`);
  const recheckId = recoveryPackCopyId(`${mutationId}:recheck:${version.id}`);
  return (["diagnostic", "recheck"] as const).map((role) => {
    const source = version.content[role];
    const copied = structuredClone(source);
    copied.id = role === "diagnostic" ? diagnosticId : recheckId;
    copied.linkedRecheckQuestionId = role === "diagnostic" ? recheckId : null;
    copied.recoveryPackSource = {
      artifactType: "recovery_pack",
      packId: version.packId,
      packVersionId: version.id,
      packVersion: version.version,
      sourceItemId: source.id,
      role,
      contentHash: recoveryPackHash(source),
    };
    if ("choices" in copied) {
      copied.choices = copied.choices.map((choice) => ({
        ...choice,
        id: recoveryPackCopyId(`${mutationId}:${role}:${choice.id}`),
      }));
    }
    return copied;
  });
}
