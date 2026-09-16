import { io, type Socket } from "socket.io-client";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";
const code = process.env.SESSION_CODE;
const clientCount = Number(process.env.CLIENTS ?? "50");
const holdSeconds = Number(process.env.HOLD_SECONDS ?? "30");

if (!code || !/^\d{7}$/.test(code)) {
  throw new Error("SESSION_CODE must be a seven-digit active session code");
}
if (!Number.isInteger(clientCount) || clientCount < 1 || clientCount > 1_000) {
  throw new Error("CLIENTS must be an integer between 1 and 1000");
}

interface Sample {
  joinMs: number;
  connected: boolean;
  error?: string;
}

const sockets: Socket[] = [];
const samples: Sample[] = [];

async function connectParticipant(index: number) {
  const started = performance.now();
  const socket = io(apiUrl, { transports: ["websocket"], reconnection: true, timeout: 10_000 });
  sockets.push(socket);
  return new Promise<void>((resolve) => {
    const finish = (sample: Sample) => {
      samples.push(sample);
      resolve();
    };
    socket.once("connect_error", (error) =>
      finish({ joinMs: performance.now() - started, connected: false, error: error.message }),
    );
    socket.once("connect", () => {
      socket.emit(
        "session.join",
        { code, nickname: `Load ${String(index + 1).padStart(4, "0")}` },
        (response: { data?: unknown; error?: { message: string } }) => {
          finish({
            joinMs: performance.now() - started,
            connected: Boolean(response.data),
            error: response.error?.message,
          });
        },
      );
    });
  });
}

for (let offset = 0; offset < clientCount; offset += 25) {
  await Promise.all(
    Array.from({ length: Math.min(25, clientCount - offset) }, (_, index) =>
      connectParticipant(offset + index),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const successful = samples.filter((sample) => sample.connected).sort((a, b) => a.joinMs - b.joinMs);
const percentile = (fraction: number) =>
  successful[Math.min(successful.length - 1, Math.floor(successful.length * fraction))]?.joinMs ??
  null;
process.stdout.write(
  `${JSON.stringify(
    {
      requested: clientCount,
      connected: successful.length,
      failed: samples.length - successful.length,
      joinLatencyMs: {
        p50: percentile(0.5),
        p95: percentile(0.95),
        max: successful.at(-1)?.joinMs ?? null,
      },
      errors: samples
        .filter((sample) => sample.error)
        .slice(0, 10)
        .map((sample) => sample.error),
    },
    null,
    2,
  )}\n`,
);

await new Promise((resolve) => setTimeout(resolve, holdSeconds * 1_000));
for (const socket of sockets) socket.disconnect();

if (successful.length !== clientCount) process.exitCode = 1;
