import { ProductEventSchema, type ProductEvent, type ProductEventName } from "@openround/contracts";
import { apiFetch } from "../../lib/api";

type CreationPath = "starter" | "source" | "import" | "blank";
type ArtifactType = "round" | "presentation";
type AuthoringEventName =
  | "first_block_created"
  | "draft_save_failed"
  | "draft_conflict"
  | "publish_blocked"
  | "creation_abandoned"
  | "presentation_host_started"
  | "presentation_reconnected";

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
  artifactType: ArtifactType,
) {
  recordProductEvent(name, { creationPath, artifactType });
}

export function recordAuthoringEvent(name: AuthoringEventName, artifactType: ArtifactType) {
  recordProductEvent(name, { artifactType });
}

export function recordFollowupShared() {
  recordProductEvent("followup_shared");
}

export function recordPracticeAssignmentShared() {
  recordProductEvent("practice_assignment_shared");
}
