import type {
  PresentationCommand,
  PresentationEventEnvelope,
  PresentationHostSnapshot,
  PresentationParticipantSnapshot,
  PresentationResponseAck,
  PresentationResponseSubmit,
  PresentationRoleSnapshot,
  PresentationRoomStatus,
  PresentationSyncRequest,
  PresentationSyncResponse,
} from "@openround/contracts";
import type { Socket } from "socket.io-client";
import { createRealtimeClient } from "./realtime";

export type PresentationRealtimeSnapshot =
  PresentationHostSnapshot | PresentationParticipantSnapshot;

export type PresentationConnectionState = "connecting" | "connected" | "reconciling" | "fallback";

export type PresentationSaveState = "idle" | "saving" | "saved" | "reconnecting_not_saved";

export interface PresentationSaveStatus {
  blockId: string | null;
  state: PresentationSaveState;
}

export function presentationSaveStateForBlock(
  status: PresentationSaveStatus,
  blockId: string | null,
): PresentationSaveState {
  return status.blockId === blockId ? status.state : "idle";
}

type RealtimeAck<T> = { data?: T; error?: { code: string; message: string } };

export interface PresentationSnapshotFence {
  seq: number;
  revision: number;
  serverTime: string;
}

/** Sequence and revision fence durable state; server time breaks exact ties for derived fields. */
export function shouldApplyPresentationSnapshot(
  current: PresentationSnapshotFence | null,
  incoming: PresentationSnapshotFence,
) {
  if (!current) return true;
  if (incoming.seq !== current.seq) return incoming.seq > current.seq;
  if (incoming.revision !== current.revision) return incoming.revision > current.revision;
  const currentServerTime = Date.parse(current.serverTime);
  const incomingServerTime = Date.parse(incoming.serverTime);
  return (
    Number.isFinite(currentServerTime) &&
    Number.isFinite(incomingServerTime) &&
    incomingServerTime > currentServerTime
  );
}

export function presentationSnapshotFromEnvelope(
  envelope: PresentationEventEnvelope,
): PresentationRoleSnapshot | null {
  const payload = envelope.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if ("projection" in payload) return payload as PresentationRoleSnapshot;
  if ("snapshot" in payload) {
    const snapshot = (payload as { snapshot?: unknown }).snapshot;
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
      return snapshot as PresentationRoleSnapshot;
    }
  }
  return null;
}

type Credential =
  | { projection: "host"; controlToken: string }
  | { projection: "participant"; participantToken: string };

type PendingSubmission = {
  payload: PresentationResponseSubmit;
  replayed: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
  resolve: (ack: PresentationResponseAck) => void;
  reject: (error: Error) => void;
};

export interface PresentationRealtimeControllerOptions<
  Snapshot extends PresentationRealtimeSnapshot,
> {
  sessionId: string;
  credential: Credential | null;
  fetchSnapshot: () => Promise<Snapshot>;
  onSnapshot: (snapshot: Snapshot) => void;
  onConnectionState: (state: PresentationConnectionState) => void;
  onSaveState?: (state: PresentationSaveState, blockId: string) => void;
  onRoomStatus?: (status: PresentationRoomStatus) => void;
  onError?: (error: Error) => void;
  socketFactory?: () => Socket;
  acknowledgementTimeoutMs?: number;
}

export interface PresentationRealtimeController<Snapshot extends PresentationRealtimeSnapshot> {
  start(): void;
  stop(): void;
  reconcile(): Promise<Snapshot | null>;
  applySnapshot(snapshot: Snapshot): boolean;
  command(command: PresentationCommand, restFallback: () => Promise<Snapshot>): Promise<Snapshot>;
  submitResponse(
    submission: PresentationResponseSubmit,
    restFallback: () => Promise<PresentationResponseAck>,
  ): Promise<PresentationResponseAck>;
  canMutate(): boolean;
  needsFallbackPolling(): boolean;
  latest(): Snapshot | null;
}

function errorFromAck(error: { code: string; message: string }) {
  const result = new Error(error.message) as Error & { code?: string };
  result.code = error.code;
  return result;
}

