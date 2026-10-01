import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAlertRehearsal } from "../../scripts/ops/alert-rehearsal.mjs";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function listeningServer(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address");
  return `http://127.0.0.1:${address.port}`;
}

function baseEnvironment(url: string, output: string) {
  return {
    ALERT_REHEARSAL_URL: url,
    ALERT_REHEARSAL_ALLOW_HTTP: "true",
    ALERT_REHEARSAL_CONFIRM: "send-and-resolve-synthetic-alerts",
    ALERT_REHEARSAL_BUILD_ID: "a".repeat(40),
    ALERT_REHEARSAL_DEPLOYMENT: "single-vm-staging",
    ALERT_REHEARSAL_WAIT_SECONDS: "0",
    ALERT_REHEARSAL_OUTPUT: output,
    ALERT_REHEARSAL_TOKEN: "secret-token",
  };
}

describe("alert rehearsal", () => {
  it("injects and resolves all three routes without writing the receiver secret", async () => {
    const requests: Array<{ path: string; authorization?: string; body: unknown }> = [];
    const url = await listeningServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        requests.push({
          path: request.url ?? "",
          authorization: request.headers.authorization,
          body: JSON.parse(body),
        });
        response.writeHead(200).end();
      });
    });
    const directory = await mkdtemp(join(tmpdir(), "openround-alert-rehearsal-"));
    const output = join(directory, "evidence.json");
    const evidence = await runAlertRehearsal({
      environment: baseEnvironment(url, output),
      now: () => new Date("2026-09-27T12:00:00Z"),
      uuid: () => "00000000-0000-4000-8000-000000000001",
      minimumWaitSeconds: 0,
    });

    expect(requests).toHaveLength(2);
    expect(requests.every(({ path }) => path === "/api/v2/alerts")).toBe(true);
    expect(requests.every(({ authorization }) => authorization === "Bearer secret-token")).toBe(
      true,
    );
    expect(
      (requests[0]?.body as Array<{ labels: { severity: string } }>).map(
        ({ labels }) => labels.severity,
      ),
    ).toEqual(["page", "warning", "ticket"]);
    expect(
      (requests[1]?.body as Array<{ endsAt?: string }>).every(({ endsAt }) => Boolean(endsAt)),
    ).toBe(true);
    expect(evidence.outcome).toBe("requests_accepted");

    const saved = await readFile(output, "utf8");
    expect(saved).not.toContain("secret-token");
    expect(saved).not.toContain(url);
    expect(JSON.parse(saved)).toMatchObject({
      schemaVersion: 1,
      rehearsalId: "00000000-0000-4000-8000-000000000001",
      routes: {
        page: { injectedHttpStatus: 200, resolvedHttpStatus: 200 },
        warning: { injectedHttpStatus: 200, resolvedHttpStatus: 200 },
        ticket: { injectedHttpStatus: 200, resolvedHttpStatus: 200 },
      },
    });
  });

  it("fails closed without confirmation or for a non-loopback HTTP target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openround-alert-rehearsal-"));
    const output = join(directory, "evidence.json");
    const environment = baseEnvironment("https://alerts.openround.dev", output);
    delete (environment as { ALERT_REHEARSAL_CONFIRM?: string }).ALERT_REHEARSAL_CONFIRM;
    await expect(runAlertRehearsal({ environment })).rejects.toThrow(/ALERT_REHEARSAL_CONFIRM/);

    await expect(
      runAlertRehearsal({
        environment: {
          ...baseEnvironment("http://alerts.openround.dev", output),
          ALERT_REHEARSAL_CONFIRM: "send-and-resolve-synthetic-alerts",
        },
      }),
    ).rejects.toThrow(/must use HTTPS/);
  });

  it("keeps firing alerts active beyond the checked-in Alertmanager group wait", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openround-alert-rehearsal-"));
    const output = join(directory, "evidence.json");
    const tooShort = {
      ...baseEnvironment("https://alerts.openround.dev", output),
      ALERT_REHEARSAL_WAIT_SECONDS: "30",
    };
    await expect(runAlertRehearsal({ environment: tooShort })).rejects.toThrow(/must be 35-300/);

    const defaultWait = { ...tooShort };
    delete (defaultWait as { ALERT_REHEARSAL_WAIT_SECONDS?: string }).ALERT_REHEARSAL_WAIT_SECONDS;
    const waits: number[] = [];
    const evidence = await runAlertRehearsal({
      environment: defaultWait,
      fetchImpl: async () => new Response(null, { status: 200 }),
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });
    expect(evidence.waitSeconds).toBe(45);
    expect(waits).toEqual([45_000]);
  });

  it("still sends a resolution payload and writes failed evidence after injection failure", async () => {
    let calls = 0;
    const url = await listeningServer((_request, response) => {
      calls += 1;
      response.writeHead(calls === 1 ? 503 : 200).end();
    });
    const directory = await mkdtemp(join(tmpdir(), "openround-alert-rehearsal-"));
    const output = join(directory, "evidence.json");

    await expect(
      runAlertRehearsal({
        environment: baseEnvironment(url, output),
        minimumWaitSeconds: 0,
      }),
    ).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(2);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      outcome: "failed",
      failure: "alert-request-failed",
    });
  });

  it("rejects redirects instead of treating another endpoint's response as acceptance", async () => {
    let calls = 0;
    const url = await listeningServer((_request, response) => {
      calls += 1;
      response.writeHead(302, { location: "http://127.0.0.1:1/not-alertmanager" }).end();
    });
    const directory = await mkdtemp(join(tmpdir(), "openround-alert-rehearsal-"));
    const output = join(directory, "evidence.json");

    await expect(
      runAlertRehearsal({
        environment: baseEnvironment(url, output),
        minimumWaitSeconds: 0,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      outcome: "failed",
      failure: "alert-request-failed",
    });
  });
});
