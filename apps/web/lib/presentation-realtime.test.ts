import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  PresentationEventEnvelope,
  PresentationHostSnapshot,
  PresentationParticipantSnapshot,
  PresentationResponseAck,
  PresentationRoleSnapshot,
  PresentationSyncResponse,
} from "@openround/contracts";
import type { Socket } from "socket.io-client";
import {
  createPresentationRealtimeController,
  presentationSaveStateForBlock,
  shouldApplyPresentationSnapshot,
} from "./presentation-realtime";

const NOW = "2026-09-23T12:00:00.000Z";

function participantSnapshot(
  overrides: Partial<PresentationParticipantSnapshot> = {},
): PresentationParticipantSnapshot {
  return {
    sessionId: "8dce12bc-efb8-4b9c-9a60-2cf8e846fc33",
    artifactType: "presentation",
    presentationId: "1a36d53a-8c07-4a7f-a204-93ae21d64f34",
    presentationVersionId: "c91e1d24-e1f1-42c2-9319-fea02e55c043",
    projection: "participant",
    participantId: "34a98a18-2d53-4d20-9b35-28f17b09106a",
    title: "Recovery check",
    code: "1234567",
    status: "active",
    phase: "question_open",
    currentBlockIndex: 0,
    blockCount: 1,
    revision: 3,
    seq: 5,
    serverTime: NOW,
    questionOpenedAt: NOW,
    questionClosesAt: "2026-09-23T12:00:30.000Z",
    acceptingResponses: true,
    settings: { timeMode: "timed", trustMode: "learning" },
    currentBlock: {
      id: "1c6d42d6-5ffc-4782-a29d-8f1517a13852",
      kind: "question",
      question: {
        id: "4db807cf-e8d5-471b-9b2d-72eb9cf01f5a",
        type: "single_select",
        prompt: "Which choice is supported?",
        confidence: "off",
        choices: [
          { id: "6846c45c-7c3c-4348-86a5-c6e4e5bff962", label: "A" },
          { id: "33dc550e-53c2-402a-9125-001da929f371", label: "B" },
        ],
        timeLimitSeconds: 30,
        basePoints: 1_000,
        mediaId: null,
        mediaAlt: null,
      },
    },
    participantCount: 2,
    responseSubmitted: false,
    standing: null,
    responseResult: null,
    finishedAt: null,
    ...overrides,
  };
}

function hostSnapshot(overrides: Partial<PresentationHostSnapshot> = {}): PresentationHostSnapshot {
  const base = participantSnapshot();
  return {
    sessionId: base.sessionId,
    artifactType: "presentation",
    presentationId: base.presentationId,
    presentationVersionId: base.presentationVersionId,
    projection: "host",
    title: base.title,
    code: base.code,
    status: base.status,
    phase: base.phase,
    currentBlockIndex: base.currentBlockIndex,
    blockCount: base.blockCount,
    revision: base.revision,
    seq: base.seq,
    serverTime: base.serverTime,
    questionOpenedAt: base.questionOpenedAt,
    questionClosesAt: base.questionClosesAt,
    acceptingResponses: base.acceptingResponses,
    settings: base.settings,
    currentBlock: null,
    participantCount: 2,
    responseCount: 0,
    participants: [],
    roomStatus: {
      sessionId: base.sessionId,
      joinedCount: 2,
      connectedCount: 0,
      notCurrentlyConnectedCount: 2,
      responseCount: 0,
      sampledAt: NOW,
    },
    finishedAt: null,
    ...overrides,
  };
}

class FakeSocket {
  connected = false;
  private listeners = new Map<string, Array<(...args: never[]) => void>>();
  readonly emitted: Array<{ event: string; payload: unknown; ack?: (value: unknown) => void }> = [];

  on(event: string, listener: (...args: never[]) => void) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: string, payload: unknown, ack?: (value: unknown) => void) {
    this.emitted.push({ event, payload, ack });
    return this;
  }

  connect() {
    this.connected = true;
    this.fire("connect");
    return this;
  }

  disconnect() {
    this.connected = false;
    this.fire("disconnect");
    return this;
  }

  removeAllListeners() {
    this.listeners.clear();
    return this;
  }

  fire(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...(args as never[]));
    }
  }

  last(event: string) {
    return this.emitted.filter((entry) => entry.event === event).at(-1);
  }
}

function sync(socket: FakeSocket, snapshot: PresentationRoleSnapshot) {
  const pending = socket.last("presentation.sync.request");
  expect(pending).toBeDefined();
  pending!.ack?.({
    data: { resetRequired: false, events: [], snapshot } satisfies PresentationSyncResponse,
  });
}

