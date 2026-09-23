import { execFileSync } from "node:child_process";

execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "--env",
    "OPENROUND_METRICS_TOKEN=example-metrics-token-at-least-24-characters",
    "--env",
    "OPENROUND_METRICS_TARGET=api.example.ca",
    "--env",
    "OPENROUND_DEPLOYMENT=single-vm-staging",
    "--env",
    "OPENROUND_OTLP_BACKEND_ENDPOINT=https://telemetry.example.invalid",
    "--env",
    "OPENROUND_OTLP_BACKEND_TOKEN=example-backend-token",
    "--volume",
    `${process.cwd()}/infra/observability/otel-collector.example.yml:/etc/otelcol-contrib/config.yaml:ro`,
    "otel/opentelemetry-collector-contrib:0.161.0",
    "validate",
    "--config=/etc/otelcol-contrib/config.yaml",
  ],
  { stdio: "inherit" },
);
