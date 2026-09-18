import { io } from "socket.io-client";
import type { AudienceEventEnvelope } from "@openround/contracts";
import type { SessionSnapshot } from "@openround/contracts";
import { API_URL } from "./api";

export function withRealtimeReceipt<T>(handler: (envelope: T) => void) {
  return (envelope: T, acknowledge?: () => void) => {
    acknowledge?.();
    handler(envelope);
  };
}

export function createAudienceRealtimeReceipt(
  handler: (gap: boolean, envelope: AudienceEventEnvelope) => void,
) {
  let audienceSeq = 0;
  const seen = new Set<string>();
  const order: string[] = [];
  const seenProjections = new Set<string>();
  const projectionOrder: string[] = [];
  return withRealtimeReceipt((envelope: AudienceEventEnvelope) => {
    const projectionKey = `${envelope.audienceSeq}:${envelope.type}`;
    if (
      seen.has(envelope.eventId) ||
      seenProjections.has(projectionKey) ||
      envelope.audienceSeq < audienceSeq
    )
      return;
    const gap = audienceSeq > 0 && envelope.audienceSeq > audienceSeq + 1;
    audienceSeq = Math.max(audienceSeq, envelope.audienceSeq);
    seen.add(envelope.eventId);
    order.push(envelope.eventId);
    seenProjections.add(projectionKey);
    projectionOrder.push(projectionKey);
    if (order.length > 500) seen.delete(order.shift()!);
    if (projectionOrder.length > 1_000) seenProjections.delete(projectionOrder.shift()!);
    handler(gap, envelope);
  });
}

export function createRealtimeClient() {
  return io(API_URL, {
    autoConnect: false,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4_000,
    timeout: 8_000,
  });
}

export function audienceContextKey(snapshot: SessionSnapshot | null) {
  if (
    snapshot?.phase === "intervention" &&
    snapshot.intervention &&
    snapshot.intervention.finishedAt === null
  ) {
    return `intervention:${snapshot.intervention.id}`;
  }
  return snapshot?.roundId ? `round:${snapshot.roundId}` : "lobby";
}
