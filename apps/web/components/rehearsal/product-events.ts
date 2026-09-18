import type { ProductEvent } from "@openround/contracts";
import type { RecoveryRehearsalScenarioId } from "@openround/rehearsal";
import { apiFetch } from "../../lib/api";

export type RehearsalDurationBucket = "under_1m" | "1_to_5m" | "5_to_15m" | "over_15m";

export function rehearsalDurationBucket(elapsedMs: number): RehearsalDurationBucket {
  if (elapsedMs < 60_000) return "under_1m";
  if (elapsedMs < 5 * 60_000) return "1_to_5m";
  if (elapsedMs < 15 * 60_000) return "5_to_15m";
  return "over_15m";
}

export function buildRehearsalProductEvent(input: {
  name: "rehearsal_started" | "rehearsal_completed";
  scenario: RecoveryRehearsalScenarioId;
  occurredAt: string;
  elapsedMs?: number;
}): ProductEvent {
  return {
    name: input.name,
    occurredAt: input.occurredAt,
    dimensions: {
      scenario: input.scenario,
      ...(input.name === "rehearsal_completed" && input.elapsedMs !== undefined
        ? { durationBucket: rehearsalDurationBucket(input.elapsedMs) }
        : {}),
    },
  };
}

export function recordRehearsalProductEvent(input: {
  name: "rehearsal_started" | "rehearsal_completed";
  scenario: RecoveryRehearsalScenarioId;
  elapsedMs?: number;
}) {
  const event = buildRehearsalProductEvent({
    ...input,
    occurredAt: new Date().toISOString(),
  });
  void apiFetch<{ accepted: number }>("/v1/product-events", {
    method: "POST",
    body: JSON.stringify({ events: [event] }),
  }).catch(() => undefined);
}
