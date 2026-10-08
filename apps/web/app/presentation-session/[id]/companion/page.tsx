"use client";

import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  PresentationCompanionSnapshotSchema,
  type PresentationCompanionCommand,
  type PresentationCompanionSnapshot,
} from "@openround/contracts";
import { useLocale } from "../../../../components/locale-provider";
import { CompanionOverlay } from "../../../../components/presentation-live/companion-overlay";
import styles from "../../../../components/presentation-live/companion.module.css";
import { apiFetch, humanError } from "../../../../lib/api";
import {
  capturePresentationCompanionPass,
  rejectPresentationCompanionPass,
} from "../../../../lib/presentation-companion-pass";
import {
  createPresentationCommandRecovery,
  type PresentationCommandRecoveryState,
} from "../../../../lib/presentation-command-recovery";
import {
  createPresentationRealtimeController,
  type PresentationConnectionState,
  type PresentationRealtimeController,
} from "../../../../lib/presentation-realtime";
import { formatNumber } from "../../../../lib/i18n/format";
import { clientUuid } from "../../../../lib/uuid";

function companionAdvanceMessageKey(snapshot: PresentationCompanionSnapshot) {
  if (snapshot.phase === "lobby") return "live.presentationSession.advance.start" as const;
  if (snapshot.phase === "question_open") return "live.presentationSession.advance.reveal" as const;
  if (snapshot.phase === "question_reveal") return "live.companion.continue" as const;
  if (snapshot.phase === "intervention")
    return "live.presentationSession.advance.continueRecheck" as const;
  if (snapshot.currentBlockIndex >= snapshot.blockCount - 1)
    return "live.presentationSession.advance.finish" as const;
  return "live.presentationSession.advance.next" as const;
}

/** Shareable aggregate results are available only for the current, closed question. */
function companionResults(snapshot: PresentationCompanionSnapshot | null) {
  if (
    !snapshot?.resultSummary ||
    snapshot.acceptingResponses ||
    !["question_reveal", "intervention", "finished"].includes(snapshot.phase) ||
    snapshot.currentBlock?.kind !== "question" ||
    snapshot.currentBlock.id !== snapshot.resultSummary.blockId
  )
    return null;
  return snapshot.resultSummary;
}

type CompanionRecovery = ReturnType<
  typeof createPresentationCommandRecovery<
    PresentationCompanionSnapshot,
    PresentationCompanionCommand
  >
>;

