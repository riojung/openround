import { execFileSync } from "node:child_process";
import process from "node:process";

const image =
  "otel/opentelemetry-collector-contrib@sha256:fd328de2552466ad78385e1b1289c3f2402b1c45f265b252aab1955b42845ac1";
const sharedEnvironment = [
  "--env",
  "OPENROUND_METRICS_TOKEN=example-metrics-token-at-least-24-characters",
  "--env",
  "OPENROUND_DEPLOYMENT=single-vm-staging",
  "--env",
  "OPENROUND_OTLP_BACKEND_ENDPOINT=https://telemetry.example.invalid",
  "--env",
  "OPENROUND_OTLP_BACKEND_TOKEN=example-backend-token",
];

function validate(config, environment = []) {
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      ...sharedEnvironment,
      ...environment,
      "--volume",
      `${process.cwd()}/infra/observability/${config}:/etc/otelcol-contrib/config.yaml:ro`,
      image,
      "validate",
      "--config=/etc/otelcol-contrib/config.yaml",
    ],
    { stdio: "inherit" },
  );
}

validate("otel-collector.example.yml", ["--env", "OPENROUND_METRICS_TARGET=api.example.ca"]);
validate("otel-collector.single-vm.yml");
