import { execFileSync } from "node:child_process";

const image = "prom/alertmanager:v0.34.0";
const mount = `${process.cwd()}/infra/observability:/etc/alertmanager:ro`;
const run = (...args) =>
  execFileSync(
    "docker",
    ["run", "--rm", "--volume", mount, "--entrypoint", "/bin/amtool", image, ...args],
    { stdio: "inherit" },
  );

run("check-config", "/etc/alertmanager/alertmanager.example.yml");
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
}