describe("Presentation realtime snapshot fencing", () => {
  it("uses sequence before revision and ignores stale snapshots", () => {
    const current = { seq: 8, revision: 3, serverTime: "2026-09-23T12:00:30.000Z" };
    expect(
      shouldApplyPresentationSnapshot(current, {
        seq: 7,
        revision: 99,
        serverTime: "2026-09-23T12:00:31.000Z",
      }),
    ).toBe(false);
    expect(
      shouldApplyPresentationSnapshot(current, {
        seq: 8,
        revision: 2,
        serverTime: "2026-09-23T12:00:31.000Z",
      }),
    ).toBe(false);
    expect(
      shouldApplyPresentationSnapshot(current, {
        seq: 8,
        revision: 3,
        serverTime: "2026-09-23T12:00:29.000Z",
      }),
    ).toBe(false);
    expect(shouldApplyPresentationSnapshot(current, current)).toBe(false);
    expect(
      shouldApplyPresentationSnapshot(current, {
        seq: 8,
        revision: 3,
        serverTime: "2026-09-23T12:00:31.000Z",
      }),
    ).toBe(true);
    expect(
      shouldApplyPresentationSnapshot(current, {
        seq: 8,
        revision: 4,
        serverTime: "2026-09-23T12:00:29.000Z",
      }),
    ).toBe(true);
    expect(
      shouldApplyPresentationSnapshot(current, {
        seq: 9,
        revision: 3,
        serverTime: "2026-09-23T12:00:29.000Z",
      }),
    ).toBe(true);
  });

  it("refreshes deadline-derived state from a newer snapshot at the same durable fence", () => {
    const received: PresentationParticipantSnapshot[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: null,
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: (snapshot) => received.push(snapshot),
      onConnectionState: () => undefined,
    });

    expect(
      controller.applySnapshot(
        participantSnapshot({
          serverTime: "2026-09-23T12:00:29.000Z",
          acceptingResponses: true,
        }),
      ),
    ).toBe(true);
    expect(
      controller.applySnapshot(
        participantSnapshot({
          serverTime: "2026-09-23T12:00:31.000Z",
          acceptingResponses: false,
        }),
      ),
    ).toBe(true);
    expect(
      controller.applySnapshot(
        participantSnapshot({
          serverTime: "2026-09-23T12:00:30.000Z",
          acceptingResponses: true,
        }),
      ),
    ).toBe(false);

    expect(received.map(({ acceptingResponses }) => acceptingResponses)).toEqual([true, false]);
    expect(controller.latest()?.acceptingResponses).toBe(false);
    controller.stop();
  });

  it("does not apply a delayed realtime event after a newer sync", () => {
    const socket = new FakeSocket();
    const received: number[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: (snapshot) => received.push(snapshot.seq),
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
    });

    controller.start();
    sync(socket, participantSnapshot({ seq: 8, revision: 4 }));
    socket.fire("presentation.session.updated", {
      eventId: randomUUID(),
      sessionId: participantSnapshot().sessionId,
      revision: 99,
      seq: 7,
      type: "presentation.session.updated",
      serverTime: NOW,
      payload: participantSnapshot({ seq: 7, revision: 99 }),
    } satisfies PresentationEventEnvelope);

    expect(received).toEqual([8]);
    controller.stop();
  });

  it("coalesces concurrent synchronization attempts", async () => {
    const socket = new FakeSocket();
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, participantSnapshot());
    await Promise.resolve();

    const before = socket.emitted.filter(
      (entry) => entry.event === "presentation.sync.request",
    ).length;
    const first = controller.reconcile();
    const second = controller.reconcile();
    expect(second).toBe(first);
    expect(
      socket.emitted.filter((entry) => entry.event === "presentation.sync.request"),
    ).toHaveLength(before + 1);
    sync(socket, participantSnapshot({ seq: 6 }));
    await expect(first).resolves.toMatchObject({ seq: 6 });
    controller.stop();
  });

  it("accepts wrapped room-status events and rejects an older sample", () => {
    const socket = new FakeSocket();
    const connectedCounts: number[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onRoomStatus: (status) => connectedCounts.push(status.connectedCount),
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, participantSnapshot());
    const status = (connectedCount: number, sampledAt = NOW) => ({
      sessionId: participantSnapshot().sessionId,
      joinedCount: 2,
      connectedCount,
      notCurrentlyConnectedCount: 2 - connectedCount,
      responseCount: 0,
      sampledAt,
    });
    const envelope = (seq: number, connectedCount: number, sampledAt = NOW) => ({
      eventId: randomUUID(),
      sessionId: participantSnapshot().sessionId,
      revision: 3,
      seq,
      type: "presentation.room-status.updated" as const,
      serverTime: NOW,
      payload: { roomStatus: status(connectedCount, sampledAt) },
    });

    socket.fire("presentation.room-status.updated", envelope(8, 2));
    socket.fire("presentation.room-status.updated", envelope(9, 1));
    socket.fire("presentation.room-status.updated", envelope(1, 1, "2026-09-23T12:00:01.000Z"));

    expect(connectedCounts).toEqual([2, 1]);
    controller.stop();
  });

  it("uses the newer room-status sample across events and host snapshots", () => {
    const socket = new FakeSocket();
    const controller = createPresentationRealtimeController({
      sessionId: hostSnapshot().sessionId,
      credential: { projection: "host", controlToken: "h".repeat(32) },
      fetchSnapshot: async () => hostSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onRoomStatus: () => undefined,
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, hostSnapshot());

    socket.fire("presentation.room-status.updated", {
      eventId: randomUUID(),
      sessionId: hostSnapshot().sessionId,
      revision: 3,
      seq: 5,
      type: "presentation.room-status.updated",
      serverTime: "2026-09-23T12:00:01.000Z",
      payload: {
        roomStatus: {
          ...hostSnapshot().roomStatus,
          connectedCount: 2,
          notCurrentlyConnectedCount: 0,
          sampledAt: "2026-09-23T12:00:01.000Z",
        },
      },
    } satisfies PresentationEventEnvelope);

    controller.applySnapshot(
      hostSnapshot({
        seq: 5,
        serverTime: "2026-09-23T12:00:02.000Z",
        roomStatus: {
          ...hostSnapshot().roomStatus,
          sampledAt: "2026-09-23T12:00:02.000Z",
        },
      }),
    );

    expect(controller.latest()?.projection).toBe("host");
    expect((controller.latest() as PresentationHostSnapshot).roomStatus.connectedCount).toBe(0);

    controller.applySnapshot(
      hostSnapshot({
        seq: 6,
        serverTime: "2026-09-23T12:00:03.000Z",
        roomStatus: {
          ...hostSnapshot().roomStatus,
          connectedCount: 1,
          notCurrentlyConnectedCount: 1,
          sampledAt: "2026-09-23T12:00:01.500Z",
        },
      }),
    );

    expect((controller.latest() as PresentationHostSnapshot).roomStatus.connectedCount).toBe(0);
    controller.stop();
  });
});