export function createPresentationRealtimeController<Snapshot extends PresentationRealtimeSnapshot>(
  options: PresentationRealtimeControllerOptions<Snapshot>,
): PresentationRealtimeController<Snapshot> {
  const socket = options.credential ? (options.socketFactory ?? createRealtimeClient)() : null;
  const ackTimeoutMs = options.acknowledgementTimeoutMs ?? 8_000;
  let snapshot: Snapshot | null = null;
  let fence: PresentationSnapshotFence | null = null;
  let roomStatusSampledAt: number | null = null;
  let latestRoomStatus: PresentationRoomStatus | null = null;
  let started = false;
  let reconciled = false;
  let connectionState: PresentationConnectionState = options.credential ? "connecting" : "fallback";
  let pendingSubmission: PendingSubmission | null = null;
  let reconciliation: Promise<Snapshot | null> | null = null;

  const setConnectionState = (next: PresentationConnectionState) => {
    if (connectionState === next) return;
    connectionState = next;
    options.onConnectionState(next);
  };

  const applySnapshot = (incoming: Snapshot) => {
    if (
      incoming.sessionId !== options.sessionId ||
      (options.credential && incoming.projection !== options.credential.projection)
    ) {
      return false;
    }
    const incomingFence = {
      seq: incoming.seq,
      revision: incoming.revision,
      serverTime: incoming.serverTime,
    };
    if (!shouldApplyPresentationSnapshot(fence, incomingFence)) return false;
    let projectedIncoming = incoming;
    if (incoming.projection === "host") {
      const incomingRoomStatusSampledAt = Date.parse(incoming.roomStatus.sampledAt);
      if (
        latestRoomStatus &&
        roomStatusSampledAt !== null &&
        (!Number.isFinite(incomingRoomStatusSampledAt) ||
          roomStatusSampledAt > incomingRoomStatusSampledAt)
      ) {
        projectedIncoming = { ...incoming, roomStatus: latestRoomStatus } as Snapshot;
      } else if (Number.isFinite(incomingRoomStatusSampledAt)) {
        roomStatusSampledAt = incomingRoomStatusSampledAt;
        latestRoomStatus = incoming.roomStatus;
      }
    }
    fence = incomingFence;
    snapshot = projectedIncoming;
    options.onSnapshot(projectedIncoming);
    return true;
  };

  const settleSubmission = (ack: PresentationResponseAck) => {
    const pending = pendingSubmission;
    if (!pending) return false;
    const receipt = ack.snapshot.responseReceipt;
    const coherent =
      ack.accepted &&
      ack.sessionId === pending.payload.sessionId &&
      ack.snapshot.sessionId === pending.payload.sessionId &&
      ack.blockId === pending.payload.blockId &&
      ack.idempotencyKey === pending.payload.idempotencyKey &&
      (!receipt ||
        (receipt.responseId === ack.responseId &&
          receipt.blockId === ack.blockId &&
          receipt.idempotencyKey === ack.idempotencyKey &&
          receipt.acceptedAt === ack.acceptedAt));
    if (!coherent) {
      failSubmission(new Error("The server returned a mismatched response acknowledgement."));
      return false;
    }
    if (pending.timeout) clearTimeout(pending.timeout);
    pendingSubmission = null;
    applySnapshot(ack.snapshot as Snapshot);
    options.onSaveState?.("saved", pending.payload.blockId);
    pending.resolve(ack);
    return true;
  };

  const failSubmission = (error: Error) => {
    const pending = pendingSubmission;
    if (!pending) return;
    if (pending.timeout) clearTimeout(pending.timeout);
    pendingSubmission = null;
    options.onSaveState?.("idle", pending.payload.blockId);
    pending.reject(error);
    options.onError?.(error);
  };

  const reconcileSubmission = (authoritative: Snapshot) => {
    const pending = pendingSubmission;
    if (!pending) return;
    const sameBlock = authoritative.currentBlock?.id === pending.payload.blockId;
    if (
      authoritative.projection === "participant" &&
      authoritative.responseReceipt?.idempotencyKey === pending.payload.idempotencyKey &&
      authoritative.responseReceipt.blockId === pending.payload.blockId
    ) {
      settleSubmission({
        sessionId: pending.payload.sessionId,
        blockId: pending.payload.blockId,
        idempotencyKey: pending.payload.idempotencyKey,
        accepted: true,
        duplicate: true,
        responseId: authoritative.responseReceipt.responseId,
        acceptedAt: authoritative.responseReceipt.acceptedAt,
        snapshot: authoritative,
      });
      return;
    }
    if (
      authoritative.projection === "participant" &&
      sameBlock &&
      authoritative.responseSubmitted
    ) {
      failSubmission(new Error("A different response is already saved for this question."));
      return;
    }
    if (
      sameBlock &&
      authoritative.phase === "question_open" &&
      authoritative.acceptingResponses &&
      !pending.replayed &&
      socket?.connected
    ) {
      pending.replayed = true;
      emitSubmission(pending);
      return;
    }
    if (!sameBlock || authoritative.phase !== "question_open") {
      failSubmission(new Error("The question closed before the response was confirmed."));
    }
  };

  const emitSubmission = (pending: PendingSubmission) => {
    if (!socket?.connected) return;
    if (pending.timeout) clearTimeout(pending.timeout);
    options.onSaveState?.("saving", pending.payload.blockId);
    pending.timeout = setTimeout(() => {
      if (pendingSubmission !== pending) return;
      options.onSaveState?.("reconnecting_not_saved", pending.payload.blockId);
      setConnectionState("reconciling");
      const hadAlreadyReplayed = pending.replayed;
      void reconcile().then((authoritative) => {
        if (pendingSubmission !== pending) return;
        if (!authoritative || hadAlreadyReplayed || !socket?.connected) {
          failSubmission(new Error("The server did not confirm that response."));
        }
      });
    }, ackTimeoutMs);
    socket.emit(
      "presentation.response.submit",
      pending.payload,
      (response: RealtimeAck<PresentationResponseAck>) => {
        if (response.error) {
          failSubmission(errorFromAck(response.error));
        } else if (response.data) {
          settleSubmission(response.data);
        }
      },
    );
  };

  const performReconcile = async (): Promise<Snapshot | null> => {
    if (socket?.connected && options.credential) {
      setConnectionState("reconciling");
      const request: PresentationSyncRequest = {
        sessionId: options.sessionId,
        afterSeq: fence?.seq ?? 0,
        ...options.credential,
      };
      return new Promise<Snapshot | null>((resolve) => {
        let settled = false;
        const useFallback = async (realtimeError?: Error) => {
          if (settled) return;
          settled = true;
          setConnectionState("fallback");
          try {
            const incoming = await options.fetchSnapshot();
            applySnapshot(incoming);
            reconcileSubmission(incoming);
            reconciliation = null;
            resolve(incoming);
          } catch (caught) {
            options.onError?.(
              caught instanceof Error
                ? caught
                : (realtimeError ?? new Error("Unable to restore Presentation")),
            );
            reconciliation = null;
            resolve(null);
          }
        };
        const timeout = setTimeout(() => void useFallback(), Math.min(ackTimeoutMs, 3_000));
        socket.emit(
          "presentation.sync.request",
          request,
          (response: RealtimeAck<PresentationSyncResponse>) => {
            if (settled) return;
            clearTimeout(timeout);
            if (response.error) {
              void useFallback(errorFromAck(response.error));
              return;
            }
            const incoming = response.data?.snapshot;
            if (incoming && incoming.projection === options.credential?.projection) {
              settled = true;
              applySnapshot(incoming as Snapshot);
              reconcileSubmission(incoming as Snapshot);
              reconciled = true;
              setConnectionState("connected");
              reconciliation = null;
              resolve(incoming as Snapshot);
            } else {
              void useFallback(new Error("Presentation sync returned an invalid snapshot"));
            }
          },
        );
      });
    }
    try {
      const incoming = await options.fetchSnapshot();
      applySnapshot(incoming);
      reconcileSubmission(incoming);
      if (!options.credential) setConnectionState("fallback");
      return incoming;
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error("Unable to restore Presentation");
      options.onError?.(error);
      return null;
    }
  };

  const reconcile = () => {
    if (reconciliation) return reconciliation;
    const current = performReconcile();
    reconciliation = current;
    void current.then(
      () => {
        if (reconciliation === current) reconciliation = null;
      },
      () => {
        if (reconciliation === current) reconciliation = null;
      },
    );
    return current;
  };

  const onEnvelope = (envelope: PresentationEventEnvelope, acknowledge?: () => void) => {
    acknowledge?.();
    const incoming = presentationSnapshotFromEnvelope(envelope);
    if (incoming?.projection === options.credential?.projection) {
      if (applySnapshot(incoming as Snapshot)) reconcileSubmission(incoming as Snapshot);
    }
  };

  const onRoomStatus = (
    envelope: PresentationEventEnvelope<
      PresentationRoomStatus | { roomStatus: PresentationRoomStatus }
    >,
    acknowledge?: () => void,
  ) => {
    acknowledge?.();
    const payload = envelope.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const status = "roomStatus" in payload ? payload.roomStatus : payload;
    if (!status || status.sessionId !== options.sessionId) return;
    const sampledAt = Date.parse(status.sampledAt);
    if (
      !Number.isFinite(sampledAt) ||
      (roomStatusSampledAt !== null && sampledAt <= roomStatusSampledAt)
    )
      return;
    roomStatusSampledAt = sampledAt;
    latestRoomStatus = status;
    if (snapshot?.projection === "host") {
      snapshot = { ...snapshot, roomStatus: status } as Snapshot;
    }
    options.onRoomStatus?.(status);
  };

  return {
    start() {
      if (started) return;
      started = true;
      options.onConnectionState(connectionState);
      if (!socket) {
        void reconcile();
        return;
      }
      // Preserve the established REST path for the first paint while the socket negotiates.
      void options
        .fetchSnapshot()
        .then(applySnapshot)
        .catch(() => undefined);
      socket.on("connect", () => void reconcile());
      socket.on("disconnect", (reason) => {
        reconciled = false;
        const terminal = reason === "io server disconnect";
        setConnectionState(terminal ? "fallback" : "reconciling");
        if (pendingSubmission)
          options.onSaveState?.("reconnecting_not_saved", pendingSubmission.payload.blockId);
        if (terminal) void reconcile();
      });
      socket.on("connect_error", () => setConnectionState("fallback"));
      socket.on("presentation.session.updated", onEnvelope);
      socket.on("presentation.room-status.updated", onRoomStatus);
      socket.connect();
    },
    stop() {
      started = false;
      reconciled = false;
      if (pendingSubmission?.timeout) clearTimeout(pendingSubmission.timeout);
      if (pendingSubmission) {
        pendingSubmission.reject(new Error("Presentation connection closed"));
        pendingSubmission = null;
      }
      socket?.removeAllListeners();
      socket?.disconnect();
    },
    reconcile,
    applySnapshot,
    command(command, restFallback) {
      if (!socket || connectionState === "fallback") {
        return restFallback().then((incoming) => {
          applySnapshot(incoming);
          return incoming;
        });
      }
      if (!socket.connected || !reconciled) {
        return Promise.reject(new Error("Reconnect before changing the Presentation."));
      }
      return new Promise<Snapshot>((resolve, reject) => {
        const timeout = setTimeout(() => {
          setConnectionState("reconciling");
          void reconcile();
          reject(new Error("The server did not confirm that action. Review the room state."));
        }, ackTimeoutMs);
        socket.emit(
          "presentation.command",
          command,
          (response: RealtimeAck<{ snapshot: PresentationHostSnapshot }>) => {
            clearTimeout(timeout);
            if (response.error) {
              reject(errorFromAck(response.error));
              return;
            }
            const incoming = response.data?.snapshot;
            if (!incoming) {
              reject(new Error("The server did not confirm that action."));
              return;
            }
            applySnapshot(incoming as Snapshot);
            resolve(incoming as Snapshot);
          },
        );
      });
    },
    submitResponse(submission, restFallback) {
      if (pendingSubmission) {
        return Promise.reject(new Error("A response is already being saved."));
      }
      if (!socket || connectionState === "fallback") {
        options.onSaveState?.("saving", submission.blockId);
        return restFallback()
          .then((ack) => {
            const receipt = ack.snapshot.responseReceipt;
            if (
              !ack.accepted ||
              ack.sessionId !== submission.sessionId ||
              ack.snapshot.sessionId !== submission.sessionId ||
              ack.blockId !== submission.blockId ||
              ack.idempotencyKey !== submission.idempotencyKey ||
              (receipt &&
                (receipt.responseId !== ack.responseId ||
                  receipt.blockId !== ack.blockId ||
                  receipt.idempotencyKey !== ack.idempotencyKey ||
                  receipt.acceptedAt !== ack.acceptedAt))
            ) {
              throw new Error("The server returned a mismatched response acknowledgement.");
            }
            applySnapshot(ack.snapshot as Snapshot);
            options.onSaveState?.("saved", submission.blockId);
            return ack;
          })
          .catch(async (caught) => {
            options.onSaveState?.("reconnecting_not_saved", submission.blockId);
            const authoritative = await reconcile();
            if (
              authoritative?.projection === "participant" &&
              authoritative.responseReceipt?.blockId === submission.blockId &&
              authoritative.responseReceipt.idempotencyKey === submission.idempotencyKey
            ) {
              const recovered: PresentationResponseAck = {
                sessionId: submission.sessionId,
                blockId: submission.blockId,
                idempotencyKey: submission.idempotencyKey,
                accepted: true,
                duplicate: true,
                responseId: authoritative.responseReceipt.responseId,
                acceptedAt: authoritative.responseReceipt.acceptedAt,
                snapshot: authoritative,
              };
              options.onSaveState?.("saved", submission.blockId);
              return recovered;
            }
            options.onSaveState?.("idle", submission.blockId);
            throw caught;
          });
      }
      if (!socket.connected || !reconciled) {
        options.onSaveState?.("reconnecting_not_saved", submission.blockId);
        return Promise.reject(new Error("Reconnect before saving this response."));
      }
      return new Promise<PresentationResponseAck>((resolve, reject) => {
        const pending: PendingSubmission = {
          payload: submission,
          replayed: false,
          timeout: null,
          resolve,
          reject,
        };
        pendingSubmission = pending;
        emitSubmission(pending);
      });
    },
    canMutate() {
      return connectionState === "fallback" || (Boolean(socket?.connected) && reconciled);
    },
    needsFallbackPolling() {
      return !socket || connectionState === "fallback";
    },
    latest() {
      return snapshot;
    },
  };
}
