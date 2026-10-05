import { describe, expect, it } from "vitest";
import { telemetryResourceAttributes } from "../src/tracing.js";

describe("tracing resource identity", () => {
  it("uses the hosted deployment environment instead of the Node runtime mode", () => {
    expect(
      telemetryResourceAttributes({
        NODE_ENV: "production",
        OPENROUND_BUILD_ID: "a".repeat(40),
        OPENROUND_DEPLOYMENT_ENVIRONMENT: "staging",
        OTEL_SERVICE_NAME: "openround-server",
        OTEL_SERVICE_VERSION: "operator-override-must-not-win",
      }),
    ).toEqual({
      "service.name": "openround-server",
      "service.version": "a".repeat(40),
      "deployment.environment.name": "staging",
    });
  });

  it("falls back to the Node runtime mode outside hosted deployments", () => {
    expect(
      telemetryResourceAttributes({
        NODE_ENV: "test",
        OPENROUND_BUILD_ID: "unversioned",
        OPENROUND_DEPLOYMENT_ENVIRONMENT: undefined,
        OTEL_SERVICE_NAME: "openround-server",
        OTEL_SERVICE_VERSION: "test-build",
      }),
    ).toMatchObject({ "deployment.environment.name": "test" });
  });
});