describe("Presentation participant acknowledgement recovery", () => {
  it("settles a pending socket response from a disconnected REST reconciliation", async () => {
    const socket = new FakeSocket();
    const saveStates: string[] = [];
    let authoritative = participantSnapshot();
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => authoritative,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onSaveState: (state) => saveStates.push(state),
      socketFactory: () => socket as unknown as Socket,
      acknowledgementTimeoutMs: 500,
    });
    controller.start();
    sync(socket, participantSnapshot());
    await Promise.resolve();

    const blockId = participantSnapshot().currentBlock!.id;
    const idempotencyKey = randomUUID();
    const responseId = randomUUID();
    const submission = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId,
        expectedRevision: 3,
        idempotencyKey,
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST submission should not be repeated");
      },
    );
    socket.connected = false;
    authoritative = participantSnapshot({
      seq: 6,
      responseSubmitted: true,
      responseReceipt: { responseId, blockId, idempotencyKey, acceptedAt: NOW },
    });

    await controller.reconcile();
    await expect(submission).resolves.toMatchObject({
      responseId,
      idempotencyKey,
      accepted: true,
      duplicate: true,
    });
    expect(saveStates.at(-1)).toBe("saved");
    controller.stop();
  });

  it("rejects an unconfirmed pending response after disconnected reconciliation", async () => {
    const socket = new FakeSocket();
    const saveStates: string[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onSaveState: (state) => saveStates.push(state),
      socketFactory: () => socket as unknown as Socket,
      acknowledgementTimeoutMs: 10,
    });
    controller.start();
    sync(socket, participantSnapshot());
    await Promise.resolve();

    const submission = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId: participantSnapshot().currentBlock!.id,
        expectedRevision: 3,
        idempotencyKey: randomUUID(),
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST submission should not be repeated");
      },
    );
    socket.connected = false;

    await expect(submission).rejects.toThrow("did not confirm that response");
    expect(saveStates.at(-1)).toBe("idle");
    controller.stop();
  });

  it("rejects a pending response when disconnected reconciliation fails", async () => {
    const socket = new FakeSocket();
    let failFetch = false;
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => {
        if (failFetch) throw new Error("REST unavailable");
        return participantSnapshot();
      },
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
      acknowledgementTimeoutMs: 10,
    });
    controller.start();
    sync(socket, participantSnapshot());
    await Promise.resolve();

    const submission = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId: participantSnapshot().currentBlock!.id,
        expectedRevision: 3,
        idempotencyKey: randomUUID(),
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST submission should not be repeated");
      },
    );
    socket.connected = false;
    failFetch = true;

    await expect(submission).rejects.toThrow("did not confirm that response");
    controller.stop();
  });

  it("recovers a REST submission when the response is lost after the server commits it", async () => {
    const socket = new FakeSocket();
    const saveStates: string[] = [];
    let authoritative = participantSnapshot();
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => authoritative,
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onSaveState: (state) => saveStates.push(state),
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, participantSnapshot());
    await Promise.resolve();
    socket.fire("connect_error");
    socket.connected = false;

    const blockId = participantSnapshot().currentBlock!.id;
    const idempotencyKey = randomUUID();
    const responseId = randomUUID();
    authoritative = participantSnapshot({
      seq: 6,
      responseSubmitted: true,
      responseReceipt: { responseId, blockId, idempotencyKey, acceptedAt: NOW },
    });

    const result = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId,
        expectedRevision: 3,
        idempotencyKey,
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("Connection ended before the acknowledgement arrived");
      },
    );

    await expect(result).resolves.toMatchObject({
      responseId,
      idempotencyKey,
      accepted: true,
      duplicate: true,
    });
    expect(saveStates).toEqual(["saving", "reconnecting_not_saved", "saved"]);
    controller.stop();
  });

  it("recovers the durable response receipt when the original acknowledgement is lost", async () => {
    const socket = new FakeSocket();
    const saveStatuses: Array<{ state: string; blockId: string }> = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onSaveState: (state, blockId) => saveStatuses.push({ state, blockId }),
      socketFactory: () => socket as unknown as Socket,
      acknowledgementTimeoutMs: 500,
    });
    controller.start();
    sync(socket, participantSnapshot());

    const idempotencyKey = randomUUID();
    const responseId = randomUUID();
    const submittedBlockId = participantSnapshot().currentBlock!.id;
    const nextBlockId = randomUUID();
    const submission = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId: submittedBlockId,
        expectedRevision: 3,
        idempotencyKey,
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST should not be used");
      },
    );

    socket.disconnect();
    socket.connect();
    sync(
      socket,
      participantSnapshot({
        seq: 6,
        phase: "question_reveal",
        acceptingResponses: false,
        currentBlock: {
          ...participantSnapshot().currentBlock!,
          id: nextBlockId,
        },
        responseSubmitted: false,
        responseReceipt: {
          responseId,
          blockId: submittedBlockId,
          idempotencyKey,
          acceptedAt: NOW,
        },
      }),
    );

    await expect(submission).resolves.toMatchObject({
      responseId,
      idempotencyKey,
      duplicate: true,
    });
    expect(saveStatuses.at(-1)).toEqual({ state: "saved", blockId: submittedBlockId });
    expect(
      presentationSaveStateForBlock({ state: "saved", blockId: submittedBlockId }, nextBlockId),
    ).toBe("idle");
    controller.stop();
  });

  it("synchronizes after reconnect and replays one pending submission with the same key", async () => {
    const socket = new FakeSocket();
    const saveStates: string[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onSaveState: (state) => saveStates.push(state),
      socketFactory: () => socket as unknown as Socket,
      acknowledgementTimeoutMs: 50,
    });
    controller.start();
    sync(socket, participantSnapshot());

    const idempotencyKey = randomUUID();
    const submission = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId: participantSnapshot().currentBlock!.id,
        expectedRevision: 3,
        idempotencyKey,
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST should not be used");
      },
    );
    socket.disconnect();
    socket.connect();
    sync(socket, participantSnapshot({ seq: 6 }));

    const attempts = socket.emitted.filter(
      (entry) => entry.event === "presentation.response.submit",
    );
    expect(attempts).toHaveLength(2);
    expect(
      attempts.map(({ payload }) => (payload as { idempotencyKey: string }).idempotencyKey),
    ).toEqual([idempotencyKey, idempotencyKey]);

    const ack: PresentationResponseAck = {
      sessionId: participantSnapshot().sessionId,
      blockId: participantSnapshot().currentBlock!.id,
      idempotencyKey,
      accepted: true,
      duplicate: true,
      responseId: randomUUID(),
      acceptedAt: NOW,
      snapshot: participantSnapshot({ seq: 7, responseSubmitted: true }),
    };
    attempts[1]!.ack?.({ data: ack });
    await expect(submission).resolves.toEqual(ack);
    expect(saveStates.at(-1)).toBe("saved");
    controller.stop();
  });

  it.each([
    ["session", { sessionId: randomUUID() }],
    ["block", { blockId: randomUUID() }],
    ["idempotency key", { idempotencyKey: randomUUID() }],
  ])("rejects an acknowledgement with a mismatched %s", async (_field, mismatch) => {
    const socket = new FakeSocket();
    const saveStatuses: Array<{ state: string; blockId: string }> = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: () => undefined,
      onConnectionState: () => undefined,
      onSaveState: (state, blockId) => saveStatuses.push({ state, blockId }),
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, participantSnapshot());

    const blockId = participantSnapshot().currentBlock!.id;
    const idempotencyKey = randomUUID();
    const submission = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId,
        expectedRevision: 3,
        idempotencyKey,
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST should not be used");
      },
    );
    socket.last("presentation.response.submit")!.ack?.({
      data: {
        sessionId: participantSnapshot().sessionId,
        blockId,
        idempotencyKey,
        accepted: true,
        duplicate: false,
        responseId: randomUUID(),
        acceptedAt: NOW,
        snapshot: participantSnapshot({ seq: 6, responseSubmitted: true }),
        ...mismatch,
      } satisfies PresentationResponseAck,
    });

    await expect(submission).rejects.toThrow("mismatched response acknowledgement");
    expect(saveStatuses.at(-1)).toEqual({ state: "idle", blockId });
    controller.stop();
  });

  it("ignores a duplicate acknowledgement after the pending response has settled", async () => {
    const socket = new FakeSocket();
    const snapshots: number[] = [];
    const controller = createPresentationRealtimeController({
      sessionId: participantSnapshot().sessionId,
      credential: { projection: "participant", participantToken: "p".repeat(32) },
      fetchSnapshot: async () => participantSnapshot(),
      onSnapshot: (snapshot) => snapshots.push(snapshot.seq),
      onConnectionState: () => undefined,
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, participantSnapshot());
    const idempotencyKey = randomUUID();
    const result = controller.submitResponse(
      {
        sessionId: participantSnapshot().sessionId,
        participantToken: "p".repeat(32),
        blockId: participantSnapshot().currentBlock!.id,
        expectedRevision: 3,
        idempotencyKey,
        response: { choiceIds: ["6846c45c-7c3c-4348-86a5-c6e4e5bff962"] },
      },
      async () => {
        throw new Error("REST should not be used");
      },
    );
    const attempt = socket.last("presentation.response.submit")!;
    const ack: PresentationResponseAck = {
      sessionId: participantSnapshot().sessionId,
      blockId: participantSnapshot().currentBlock!.id,
      idempotencyKey,
      accepted: true,
      duplicate: false,
      responseId: randomUUID(),
      acceptedAt: NOW,
      snapshot: participantSnapshot({ seq: 6, responseSubmitted: true }),
    };
    attempt.ack?.({ data: ack });
    attempt.ack?.({ data: { ...ack, snapshot: participantSnapshot({ seq: 7 }) } });

    await expect(result).resolves.toEqual(ack);
    expect(snapshots).toEqual([5, 6]);
    controller.stop();
  });
});

describe("Presentation realtime disconnect recovery", () => {
  it("switches a terminal server disconnect to REST fallback", async () => {
    const socket = new FakeSocket();
    const connectionStates: string[] = [];
    let fetches = 0;
    const controller = createPresentationRealtimeController({
      sessionId: hostSnapshot().sessionId,
      credential: { projection: "host", controlToken: "h".repeat(32) },
      fetchSnapshot: async () => {
        fetches += 1;
        return hostSnapshot();
      },
      onSnapshot: () => undefined,
      onConnectionState: (state) => connectionStates.push(state),
      socketFactory: () => socket as unknown as Socket,
    });
    controller.start();
    sync(socket, hostSnapshot());
    await Promise.resolve();
    const fetchesBeforeDisconnect = fetches;

    socket.connected = false;
    socket.fire("disconnect", "io server disconnect");
    await Promise.resolve();

    expect(connectionStates.at(-1)).toBe("fallback");
    expect(controller.needsFallbackPolling()).toBe(true);
    expect(controller.canMutate()).toBe(true);
    expect(fetches).toBeGreaterThan(fetchesBeforeDisconnect);
    controller.stop();
  });
});
