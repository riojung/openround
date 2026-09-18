import { apiFetch } from "../../lib/api";

type CreationPath = "starter" | "source" | "import" | "blank";

export function recordCreationEvent(
  name: "creation_started" | "creation_completed",
  creationPath: CreationPath,
) {
  void apiFetch<{ accepted: number }>("/v1/product-events", {
    method: "POST",
    body: JSON.stringify({
      events: [
        {
          name,
          occurredAt: new Date().toISOString(),
          dimensions: { creationPath },
        },
      ],
    }),
  }).catch(() => undefined);
}
