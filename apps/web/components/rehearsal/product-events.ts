import { ProductEventSchema, type ProductEvent } from "@openround/contracts";
import type { RecoveryRehearsalScenarioId } from "@openround/rehearsal";
import { apiFetch } from "../../lib/api";

export type RehearsalDurationBucket = "under_1m" | "1_to_5m" | "5_to_15m" | "over_15m";

export function rehearsalDurationBucket(elapsedMs: number): RehearsalDurationBucket {
  if (elapsedMs < 60_000) return "under_1m";
  if (elapsedMs < 5 * 60_000) return "1_to_5m";
  if (elapsedMs < 15 * 60_000) return "5_to_15m";
  return "over_15m";
}

type RehearsalProductEventInput =
  | {
      name: "rehearsal_started";
      scenario: RecoveryRehearsalScenarioId;
      occurredAt: string;
    }
  | {
      name: "rehearsal_completed";
      scenario: RecoveryRehearsalScenarioId;
      occurredAt: string;
      elapsedMs: number;
    };

export function buildRehearsalProductEvent(input: RehearsalProductEventInput): ProductEvent {
  return ProductEventSchema.parse({
    name: input.name,
    occurredAt: input.occurredAt,
    dimensions: {
      scenario: input.scenario,
      ...(input.name === "rehearsal_completed"
        ? { durationBucket: rehearsalDurationBucket(input.elapsedMs) }
        : {}),
    },
  });
}

export function recordRehearsalProductEvent(
  input:
    | { name: "rehearsal_started"; scenario: RecoveryRehearsalScenarioId }
    | {
        name: "rehearsal_completed";
        scenario: RecoveryRehearsalScenarioId;
        elapsedMs: number;
      },
) {
  const event = buildRehearsalProductEvent({
    ...input,
    occurredAt: new Date().toISOString(),
  });
  void apiFetch<{ accepted: number }>("/v1/product-events", {
    method: "POST",
    body: JSON.stringify({ events: [event] }),
  }).catch(() => undefined);
}
