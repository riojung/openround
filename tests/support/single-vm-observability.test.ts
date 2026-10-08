import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

async function readYaml(relativePath: string) {
  return parse(await readFile(join(repositoryRoot, relativePath), "utf8")) as Record<string, any>;
}

describe("single-VM observability deployment", () => {
  it("pins every observability image and publishes only loopback administration ports", async () => {
    const compose = await readYaml("compose.single-vm.observability.yaml");
    const services = compose.services as Record<string, Record<string, any>>;

    for (const name of [
      "otel-healthcheck-install",
      "otel-collector",
      "prometheus",
      "alertmanager",
    ]) {
      expect(services[name].image).toMatch(/@sha256:[0-9a-f]{64}$/);
      expect(services[name].image).not.toContain(":latest");
      expect(services[name].read_only).toBe(true);
      expect(services[name].cap_drop).toContain("ALL");
    }
    for (const name of ["otel-collector", "prometheus", "alertmanager"]) {
      expect(services[name].healthcheck).toBeDefined();
    }

    expect(services["otel-collector"].healthcheck.test).toEqual([
      "CMD",
      "/healthcheck/busybox",
      "wget",
      "--spider",
      "--quiet",
      "http://127.0.0.1:13133/",
    ]);
    expect(JSON.stringify(services["otel-collector"].healthcheck)).not.toContain("validate");
    expect(services["otel-healthcheck-install"].network_mode).toBe("none");
    expect(services["otel-collector"].depends_on["otel-healthcheck-install"].condition).toBe(
      "service_completed_successfully",
    );

    expect(services["otel-collector"].ports).toEqual([
      "127.0.0.1:${OPENROUND_OTEL_HEALTH_PORT:-13133}:13133",
    ]);
    expect(services.prometheus.ports).toEqual([
      "127.0.0.1:${OPENROUND_PROMETHEUS_PORT:-9090}:9090",
    ]);
    expect(services.alertmanager.ports).toEqual([
      "127.0.0.1:${OPENROUND_ALERTMANAGER_PORT:-9093}:9093",
    ]);
    expect(JSON.stringify(compose)).not.toMatch(/(?:^|:)431[78]:431[78]/);

    expect(compose.networks.telemetry.internal).toBe(true);
    expect(compose.networks.monitoring.internal).toBe(true);
    expect(services.server.networks).toEqual(["telemetry"]);
    expect(services["otel-collector"].networks).toEqual(["telemetry", "telemetry-egress"]);
    expect(services.prometheus.networks).toEqual(["telemetry", "monitoring"]);
    expect(services.alertmanager.networks).toEqual(["monitoring", "alerting-egress"]);
    expect(
      services["otel-collector"].networks.filter((network: string) =>
        services.alertmanager.networks.includes(network),
      ),
    ).toEqual([]);
  });

  it("scrapes protected application metrics privately and exports both signals with authentication", async () => {
    const collector = await readYaml("infra/observability/otel-collector.single-vm.yml");
    const scrape = collector.receivers.prometheus.config.scrape_configs[0];

    expect(scrape.scheme).toBe("http");
    expect(scrape.metrics_path).toBe("/metrics");
    expect(scrape.static_configs[0].targets).toEqual(["server:4000"]);
    expect(scrape.authorization).toEqual({
      type: "Bearer",
      credentials: "${env:OPENROUND_METRICS_TOKEN}",
    });
    expect(collector.receivers.otlp.protocols).toHaveProperty("grpc.endpoint", "0.0.0.0:4317");
    expect(collector.receivers.otlp.protocols).toHaveProperty("http.endpoint", "0.0.0.0:4318");
    expect(collector.exporters["otlphttp/backend"]).toMatchObject({
      endpoint: "${env:OPENROUND_OTLP_BACKEND_ENDPOINT}",
      headers: { Authorization: "Bearer ${env:OPENROUND_OTLP_BACKEND_TOKEN}" },
    });
    expect(collector.service.pipelines.traces.exporters).toEqual(["otlphttp/backend"]);
    expect(collector.service.pipelines.metrics.exporters).toEqual(["otlphttp/backend"]);
  });

  it("routes evaluated Prometheus alerts through secret-backed Alertmanager receivers", async () => {
    const prometheus = await readYaml("infra/observability/prometheus.single-vm.yml");
    const alertmanager = await readYaml("infra/observability/alertmanager.single-vm.yml");
    const openRoundScrape = prometheus.scrape_configs.find(
      (entry: { job_name?: string }) => entry.job_name === "openround",
    );

    expect(prometheus.alerting.alertmanagers[0].static_configs[0].targets).toEqual([
      "alertmanager:9093",
    ]);
    expect(prometheus.rule_files).toContain("/etc/prometheus/alerts.yml");
    expect(openRoundScrape.static_configs[0].targets).toEqual(["server:4000"]);
    expect(openRoundScrape.authorization).toEqual({
      type: "Bearer",
      credentials_file: "/run/pollingpops/metrics-token",
    });
    expect(openRoundScrape.static_configs[0].labels.deployment).toBe("__OPENROUND_DEPLOYMENT__");

    const compose = await readYaml("compose.single-vm.observability.yaml");
    expect(compose.services.prometheus.environment.OPENROUND_DEPLOYMENT).toBe(
      "${OPENROUND_DEPLOYMENT_ENVIRONMENT:?Set OPENROUND_DEPLOYMENT_ENVIRONMENT}",
    );
    expect(compose.services.prometheus.entrypoint.join("\n")).toContain(
      "s/__OPENROUND_DEPLOYMENT__/$$OPENROUND_DEPLOYMENT/g",
    );

    const receiverFiles = new Map(
      alertmanager.receivers.map((receiver: Record<string, any>) => [
        receiver.name,
        receiver.webhook_configs[0].url_file,
      ]),
    );
    expect(receiverFiles).toEqual(
      new Map([
        ["paging", "/run/pollingpops/paging-url"],
        ["warnings", "/run/pollingpops/warning-url"],
        ["tickets", "/run/pollingpops/ticket-url"],
      ]),
    );
  });

  it("ships the overlay and requires observability inputs for hosted targets", async () => {
    for (const environment of ["staging", "production"]) {
      const config = JSON.parse(
        await readFile(join(repositoryRoot, `config/deploy/${environment}.json`), "utf8"),
      ) as Record<string, any>;
      expect(config.singleVm.composeFiles).toContain("compose.single-vm.observability.yaml");
      expect(config.singleVm.deploymentFiles).toEqual(
        expect.arrayContaining([
          "infra/observability/alerts.yml",
          "infra/observability/alertmanager.single-vm.yml",
          "infra/observability/otel-collector.single-vm.yml",
          "infra/observability/prometheus.single-vm.yml",
        ]),
      );
    }

    const exampleEnvironment = await readFile(
      join(repositoryRoot, ".env.single-vm.example"),
      "utf8",
    );
    expect(exampleEnvironment).toMatch(/^METRICS_ENABLED=true$/m);
    expect(exampleEnvironment).toMatch(/^TRACING_ENABLED=true$/m);
    expect(exampleEnvironment).toMatch(
      /^OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http:\/\/otel-collector:4318\/v1\/traces$/m,
    );
    expect(exampleEnvironment).toMatch(
      /^OPENROUND_OTLP_BACKEND_ENDPOINT=replace-with-reviewed-https-otlp-endpoint$/m,
    );
  });
});
