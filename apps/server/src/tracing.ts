import FastifyOtelInstrumentation from "@fastify/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { AppConfig } from "./config.js";

export interface TelemetryLifecycle {
  enabled: boolean;
  shutdown(): Promise<void>;
}

export function telemetryResourceAttributes(
  config: Pick<
    AppConfig,
    | "NODE_ENV"
    | "OPENROUND_BUILD_ID"
    | "OPENROUND_DEPLOYMENT_ENVIRONMENT"
    | "OTEL_SERVICE_NAME"
    | "OTEL_SERVICE_VERSION"
  >,
) {
  return {
    "service.name": config.OTEL_SERVICE_NAME,
    "service.version": config.OPENROUND_DEPLOYMENT_ENVIRONMENT
      ? config.OPENROUND_BUILD_ID
      : config.OTEL_SERVICE_VERSION,
    "deployment.environment.name": config.OPENROUND_DEPLOYMENT_ENVIRONMENT ?? config.NODE_ENV,
  };
}

export function startTelemetry(config: AppConfig): TelemetryLifecycle {
  if (!config.TRACING_ENABLED) {
    return { enabled: false, shutdown: async () => undefined };
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes(telemetryResourceAttributes(config)),
    traceExporter: new OTLPTraceExporter({
      url: config.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => {
          const path = request.url ?? "";
          return path.startsWith("/health/") || path === "/metrics";
        },
      }),
      new FastifyOtelInstrumentation({
        registerOnInitialization: true,
        instrumentHooks: false,
        ignorePaths: (options) => options.url.startsWith("/health/") || options.url === "/metrics",
      }),
    ],
  });
  sdk.start();
  return { enabled: true, shutdown: () => sdk.shutdown() };
}
