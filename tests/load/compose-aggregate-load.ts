import assert from "node:assert/strict";
import { execFile } from "node:child_process";

const sessionCount = Number(process.env.SESSIONS ?? "10");
const clientsPerSession = Number(process.env.CLIENTS_PER_SESSION ?? "100");
const joinBatchSize = Number(process.env.JOIN_BATCH_SIZE ?? "20");
const sessionStaggerMs = Number(process.env.SESSION_STAGGER_MS ?? "750");
const assertPerformance = process.env.ASSERT_PERFORMANCE === "true";

if (!Number.isInteger(sessionCount) || sessionCount < 1 || sessionCount > 20) {
  throw new Error("SESSIONS must be an integer between 1 and 20");
}
if (!Number.isInteger(clientsPerSession) || clientsPerSession < 1 || clientsPerSession > 250) {
  throw new Error("CLIENTS_PER_SESSION must be an integer between 1 and 250");
}
if (sessionCount * clientsPerSession > 2_000) {
  throw new Error("The aggregate harness is limited to 2,000 simultaneous clients");
}
if (!Number.isInteger(sessionStaggerMs) || sessionStaggerMs < 0 || sessionStaggerMs > 5_000) {
  throw new Error("SESSION_STAGGER_MS must be an integer between 0 and 5000");
}

interface GameLoadResult {
  clients: number;
  correctness: {
    acceptedAnswers: number;
    duplicateScoreEffects: number;
    answerKeyLeak: boolean;
    reconnectReplayComplete: boolean;
    processRestart: "recovered" | "not_run";
  };
  latencyMs: {
    join: { p50: number; p95: number };
    answerAcknowledgement: { p50: number; p95: number; p99: number };
    questionBroadcast: { p95: number; max: number };
    reconnectSnapshot: number;
    restartRecovery: number | null;
    reportAvailable: number;
  };
}

function runSession(index: number, startAtMs: number, answerAtMs: number) {
  return new Promise<GameLoadResult>((resolve, reject) => {
    execFile(
      "pnpm",
      ["exec", "tsx", "tests/load/compose-game-load.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CLIENTS: String(clientsPerSession),
          JOIN_BATCH_SIZE: String(joinBatchSize),
          // Aggregate thresholds are evaluated after every child has returned so a failure
          // still reports the complete worst-session result.
          ASSERT_PERFORMANCE: "false",
          RESTART_SERVER: "false",
          LOAD_RUN_ID: `aggregate-${index + 1}`,
          START_AT_MS: String(startAtMs),
          ANSWER_AT_MS: String(answerAtMs),
        },
        maxBuffer: 2 * 1024 * 1024,
        timeout: 120_000,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `Aggregate session ${index + 1} failed: ${stderr.trim() || stdout.trim() || error.message}`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim()) as GameLoadResult);
        } catch (parseError) {
          reject(
            new Error(
              `Aggregate session ${index + 1} returned invalid JSON: ${String(parseError)}\n${stdout}`,
            ),
          );
        }
      },
    );
  });
}

async function main() {
  const startedAt = performance.now();
  const synchronizedStartAtMs =
    Date.now() + Math.max(20_000, sessionCount * sessionStaggerMs + 10_000);
  // Measure question-open fanout and synchronized answer persistence as separate
  // phases. Every child still submits together, but no session starts its answer
  // SLA while another session is still opening the question.
  const synchronizedAnswerAtMs = synchronizedStartAtMs + 5_000;
  const runs: Array<Promise<GameLoadResult>> = [];
  for (let index = 0; index < sessionCount; index += 1) {
    runs.push(runSession(index, synchronizedStartAtMs, synchronizedAnswerAtMs));
    if (sessionStaggerMs > 0 && index < sessionCount - 1) {
      await new Promise((resolve) => setTimeout(resolve, sessionStaggerMs));
    }
  }
  const attempts = await Promise.allSettled(runs);
  const failures = attempts.flatMap((attempt, index) =>
    attempt.status === "rejected" ? [{ index, reason: attempt.reason }] : [],
  );
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${sessionCount} aggregate sessions failed:\n${failures
        .map(
          ({ index, reason }) =>
            `Session ${index + 1}: ${reason instanceof Error ? reason.message : String(reason)}`,
        )
        .join("\n")}`,
    );
  }
  const sessions = attempts.map(
    (attempt) => (attempt as PromiseFulfilledResult<GameLoadResult>).value,
  );
  const elapsedMs = performance.now() - startedAt;

  const totalClients = sessionCount * clientsPerSession;
  assert.equal(
    sessions.reduce((total, result) => total + result.correctness.acceptedAnswers, 0),
    totalClients,
  );
  assert.ok(sessions.every((result) => result.correctness.duplicateScoreEffects === 0));
  assert.ok(sessions.every((result) => !result.correctness.answerKeyLeak));
  assert.ok(sessions.every((result) => result.correctness.reconnectReplayComplete));

  const maximum = (select: (result: GameLoadResult) => number) => Math.max(...sessions.map(select));
  const result = {
    sessions: sessionCount,
    clientsPerSession,
    totalClients,
    elapsedMs,
    sessionStaggerMs,
    correctness: {
      acceptedAnswers: totalClients,
      duplicateScoreEffects: 0,
      answerKeyLeak: false,
      reconnectReplayComplete: true,
      reportsReconciled: sessionCount,
    },
    worstSessionLatencyMs: {
      joinP95: maximum((session) => session.latencyMs.join.p95),
      answerAcknowledgementP95: maximum((session) => session.latencyMs.answerAcknowledgement.p95),
      answerAcknowledgementP99: maximum((session) => session.latencyMs.answerAcknowledgement.p99),
      questionBroadcastP95: maximum((session) => session.latencyMs.questionBroadcast.p95),
      reconnectSnapshot: maximum((session) => session.latencyMs.reconnectSnapshot),
      reportAvailable: maximum((session) => session.latencyMs.reportAvailable),
    },
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (assertPerformance) {
    assert.ok(result.worstSessionLatencyMs.joinP95 < 500, "Join p95 exceeded 500 ms");
    assert.ok(
      result.worstSessionLatencyMs.answerAcknowledgementP95 < 250,
      "Answer acknowledgement p95 exceeded 250 ms",
    );
    assert.ok(
      result.worstSessionLatencyMs.answerAcknowledgementP99 < 600,
      "Answer acknowledgement p99 exceeded 600 ms",
    );
    assert.ok(
      result.worstSessionLatencyMs.questionBroadcastP95 < 500,
      "Question broadcast p95 exceeded 500 ms",
    );
    assert.ok(result.worstSessionLatencyMs.reconnectSnapshot < 2_000, "Reconnect exceeded 2 s");
    assert.ok(result.worstSessionLatencyMs.reportAvailable < 60_000, "Report exceeded 60 s");
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
