import { ProductEventSchema, type ProductEvent, type ProductEventName } from "@openround/contracts";
import { apiFetch } from "../../lib/api";

type CreationPath = "starter" | "source" | "import" | "blank";

export function buildProductEvent(
  name: ProductEventName,
  dimensions: ProductEvent["dimensions"] = {},
  occurredAt = new Date(),
): ProductEvent {
  return ProductEventSchema.parse({ name, occurredAt: occurredAt.toISOString(), dimensions });
}

export function recordProductEvent(
  name: ProductEventName,
  dimensions: ProductEvent["dimensions"] = {},
) {
  void apiFetch<{ accepted: number }>("/v1/product-events", {
    method: "POST",
    body: JSON.stringify({
      events: [buildProductEvent(name, dimensions)],
    }),
  }).catch(() => undefined);
}

export function recordCreationEvent(
  name: "creation_started" | "creation_completed",
  creationPath: CreationPath,
) {
  recordProductEvent(name, { creationPath });
}

export function recordFollowupShared() {
  recordProductEvent("followup_shared");
}
