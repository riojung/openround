import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { io, type Socket } from "socket.io-client";

const baseUrl = (process.env.LOAD_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const browserOrigin = (process.env.LOAD_ORIGIN ?? baseUrl).replace(/\/$/, "");
const code = process.env.PRESENTATION_CODE?.trim();
const clientCount = Number(process.env.CLIENTS ?? "50");
const batchSize = Number(process.env.JOIN_BATCH_SIZE ?? "20");
const holdSeconds = Number(process.env.HOLD_SECONDS ?? "5");
const assertPerformance = process.env.ASSERT_PERFORMANCE === "true";
const requireAnswer = process.env.REQUIRE_ANSWER === "true" || assertPerformance;
const outputPath = process.env.LOAD_OUTPUT?.trim();

if (!code || !/^\d{7}$/.test(code)) {
  throw new Error("PRESENTATION_CODE must identify an active seven-digit Presentation room");
}
if (!Number.isInteger(clientCount) || clientCount < 1 || clientCount > 250) {
  throw new Error("CLIENTS must be an integer between 1 and 250");
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
  throw new Error("JOIN_BATCH_SIZE must be an integer between 1 and 50");
}

interface Ack<T> {
  data?: T;
  error?: { code: string; message: string };
}

interface ParticipantSnapshot {
  sessionId: string;
  revision: number;
  seq: number;
  phase: string;
  currentBlock: null | {
    id: string;
    kind: "content" | "question";
    question?: {
      type: string;
      confidence?: "off" | "optional" | "required";
      choices?: Array<{ id: string }>;
      rating?: { min: number };
      min?: number;
    };
  };
}

interface Participant {
  socket: Socket;
  participantToken: string;
  snapshot: ParticipantSnapshot;
  joinMs: number;
}

function percentile(samples: number[], fraction: number) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

function emitAck<T>(socket: Socket, event: string, payload: unknown, timeoutMs = 15_000) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${event} acknowledgement timed out`)),
      timeoutMs,
    );
    socket.emit(event, payload, (response: Ack<T>) => {
      clearTimeout(timeout);
      if (response.error) {
        reject(new Error(`${event} failed (${response.error.code}): ${response.error.message}`));
      } else if (response.data === undefined) {
        reject(new Error(`${event} returned no data`));
      } else {
        resolve(response.data);
      }
    });
  });
}

function connectSocket() {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 10_000,
    forceNew: true,
    extraHeaders: { origin: browserOrigin },
  });
  return new Promise<Socket>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Socket connection timed out")), 12_000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.on("presentation.session.updated", (_envelope, acknowledge?: () => void) =>
        acknowledge?.(),
      );
      socket.on("presentation.room-status.updated", (_envelope, acknowledge?: () => void) =>
        acknowledge?.(),
      );
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function responseFor(snapshot: ParticipantSnapshot) {
  const block = snapshot.currentBlock;
  if (snapshot.phase !== "question_open" || block?.kind !== "question" || !block.question) {
    return null;
  }
  const confidence = block.question.confidence === "off" ? {} : { confidence: 3 };
  if (block.question.type === "numeric") return { numericValue: "0", ...confidence };
  if (block.question.type === "rating") {
    return { ratingValue: block.question.rating?.min ?? block.question.min ?? 1, ...confidence };
  }
  const firstChoice = block.question.choices?.[0]?.id;
  return firstChoice ? { choiceIds: [firstChoice], ...confidence } : null;
}

async function main() {
  const sockets = new Set<Socket>();
  const participants: Participant[] = [];
  const failures: string[] = [];

  try {
    for (let offset = 0; offset < clientCount; offset += batchSize) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(batchSize, clientCount - offset) }, async (_, index) => {
          const participantNumber = offset + index + 1;
          const startedAt = performance.now();
          try {
            const socket = await connectSocket();
            sockets.add(socket);
            const joined = await emitAck<{
              participantToken: string;
              snapshot: ParticipantSnapshot;
            }>(socket, "presentation.join", {
              code,
              nickname: `Presentation load ${String(participantNumber).padStart(3, "0")}`,
            });
            return {
              socket,
              participantToken: joined.participantToken,
              snapshot: joined.snapshot,
              joinMs: performance.now() - startedAt,
            } satisfies Participant;
          } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error));
            return null;
          }
        }),
      );
      participants.push(
        ...batch.filter((participant): participant is Participant => participant !== null),
      );
    }

    const answerSamples: number[] = [];
    await Promise.all(
      participants.map(async (participant) => {
        const response = responseFor(participant.snapshot);
        const block = participant.snapshot.currentBlock;
        if (!response || block?.kind !== "question") return;
        const startedAt = performance.now();
        try {
          await emitAck(participant.socket, "presentation.response.submit", {
            sessionId: participant.snapshot.sessionId,
            participantToken: participant.participantToken,
            blockId: block.id,
            expectedRevision: participant.snapshot.revision,
            idempotencyKey: randomUUID(),
            response,
          });
          answerSamples.push(performance.now() - startedAt);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }),
    );

    const joinSamples = participants.map(({ joinMs }) => joinMs);
    const result = {
      target: baseUrl,
      requested: clientCount,
      joined: participants.length,
      answered: answerSamples.length,
      failed: failures.length,
      joinLatencyMs: {
        p50: percentile(joinSamples, 0.5),
        p95: percentile(joinSamples, 0.95),
        max: percentile(joinSamples, 1),
      },
      answerAcknowledgementLatencyMs: {
        p50: percentile(answerSamples, 0.5),
        p95: percentile(answerSamples, 0.95),
        p99: percentile(answerSamples, 0.99),
        max: percentile(answerSamples, 1),
      },
      errors: failures.slice(0, 20),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    process.stdout.write(serialized);
    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, serialized, { encoding: "utf8", mode: 0o600 });
    }

    assert.equal(participants.length, clientCount, "every requested participant must join");
    assert.equal(failures.length, 0, "the run must not lose or reject an accepted operation");
    if (requireAnswer)
      assert.equal(answerSamples.length, clientCount, "the room must be question-open");
    if (assertPerformance) {
      assert.ok((result.joinLatencyMs.p95 ?? Infinity) < 500, "join p95 must be below 500 ms");
      if (answerSamples.length) {
        assert.ok(
          (result.answerAcknowledgementLatencyMs.p95 ?? Infinity) < 250,
          "answer acknowledgement p95 must be below 250 ms",
        );
        assert.ok(
          (result.answerAcknowledgementLatencyMs.p99 ?? Infinity) < 600,
          "answer acknowledgement p99 must be below 600 ms",
        );
      }
    }

    await new Promise((resolve) => setTimeout(resolve, holdSeconds * 1_000));
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