export default function PresentationCompanionPage() {
  const { id } = useParams<{ id: string }>();
  const { locale, t } = useLocale();
  const [pass, setPass] = useState<string | null>(null);
  const [captured, setCaptured] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [snapshot, setSnapshot] = useState<PresentationCompanionSnapshot | null>(null);
  const [connection, setConnection] = useState<PresentationConnectionState>("connecting");
  const [commandState, setCommandState] = useState<
    PresentationCommandRecoveryState<PresentationCompanionCommand>
  >({ busy: false, pendingCommand: null });
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [overlay, setOverlay] = useState<"join" | "results" | null>(null);
  const controllerRef =
    useRef<PresentationRealtimeController<PresentationCompanionSnapshot> | null>(null);
  const commandsRef = useRef<CompanionRecovery | null>(null);

  useLayoutEffect(() => {
    try {
      setPass(
        capturePresentationCompanionPass({
          sessionId: id,
          location: window.location,
          history: window.history,
          storage: sessionStorage,
        }),
      );
    } catch {
      setError(t("live.companion.missingPass"));
    }
    setCaptured(true);
  }, [id, t]);

  const applySnapshot = useCallback(
    (incoming: PresentationCompanionSnapshot) => setSnapshot(incoming),
    [],
  );

  useEffect(() => {
    if (!pass) return;
    let disposed = false;
    const rejectPass = (rejectedToken: string) => {
      if (disposed || rejectedToken !== pass) return;
      rejectPresentationCompanionPass(sessionStorage, id, rejectedToken);
      setRejected(true);
      setPass(null);
      setSnapshot(null);
      setOverlay(null);
      setError("");
    };
    const controller = createPresentationRealtimeController<PresentationCompanionSnapshot>({
      sessionId: id,
      credential: { projection: "companion", companionToken: pass },
      fetchSnapshot: async () => {
        const response = await apiFetch<{ snapshot: unknown }>(
          `/v1/presentation-sessions/${id}/companion`,
          { credentials: "omit", headers: { authorization: `Bearer ${pass}` } },
        );
        const incoming = PresentationCompanionSnapshotSchema.parse(response.snapshot);
        if (!disposed) setError("");
        return incoming;
      },
      onSnapshot: (incoming) => {
        if (!disposed) applySnapshot(incoming);
      },
      onConnectionState: (next) => {
        if (!disposed) setConnection(next);
      },
      onRoomStatus: (roomStatus) => {
        if (!disposed) setSnapshot((current) => (current ? { ...current, roomStatus } : current));
      },
      onCredentialRejected: rejectPass,
      onError: (caught) => {
        if (!disposed) setError(humanError(caught));
      },
    });
    controllerRef.current = controller;
    const commands = createPresentationCommandRecovery<
      PresentationCompanionSnapshot,
      PresentationCompanionCommand
    >({
      execute: (command) =>
        controller.command(command, async () => {
          const response = await apiFetch<{ snapshot: unknown }>(
            `/v1/presentation-sessions/${id}/companion-command`,
            { method: "POST", credentials: "omit", body: JSON.stringify(command) },
          );
          return PresentationCompanionSnapshotSchema.parse(response.snapshot);
        }),
      onState: (next) => {
        if (!disposed) setCommandState(next);
      },
    });
    commandsRef.current = commands;
    controller.start();
    const fallbackTimer = window.setInterval(() => {
      if (controller.needsFallbackPolling()) void controller.reconcile();
    }, 1_500);
    // Periodic authorization checks also discover expiration/revocation while a quiet room is connected.
    const authorizationTimer = window.setInterval(() => void controller.reconcile(), 15_000);
    return () => {
      disposed = true;
      window.clearInterval(fallbackTimer);
      window.clearInterval(authorizationTimer);
      controller.stop();
      if (controllerRef.current === controller) controllerRef.current = null;
      if (commandsRef.current === commands) commandsRef.current = null;
    };
  }, [applySnapshot, id, pass]);

  const results = companionResults(snapshot);
  useEffect(() => {
    if (!results && overlay === "results") setOverlay(null);
  }, [overlay, results]);

  async function advanceOrRetry() {
    const controller = controllerRef.current;
    const commands = commandsRef.current;
    if (!pass || !snapshot || !controller?.canMutate() || !commands || commands.state().busy)
      return;
    if (!commands.state().pendingCommand && snapshot.primaryAction !== "advance") return;
    setError("");
    setConfirmed(false);
    try {
      const response = commands.state().pendingCommand
        ? await commands.retry()
        : await commands.run({
            sessionId: id,
            companionToken: pass,
            commandId: clientUuid(),
            expectedRevision: snapshot.revision,
            action: "advance",
          });
      if (response) setConfirmed(true);
    } catch (caught) {
      setError(humanError(caught));
      await controller.reconcile();
    }
  }

  const joinUrl = snapshot
    ? `${typeof window === "undefined" ? "" : window.location.origin}/join?code=${encodeURIComponent(snapshot.code)}`
    : "";
  const block = snapshot?.currentBlock;
  return (
    <main className={styles.page}>
      <section className={styles.sidecar} aria-label={t("live.companion.title")}>
        <header>
          <h1>{t("live.companion.title")}</h1>
          <p className="muted" role="status" aria-live="polite">
            {t(
              !pass && captured
                ? "live.companion.disconnected"
                : connection === "fallback" && !snapshot
                  ? "live.companion.reconciling"
                  : `live.companion.${connection}`,
            )}
          </p>
        </header>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {!pass && captured ? (
          <p role="status">
            {t(rejected ? "live.companion.passRejected" : "live.companion.missingPass")}
          </p>
        ) : null}
        {pass && !snapshot ? <p role="status">{t("live.companion.loading")}</p> : null}
        {snapshot ? (
          <>
            <div className={styles.current}>
              <span className={styles.phase}>{t(`live.companion.phase.${snapshot.phase}`)}</span>
              <h2 lang="">
                {block?.kind === "question"
                  ? block.question.prompt
                  : block?.kind === "content"
                    ? (block.textElements.find((element) => element.role === "title")?.text ??
                      snapshot.title)
                    : snapshot.title}
              </h2>
              <p className="muted">
                {t("live.presentationSession.blockProgress", {
                  current: formatNumber(locale, Math.max(0, snapshot.currentBlockIndex + 1)),
                  total: formatNumber(locale, snapshot.blockCount),
                })}
              </p>
            </div>
            <dl className={styles.metrics}>
              {(
                [
                  ["joined", snapshot.roomStatus.joinedCount],
                  ["answered", snapshot.roomStatus.responseCount],
                  ["connectedCount", snapshot.roomStatus.connectedCount],
                  ["disconnected", snapshot.roomStatus.notCurrentlyConnectedCount],
                ] as const
              ).map(([label, count]) => (
                <div key={label}>
                  <dt>{t(`live.companion.${label}`)}</dt>
                  <dd>{formatNumber(locale, count)}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.acknowledgement} role="status" aria-live="polite">
              {t(
                commandState.busy
                  ? "live.companion.waitingAck"
                  : commandState.pendingCommand
                    ? "live.companion.unconfirmed"
                    : confirmed
                      ? "live.companion.confirmed"
                      : "live.companion.ready",
              )}
            </p>
            <button
              className="button full-width"
              disabled={
                !pass ||
                commandState.busy ||
                !controllerRef.current?.canMutate() ||
                (!commandState.pendingCommand && snapshot.primaryAction !== "advance")
              }
              onClick={() => void advanceOrRetry()}
              type="button"
            >
              {t(
                commandState.busy
                  ? "live.common.updating"
                  : commandState.pendingCommand
                    ? "live.companion.retryAck"
                    : snapshot.primaryAction === "none"
                      ? "live.companion.noAction"
                      : companionAdvanceMessageKey(snapshot),
              )}
            </button>
            <div className={styles.secondary}>
              <button className="button-quiet" onClick={() => setOverlay("join")} type="button">
                {t("live.companion.showJoin")}
              </button>
              {results ? (
                <button
                  className="button-quiet"
                  onClick={() => setOverlay("results")}
                  type="button"
                >
                  {t("live.companion.showResults")}
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </section>
      {overlay === "join" && snapshot ? (
        <CompanionOverlay title={t("live.companion.joinTitle")} onClose={() => setOverlay(null)}>
          <p>{t("live.presentationSession.joinCode")}</p>
          <p className={styles.joinCode}>{snapshot.code}</p>
          <QRCodeSVG value={joinUrl} size={200} title={t("live.companion.joinQr")} />
          <a className={styles.joinLink} href={joinUrl} target="_blank" rel="noopener noreferrer">
            {joinUrl}
          </a>
        </CompanionOverlay>
      ) : null}
      {overlay === "results" && results && block?.kind === "question" ? (
        <CompanionOverlay title={t("live.companion.resultTitle")} onClose={() => setOverlay(null)}>
          <p lang="">{block.question.prompt}</p>
          <p>
            {t("live.companion.answered")}: {formatNumber(locale, results.responseCount)}
          </p>
          {results.choiceCounts.length ? (
            <dl className={styles.results}>
              {results.choiceCounts.map(({ choiceId, count }) => {
                const choice = block.question.choices.find(
                  (candidate) => candidate.id === choiceId,
                );
                return choice ? (
                  <div key={choiceId}>
                    <dt lang="">{choice.label}</dt>
                    <dd>{formatNumber(locale, count)}</dd>
                  </div>
                ) : null;
              })}
            </dl>
          ) : null}
        </CompanionOverlay>
      ) : null}
    </main>
  );
}
