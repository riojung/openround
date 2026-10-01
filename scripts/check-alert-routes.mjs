import { execFileSync } from "node:child_process";
import process from "node:process";

const image =
  "prom/alertmanager@sha256:690c7b525f4367aa91f73e2f91c632206d32e97c6384bdbf2fb7a861b420340d";
const prometheusImage =
  "prom/prometheus@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996";
const mount = `${process.cwd()}/infra/observability:/etc/alertmanager:ro`;
const run = (...args) =>
  execFileSync(
    "docker",
    ["run", "--rm", "--volume", mount, "--entrypoint", "/bin/amtool", image, ...args],
    { stdio: "inherit" },
  );
const singleVmCommand = [
  "umask 077",
  "printf '%s' 'https://paging.example.invalid/page' > /run/openround/paging-url",
  "printf '%s' 'https://paging.example.invalid/warning' > /run/openround/warning-url",
  "printf '%s' 'https://paging.example.invalid/ticket' > /run/openround/ticket-url",
  'exec /bin/amtool "$@"',
].join("\n");
const runSingleVm = (...args) =>
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--tmpfs",
      "/run/openround:rw,noexec,nosuid,size=1m,mode=0700,uid=65534,gid=65534",
      "--volume",
      mount,
      "--entrypoint",
      "/bin/sh",
      image,
      "-ec",
      singleVmCommand,
      "--",
      ...args,
    ],
    { stdio: "inherit" },
  );

execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "--tmpfs",
    "/run/openround:rw,noexec,nosuid,size=1m,mode=0700,uid=65534,gid=65534",
    "--volume",
    `${process.cwd()}/infra/observability/prometheus.single-vm.yml:/etc/prometheus/prometheus.yml.tmpl:ro`,
    "--volume",
    `${process.cwd()}/infra/observability/alerts.yml:/etc/prometheus/alerts.yml:ro`,
    "--entrypoint",
    "/bin/sh",
    prometheusImage,
    "-ec",
    "printf '%s' token > /run/openround/metrics-token; sed 's/__OPENROUND_DEPLOYMENT__/staging/g' /etc/prometheus/prometheus.yml.tmpl > /run/openround/prometheus.yml; grep -q 'deployment: staging' /run/openround/prometheus.yml; ! grep -q '__OPENROUND_DEPLOYMENT__' /run/openround/prometheus.yml; exec /bin/promtool check config /run/openround/prometheus.yml",
  ],
  { stdio: "inherit" },
);

run("check-config", "/etc/alertmanager/alertmanager.example.yml");
runSingleVm("check-config", "/etc/alertmanager/alertmanager.single-vm.yml");
for (const severity of ["page", "warning", "ticket"]) {
  const receiver = severity === "page" ? "paging" : severity === "warning" ? "warnings" : "tickets";
  run(
    "config",
    "routes",
    "test",
    `--config.file=/etc/alertmanager/alertmanager.example.yml`,
    `--verify.receivers=${receiver}`,
    `severity=${severity}`,
  );
  runSingleVm(
    "config",
    "routes",
    "test",
    `--config.file=/etc/alertmanager/alertmanager.single-vm.yml`,
    `--verify.receivers=${receiver}`,
    `severity=${severity}`,
  );
}
