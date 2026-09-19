"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EventEnvelope,
  HostAction,
  InterventionType,
  SessionStaffCredential,
  SessionSnapshot,
} from "@openround/contracts";
import { Brand } from "../../../components/brand";
import {
  AudiencePanel,
  enqueueAudienceRealtimeUpdate,
  type AudienceRealtimeBatch,
} from "../../../components/audience-panel";
import { ExperiencePreferences } from "../../../components/experience-preferences";
import { Countdown } from "../../../components/countdown";
import {
  HostCommandBar,
  HostStage,
  RecoveryCompass,
} from "../../../components/host-command-center";
import { JoinAccess } from "../../../components/join-access";
import { QuestionMedia } from "../../../components/question-media";
import { ResponseDistributionView } from "../../../components/response-distribution";
import { QnaPanel } from "../../../components/qna-panel";
import { apiFetch, humanError } from "../../../lib/api";
import {
  createHostCredentialRecovery,
  hostCredentialStorageKey,
} from "../../../lib/host-credential-recovery";
import {
  audienceContextKey,
  createAudienceRealtimeReceipt,
  createRealtimeClient,
  withRealtimeReceipt,
} from "../../../lib/realtime";
import {
  createAckRecoveryController,
  HOST_ACK_CHECKING_MESSAGE,
  HOST_ACK_TIMEOUT_MESSAGE,
} from "../../../lib/realtime-mutation-recovery";
import { experienceThemeStyle } from "../../../lib/theme";
import { clientUuid } from "../../../lib/uuid";
import { getHostPhaseView, type HostPhaseCommand } from "../../../lib/host-phase";
import { getLegacyPhaseActions, getLegacyRecoveryActions } from "../../../lib/legacy-host-phase";

type Ack<T> = { data?: T; error?: { code: string; message: string } };

const ACK_TIMEOUT_MS = 10_000;
const SYNC_GRACE_MS = 5_000;

function hostCredential(sessionId: string) {
  const storageKey = hostCredentialStorageKey(sessionId);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const cohostToken = fragment.get("cohost");
  if (cohostToken) {
    sessionStorage.setItem(storageKey, cohostToken);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return cohostToken;
  }
  return sessionStorage.getItem(storageKey);
}

export default function HostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const socket = useMemo(createRealtimeClient, []);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const [staffPending, setStaffPending] = useState(false);
  const [presenterPending, setPresenterPending] = useState(false);
  const [error, setError] = useState("");
  const [reportId, setReportId] = useState("");
  const [mediaCredential, setMediaCredential] = useState("");
  const [qnaRevision, setQnaRevision] = useState(0);
  const [audienceSyncRevision, setAudienceSyncRevision] = useState(0);
  const [audienceRealtimeBatch, setAudienceRealtimeBatch] = useState<AudienceRealtimeBatch | null>(
    null,
  );
  const audiencePanelKey = useMemo(
    () => (mediaCredential ? `${sessionId}:moderator:${clientUuid()}` : `${sessionId}:moderator`),
    [mediaCredential, sessionId],
  );
  const [staffCredentials, setStaffCredentials] = useState<SessionStaffCredential[]>([]);
  const [cohostLabel, setCohostLabel] = useState("");
  const [cohostLink, setCohostLink] = useState("");
  const [embedLink, setEmbedLink] = useState("");
  const [embedCopyStatus, setEmbedCopyStatus] = useState("");
  const [staffManagementAvailable, setStaffManagementAvailable] = useState(false);
  const [cohostingAvailable, setCohostingAvailable] = useState(false);
  const [audienceOpen, setAudienceOpen] = useState(false);
  const [audienceTab, setAudienceTab] = useState<"participants" | "pulse" | "qna" | "chat">(
    "participants",
  );
  const audienceButtonRef = useRef<HTMLButtonElement>(null);
  const audienceDrawerRef = useRef<HTMLDivElement>(null);
  const audienceCloseRef = useRef<HTMLButtonElement>(null);
  const syncHostRef = useRef<() => void>(() => undefined);
  const commandRecoveryRef = useRef<ReturnType<typeof createAckRecoveryController<null>> | null>(
    null,
  );
  const recoverHostCredentialRef = useRef<
    ((error: NonNullable<Ack<unknown>["error"]>, rejectedToken: string) => Promise<boolean>) | null
  >(null);

  if (!commandRecoveryRef.current) {
    commandRecoveryRef.current = createAckRecoveryController({
      acknowledgementTimeoutMs: ACK_TIMEOUT_MS,
      reconciliationTimeoutMs: SYNC_GRACE_MS,
      onPendingChange: setCommandPending,
      onReconciliationRequested: () => {
        setError(HOST_ACK_CHECKING_MESSAGE);
        syncHostRef.current();
      },
      onExpired: () => setError(HOST_ACK_TIMEOUT_MESSAGE),
    });
  }

  function clearPendingCommand(commandId?: string) {
    return Boolean(commandRecoveryRef.current?.settle(commandId));
  }

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    let disposed = false;
    let activeHostToken = "";
    let sync: () => void = () => undefined;
    const recovery = createHostCredentialRecovery(sessionStorage, sessionId);

    const missingCredentialMessage =
      "This tab does not have a host credential. Sign in as a workspace owner or editor, or open the original host link.";

    const requestControlPass = async () => {
      const { token } = await apiFetch<{ token: string }>(
        `/v1/sessions/${sessionId}/control-pass`,
        {
          method: "POST",
          body: "{}",
        },
      );
      if (disposed) return null;
      recovery.save(token);
      activeHostToken = token;
      setMediaCredential(token);
      return token;
    };

    const setControlPassError = (caught: unknown) => {
      if (disposed) return;
      setError(
        (caught as { status?: number }).status === 401
          ? missingCredentialMessage
          : humanError(caught),
      );
    };

    const recoverHostCredential = async (
      syncError: NonNullable<Ack<unknown>["error"]>,
      rejectedToken: string,
    ) => {
      if (disposed || rejectedToken !== activeHostToken) return false;
      if (!recovery.claim(syncError.code, rejectedToken)) {
        setError(syncError.message);
        return false;
      }
      try {
        const token = await requestControlPass();
        if (!token) return false;
        sync();
        return true;
      } catch (caught) {
        setControlPassError(caught);
        return false;
      }
    };
    recoverHostCredentialRef.current = recoverHostCredential;

    const connect = (hostToken: string) => {
      if (disposed) return;
      activeHostToken = hostToken;
      setMediaCredential(hostToken);
      sync = () => {
        const attemptedToken = activeHostToken;
        socket.emit(
          "sync.request",
          {
            sessionId,
            role: "host",
            hostToken: attemptedToken,
            lastSeq: snapshotRef.current?.seq ?? 0,
          },
          (response: Ack<{ snapshot: SessionSnapshot }>) => {
            if (disposed || attemptedToken !== activeHostToken) return;
            if (response.error) {
              void recoverHostCredential(response.error, attemptedToken);
              return;
            }
            if (response.data) {
              recovery.succeeded();
              if (!commandRecoveryRef.current?.current()) setError("");
              setSnapshot(response.data.snapshot);
            }
          },
        );
      };
      const update = withRealtimeReceipt(
        (envelope: EventEnvelope<{ snapshot: SessionSnapshot; reportId?: string }>) => {
          if (
            audienceContextKey(envelope.payload.snapshot) !==
            audienceContextKey(snapshotRef.current)
          ) {
            setAudienceSyncRevision((current) => current + 1);
          }
          setSnapshot(envelope.payload.snapshot);
          if (envelope.payload.reportId) setReportId(envelope.payload.reportId);
        },
      );
      const qnaUpdate = withRealtimeReceipt(() => setQnaRevision((current) => current + 1));
      const audienceUpdate = createAudienceRealtimeReceipt((gap, envelope) => {
        setAudienceRealtimeBatch((current) =>
          enqueueAudienceRealtimeUpdate(current, { gap, envelope }),
        );
        if (envelope.type.startsWith("qna.")) setQnaRevision((current) => current + 1);
      });
      socket.on("connect", () => {
        setConnected(true);
        if (!commandRecoveryRef.current?.current()) setError("");
        setAudienceSyncRevision((current) => current + 1);
        sync();
      });
      socket.on("disconnect", () => setConnected(false));
      for (const event of [
        "lobby.updated",
        "question.open",
        "question.locked",
        "question.reveal",
        "checkpoint.insight",
        "intervention.updated",
        "recheck.open",
        "leaderboard.updated",
        "game.finished",
        "session.snapshot",
      ])
        socket.on(event, update);
      for (const event of [
        "qna.question.created",
        "qna.question.updated",
        "qna.reply.created",
        "qna.reply.updated",
        "qna.vote.updated",
        "qna.settings.updated",
      ])
        socket.on(event, qnaUpdate);
      for (const event of [
        "audience.settings.updated",
        "audience.signal.updated",
        "audience.summary.updated",
        "chat.message.created",
        "chat.message.updated",
        "chat.message.removed",
        "chat.message.pinned",
        "chat.reaction.updated",
        "audience.moderation.updated",
        "audience.event",
      ])
        socket.on(event, audienceUpdate);
      syncHostRef.current = sync;
      socket.connect();
    };

    const existingToken = hostCredential(sessionId);
    if (existingToken) {
      connect(existingToken);
    } else {
      void requestControlPass()
        .then((token) => {
          if (token) connect(token);
        })
        .catch(setControlPassError);
    }

    return () => {
      disposed = true;
      commandRecoveryRef.current?.dispose();
      syncHostRef.current = () => undefined;
      if (recoverHostCredentialRef.current === recoverHostCredential) {
        recoverHostCredentialRef.current = null;
      }
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [sessionId, socket]);

  const loadStaff = useCallback(async () => {
    try {
      const response = await apiFetch<{ credentials: SessionStaffCredential[] }>(
        `/v1/sessions/${sessionId}/staff`,
      );
      setStaffCredentials(response.credentials);
      setStaffManagementAvailable(true);
    } catch {
      setStaffManagementAvailable(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    apiFetch<{ entitlements: { cohosting?: boolean } }>("/v1/auth/me")
      .then(({ entitlements }) => setCohostingAvailable(Boolean(entitlements.cohosting)))
      .catch(() => setCohostingAvailable(false));
  }, []);

  useEffect(() => {
    if (!audienceOpen) return;
    const focusCloseControl = () => audienceCloseRef.current?.focus();
    const focusFrame = window.requestAnimationFrame(focusCloseControl);
    const focusFallback = window.setTimeout(focusCloseControl, 200);
    const manageDrawerFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setAudienceOpen(false);
        window.requestAnimationFrame(() => audienceButtonRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(audienceDrawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (!audienceDrawerRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", manageDrawerFocus);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.clearTimeout(focusFallback);
      window.removeEventListener("keydown", manageDrawerFocus);
    };
  }, [audienceOpen]);

  useEffect(() => {
    if (snapshot?.phase !== "finished" || reportId) return;
    apiFetch<{ report: { id: string } }>(`/v1/sessions/${sessionId}/report`)
      .then(({ report }) => setReportId(report.id))
      .catch(() => undefined);
  }, [reportId, sessionId, snapshot?.phase]);

  function command(
    action: HostAction,
    options: {
      participantId?: string;
      interventionType?: InterventionType;
      recheckMode?: "linked" | "revote";
    } = {},
  ) {
    if (!snapshot || commandPending) return;
    if (!connected) {
      setError("Wait for the connection to recover before using host controls.");
      return;
    }
    const hostToken = sessionStorage.getItem(`openround:host:${sessionId}`);
    if (!hostToken) return;
    setError("");
    const commandId = clientUuid();
    if (!commandRecoveryRef.current?.begin(commandId, null)) return;
    socket.emit(
      "host.command",
      {
        sessionId,
        hostToken,
        commandId,
        expectedVersion: snapshot.version,
        action,
        ...options,
      },
      (response: Ack<{ snapshot: SessionSnapshot }>) => {
        if (!clearPendingCommand(commandId)) return;
        if (response.error) {
          if (response.error.code === "UNAUTHORIZED" && recoverHostCredentialRef.current) {
            void recoverHostCredentialRef.current(response.error, hostToken);
            return;
          }
          setError(response.error.message);
          socket.emit(
            "sync.request",
            { sessionId, role: "host", hostToken, lastSeq: snapshotRef.current?.seq ?? 0 },
            (sync: Ack<{ snapshot: SessionSnapshot }>) => {
              if (sync.data) setSnapshot(sync.data.snapshot);
            },
          );
        } else if (response.data) {
          setSnapshot(response.data.snapshot);
        } else {
          setError(HOST_ACK_TIMEOUT_MESSAGE);
          syncHostRef.current();
        }
      },
    );
  }

  async function presenterAccess(requireEmbedPolicy: boolean) {
    let token = sessionStorage.getItem(`openround:presenter:${sessionId}`);
    let embedPolicyKey = sessionStorage.getItem(`openround:presenter-policy:${sessionId}`);
    let embedAllowedOrigins: string[];
    try {
      embedAllowedOrigins = JSON.parse(
        sessionStorage.getItem(`openround:presenter-origins:${sessionId}`) ?? "[]",
      ) as string[];
    } catch {
      embedAllowedOrigins = [];
    }
    if (!token || requireEmbedPolicy) {
      const created = await apiFetch<{
        token: string;
        credential: SessionStaffCredential;
        embedPolicyKey?: string;
        embedAllowedOrigins?: string[];
      }>(`/v1/sessions/${sessionId}/staff`, {
        method: "POST",
        body: JSON.stringify({
          role: "presenter",
          label: requireEmbedPolicy ? "Secure presenter embed" : "Presenter popout",
        }),
      });
      token = created.token;
      embedPolicyKey = created.embedPolicyKey ?? null;
      embedAllowedOrigins = created.embedAllowedOrigins ?? [];
      sessionStorage.setItem(`openround:presenter:${sessionId}`, token);
      if (embedPolicyKey) {
        sessionStorage.setItem(`openround:presenter-policy:${sessionId}`, embedPolicyKey);
        sessionStorage.setItem(
          `openround:presenter-origins:${sessionId}`,
          JSON.stringify(embedAllowedOrigins),
        );
      }
      await loadStaff();
    }
    return { token, embedPolicyKey, embedAllowedOrigins };
  }

  async function presenter() {
    setError("");
    setPresenterPending(true);
    try {
      await presenterAccess(false);
      window.open(
        `/present/${sessionId}`,
        `openround-presenter-${sessionId}`,
        "popup,width=1440,height=900",
      );
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setPresenterPending(false);
    }
  }

  async function createEmbedLink() {
    setError("");
    setEmbedCopyStatus("");
    setPresenterPending(true);
    try {
      const access = await presenterAccess(true);
      if (!access.embedPolicyKey) throw new Error("A secure embed policy could not be created.");
      if (access.embedAllowedOrigins.length === 0) {
        throw new Error(
          "Ask a workspace owner to add at least one HTTPS embed origin in Account settings, then create a new embed link.",
        );
      }
      const url = new URL(
        `/embed/present/${sessionId}/${access.embedPolicyKey}`,
        window.location.origin,
      );
      url.hash = new URLSearchParams({ credential: access.token }).toString();
      setEmbedLink(url.toString());
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setPresenterPending(false);
    }
  }

  async function copyEmbedLink() {
    if (!embedLink) return;
    try {
      await navigator.clipboard.writeText(embedLink);
      setEmbedCopyStatus("Secure embed link copied.");
    } catch {
      setEmbedCopyStatus("Copy was blocked. Select and copy the link below.");
    }
  }

  async function createCohost() {
    setError("");
    setStaffPending(true);
    try {
      const created = await apiFetch<{ token: string; credential: SessionStaffCredential }>(
        `/v1/sessions/${sessionId}/staff`,
        {
          method: "POST",
          body: JSON.stringify({
            role: "cohost",
            label: cohostLabel.trim() || "Cohost",
            expiresInMinutes: 240,
          }),
        },
      );
      const url = new URL(`/host/${sessionId}`, window.location.origin);
      url.hash = new URLSearchParams({ cohost: created.token }).toString();
      setCohostLink(url.toString());
      setCohostLabel("");
      await loadStaff();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setStaffPending(false);
    }
  }

  async function revokeStaff(credentialId: string) {
    setError("");
    setStaffPending(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/staff/${credentialId}`, { method: "DELETE" });
      await loadStaff();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setStaffPending(false);
    }
  }

  function runPhaseCommand(item: HostPhaseCommand) {
    command(item.action, {
      ...(item.interventionType ? { interventionType: item.interventionType } : {}),
      ...(item.recheckMode ? { recheckMode: item.recheckMode } : {}),
    });
  }

  const phaseView = snapshot ? getHostPhaseView(snapshot) : null;
  const uxBeta = snapshot?.uxBeta === true;
  const legacyPhaseActions = snapshot ? getLegacyPhaseActions(snapshot) : [];
  const legacyRecoveryActions = snapshot ? getLegacyRecoveryActions(snapshot) : [];

  return (
    <div
      className="live-shell"
      data-corners={snapshot?.experienceTheme.tokens.corners}
      data-motion={snapshot?.experienceTheme.motion}
      data-pattern={snapshot?.experienceTheme.tokens.pattern}
      data-typography={snapshot?.experienceTheme.tokens.typography}
      data-ux-beta={uxBeta}
      style={experienceThemeStyle(snapshot?.experienceTheme)}
    >
      <header className="shell live-topbar" inert={audienceOpen}>
        <Brand inverted name={snapshot?.brandTheme?.organizationName} />
        <div className="button-row">
          <ExperiencePreferences />
          <span className="connection" data-connected={connected} role="status">
            <span className="connection-dot" aria-hidden="true" />
            {connected ? "Connected" : "Reconnecting…"}
          </span>
          <button
            className="button-quiet small-button"
            disabled={presenterPending}
            onClick={() => void presenter()}
            type="button"
          >
            Presenter view
          </button>
        </div>
      </header>
      <main
        className={uxBeta ? "shell host-command-center" : "shell"}
        id="main"
        inert={audienceOpen}
        style={uxBeta ? undefined : { padding: "26px 0 70px" }}
      >
        <p aria-atomic="true" aria-live="polite" className="sr-only">
          {phaseView ? `Host phase: ${phaseView.phaseLabel}.` : "Connecting host controls."}
        </p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {!snapshot ? (
          <section className="live-card">
            <p>Synchronizing host controls…</p>
            <Link href="/dashboard">Return to dashboard</Link>
          </section>
        ) : (
          <>
            {uxBeta ? (
              <section aria-label="Room readiness" className="room-readiness">
                <span>
                  <strong>{connected ? "Connected" : "Reconnecting"}</strong>
                  <small>connection</small>
                </span>
                <span>
                  <strong>{snapshot.code}</strong>
                  <small>round code</small>
                </span>
                <span>
                  <strong>{snapshot.participants.length}</strong>
                  <small>joined</small>
                </span>
                <span>
                  <strong>{snapshot.answerCount}</strong>
                  <small>answered</small>
                </span>
                <span>
                  <strong>
                    {snapshot.deadline
                      ? new Date(snapshot.deadline).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })
                      : "None"}
                  </strong>
                  <small>deadline</small>
                </span>
                <span>
                  <strong>
                    {snapshot.questionPosition === null || snapshot.questionPosition === undefined
                      ? "Lobby"
                      : `${snapshot.questionPosition + 1}/${snapshot.questionCount}`}
                  </strong>
                  <small>progress</small>
                </span>
                <span>
                  <strong>{phaseView?.phaseLabel ?? snapshot.phase.replaceAll("_", " ")}</strong>
                  <small>phase</small>
                </span>
              </section>
            ) : null}
            <div className="host-grid" data-phase={snapshot.phase} data-testid="host-session">
              <HostStage enhanced={uxBeta}>
                {snapshot.phase === "lobby" ? (
                  <>
                    <p className="eyebrow">Round code</p>
                    <h1 className="live-lobby-heading">Join this round</h1>
                    <div
                      className="session-code"
                      aria-label={`Round code ${snapshot.code.split("").join(" ")}`}
                    >
                      {snapshot.code}
                    </div>
                    <p className="lead">Share the code or QR. Start when the room is ready.</p>
                    <ul className="roster" aria-label="Participant roster">
                      {snapshot.participants.map((participant) => (
                        <li key={participant.id}>
                          <span>
                            {participant.nickname}
                            {participant.connected ? "" : " · offline"}
                          </span>
                          <button
                            aria-label={`Remove ${participant.nickname}`}
                            className="roster-kick"
                            disabled={commandPending}
                            onClick={() => command("kick", { participantId: participant.id })}
                            type="button"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {snapshot.question && snapshot.phase !== "finished" ? (
                  <>
                    <div
                      className="page-heading"
                      style={{ alignItems: "center", marginBottom: 18 }}
                    >
                      <span className="status-pill">{snapshot.phase.replaceAll("_", " ")}</span>
                      {snapshot.phase === "question_open" ? (
                        <Countdown deadline={snapshot.deadline} />
                      ) : null}
                    </div>
                    <h1 style={{ fontSize: "clamp(2rem, 6vw, 4rem)" }}>
                      {snapshot.question.prompt}
                    </h1>
                    <QuestionMedia
                      altText={snapshot.question.mediaAlt}
                      credential={mediaCredential}
                      mediaId={snapshot.question.mediaId}
                      sessionId={sessionId}
                    />
                    {snapshot.question.choices.length > 0 ? (
                      <div className="answer-grid">
                        {snapshot.question.choices.map((choice, index) => (
                          <div
                            className="answer-button"
                            data-correct={
                              snapshot.correctResponse?.kind === "choice" &&
                              snapshot.correctResponse.choiceIds.includes(choice.id)
                                ? true
                                : undefined
                            }
                            key={choice.id}
                          >
                            <span aria-hidden="true">{String.fromCharCode(65 + index)}.</span>{" "}
                            {choice.label}
                          </div>
                        ))}
                      </div>
                    ) : snapshot.question.type === "numeric" ? (
                      <p className="notice">
                        Participants enter a numeric response
                        {snapshot.question.unit ? ` in ${snapshot.question.unit}` : ""}.
                        {snapshot.correctResponse?.kind === "numeric"
                          ? ` Accepted value: ${snapshot.correctResponse.value}.`
                          : ""}
                      </p>
                    ) : snapshot.question.rating ? (
                      <p className="notice">
                        Rating {snapshot.question.rating.min}–{snapshot.question.rating.max}:{" "}
                        {snapshot.question.rating.minLabel} to {snapshot.question.rating.maxLabel}.
                      </p>
                    ) : null}
                    {snapshot.explanation ? <p className="notice">{snapshot.explanation}</p> : null}
                  </>
                ) : null}
                {snapshot.phase === "finished" ? (
                  <>
                    <p className="eyebrow">Round complete</p>
                    <h1 style={{ fontSize: "clamp(2.5rem, 7vw, 5rem)" }}>Results are ready.</h1>
                    <p className="lead">
                      {snapshot.participants.length} participants completed this live round.
                    </p>
                    {reportId ? (
                      <Link className="button" href={`/report/${reportId}`}>
                        Open report
                      </Link>
                    ) : (
                      <p className="notice">Finalizing the report…</p>
                    )}
                  </>
                ) : null}
              </HostStage>
              <RecoveryCompass phaseView={phaseView!} showSteps={uxBeta} snapshot={snapshot}>
                {snapshot.phase === "lobby" ? <JoinAccess code={snapshot.code} editable /> : null}
                {uxBeta && snapshot.responseDistribution ? (
                  <ResponseDistributionView distribution={snapshot.responseDistribution} />
                ) : null}
                {!uxBeta && legacyRecoveryActions.length > 0 ? (
                  <div className="host-controls" style={{ marginBottom: 18 }}>
                    <strong>
                      {snapshot.phase === "question_locked"
                        ? "Recover understanding"
                        : "Intervene and verify"}
                    </strong>
                    {legacyRecoveryActions.map((item) => (
                      <button
                        className={item.className}
                        disabled={commandPending}
                        key={`${item.action}:${item.interventionType ?? item.recheckMode ?? ""}`}
                        onClick={() => runPhaseCommand(item)}
                        type="button"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                {snapshot.phase === "intervention" && snapshot.intervention ? (
                  <p className="notice">
                    Active intervention: {snapshot.intervention.type.replaceAll("_", " ")}. Finish
                    it before revealing or rechecking.
                  </p>
                ) : null}
                {!uxBeta ? (
                  <div className="host-controls">
                    {legacyPhaseActions.map((item) => (
                      <button
                        className={item.className}
                        disabled={
                          commandPending ||
                          (item.action === "start" && snapshot.participants.length === 0)
                        }
                        key={item.action}
                        onClick={() => runPhaseCommand(item)}
                        type="button"
                      >
                        {item.label}
                      </button>
                    ))}
                    {snapshot.phase === "lobby" ? (
                      <button
                        className="button-quiet"
                        disabled={commandPending}
                        onClick={() =>
                          command(snapshot.lobbyLocked ? "unlock_lobby" : "lock_lobby")
                        }
                        type="button"
                      >
                        {snapshot.lobbyLocked ? "Unlock lobby" : "Lock lobby"}
                      </button>
                    ) : null}
                    {snapshot.phase !== "lobby" && snapshot.phase !== "finished" ? (
                      <button
                        className="button-danger"
                        disabled={commandPending}
                        onClick={() => window.confirm("End this session now?") && command("end")}
                        type="button"
                      >
                        End session
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {snapshot.settings.resultVisibility === "leaderboard" &&
                snapshot.phase !== "lobby" ? (
                  <ol style={{ paddingLeft: 24, lineHeight: 1.8 }}>
                    {snapshot.participants.slice(0, 5).map((participant) => (
                      <li key={participant.id}>
                        <strong>{participant.nickname}</strong> · {participant.score}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {staffManagementAvailable ? (
                  <details className="staff-management">
                    <summary>Round staff</summary>
                    <p className="muted">
                      Cohosts can run this round. Presenter credentials remain read-only. Links
                      expire automatically and can be revoked here.
                    </p>
                    {cohostingAvailable ? (
                      <>
                        <label className="field" htmlFor="cohost-label">
                          <span>Co-host label</span>
                          <input
                            className="input"
                            id="cohost-label"
                            maxLength={80}
                            onChange={(event) => setCohostLabel(event.target.value)}
                            placeholder="Teaching assistant"
                            value={cohostLabel}
                          />
                        </label>
                        <button
                          className="button-quiet small-button"
                          disabled={staffPending}
                          onClick={() => void createCohost()}
                          type="button"
                        >
                          Create cohost link
                        </button>
                        {cohostLink ? (
                          <div className="notice staff-share-link" role="status">
                            <strong>Share this link once</strong>
                            <a href={cohostLink}>{cohostLink}</a>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="notice">
                        Shareable cohost links are available on Pro, Team, and Community plans.{" "}
                        <Link href="/pricing">Compare plans</Link>.
                      </p>
                    )}
                    <hr className="staff-divider" />
                    <h3>Presenter embed</h3>
                    <p className="muted">
                      Creates a read-only presenter link restricted to the workspace&apos;s
                      configured HTTPS origins. The credential is carried in the URL fragment and
                      removed after opening.
                    </p>
                    <button
                      className="button-quiet small-button"
                      disabled={presenterPending}
                      onClick={() => void createEmbedLink()}
                      type="button"
                    >
                      Create secure embed link
                    </button>
                    {embedLink ? (
                      <div className="notice staff-share-link" role="status">
                        <strong>Embed this read-only presenter URL</strong>
                        <a href={embedLink}>{embedLink}</a>
                        <button
                          className="button-quiet small-button"
                          onClick={() => void copyEmbedLink()}
                          type="button"
                        >
                          Copy embed link
                        </button>
                        {embedCopyStatus ? <span>{embedCopyStatus}</span> : null}
                      </div>
                    ) : null}
                    {staffCredentials.length > 0 ? (
                      <ul className="staff-list">
                        {staffCredentials.map((credential) => (
                          <li key={credential.id}>
                            <span>
                              <strong>{credential.label || credential.role}</strong> ·{" "}
                              {credential.role}
                              {credential.revokedAt ? " · revoked" : ""}
                            </span>
                            {!credential.revokedAt ? (
                              <button
                                className="button-danger small-button"
                                disabled={staffPending}
                                onClick={() => void revokeStaff(credential.id)}
                                type="button"
                              >
                                Revoke
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </details>
                ) : null}
              </RecoveryCompass>
            </div>
            {!uxBeta && mediaCredential ? (
              <>
                {snapshot.phase !== "finished" ? (
                  <AudiencePanel
                    key={audiencePanelKey}
                    onKick={(participantId) => command("kick", { participantId })}
                    realtimeBatch={audienceRealtimeBatch}
                    role="moderator"
                    sessionId={sessionId}
                    syncRevision={audienceSyncRevision}
                    token={mediaCredential}
                  />
                ) : null}
                <QnaPanel
                  revision={qnaRevision}
                  role="moderator"
                  sessionId={sessionId}
                  token={mediaCredential}
                />
              </>
            ) : null}
            {uxBeta && phaseView ? (
              <HostCommandBar
                busy={commandPending}
                fallback={
                  reportId ? (
                    <Link className="button" href={`/report/${reportId}`}>
                      Open report
                    </Link>
                  ) : null
                }
                leading={
                  <>
                    <button
                      aria-controls="host-audience-drawer"
                      aria-expanded={audienceOpen}
                      className="button-quiet"
                      onClick={() => setAudienceOpen((open) => !open)}
                      ref={audienceButtonRef}
                      type="button"
                    >
                      Audience
                    </button>
                    {snapshot.phase === "lobby" ? (
                      <button
                        className="button-quiet"
                        disabled={commandPending}
                        onClick={() =>
                          command(snapshot.lobbyLocked ? "unlock_lobby" : "lock_lobby")
                        }
                        type="button"
                      >
                        {snapshot.lobbyLocked ? "Unlock lobby" : "Lock lobby"}
                      </button>
                    ) : null}
                  </>
                }
                onCommand={runPhaseCommand}
                phaseView={phaseView}
                primaryDisabled={
                  phaseView.primary?.action === "start" && snapshot.participants.length === 0
                }
                trailing={
                  snapshot.phase !== "lobby" && snapshot.phase !== "finished" ? (
                    <button
                      className="button-danger"
                      disabled={commandPending}
                      onClick={() => window.confirm("End this session now?") && command("end")}
                      type="button"
                    >
                      End
                    </button>
                  ) : null
                }
              />
            ) : null}
          </>
        )}
      </main>
      {snapshot && mediaCredential && uxBeta ? (
        <div
          aria-hidden={!audienceOpen}
          aria-labelledby="audience-drawer-title"
          aria-modal="true"
          className="audience-drawer"
          data-open={audienceOpen || undefined}
          data-testid="audience-drawer"
          id="host-audience-drawer"
          inert={!audienceOpen}
          ref={audienceDrawerRef}
          role="dialog"
        >
          <div className="audience-drawer-heading">
            <div>
              <p className="eyebrow">Audience</p>
              <h2 id="audience-drawer-title">Participants and conversation</h2>
            </div>
            <button
              aria-label="Close audience tools"
              className="button-quiet small-button"
              onClick={() => {
                setAudienceOpen(false);
                window.requestAnimationFrame(() => audienceButtonRef.current?.focus());
              }}
              ref={audienceCloseRef}
              type="button"
            >
              Close
            </button>
          </div>
          <div
            aria-label="Audience views"
            className="audience-tabs"
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const tabs = ["participants", "pulse", "qna", "chat"] as const;
              const currentIndex = tabs.indexOf(audienceTab);
              const direction = event.key === "ArrowRight" ? 1 : -1;
              const next = tabs[(currentIndex + direction + tabs.length) % tabs.length]!;
              setAudienceTab(next);
              document.getElementById(`audience-tab-${next}`)?.focus();
            }}
            role="tablist"
          >
            <button
              aria-controls="host-audience-panel"
              aria-selected={audienceTab === "participants"}
              id="audience-tab-participants"
              onClick={() => setAudienceTab("participants")}
              role="tab"
              tabIndex={audienceTab === "participants" ? 0 : -1}
              type="button"
            >
              Participants ({snapshot.participants.length})
            </button>
            <button
              aria-controls="host-audience-panel"
              aria-selected={audienceTab === "pulse"}
              id="audience-tab-pulse"
              onClick={() => setAudienceTab("pulse")}
              role="tab"
              tabIndex={audienceTab === "pulse" ? 0 : -1}
              type="button"
            >
              Pulse
            </button>
            <button
              aria-controls="host-qna-panel"
              aria-selected={audienceTab === "qna"}
              id="audience-tab-qna"
              onClick={() => setAudienceTab("qna")}
              role="tab"
              tabIndex={audienceTab === "qna" ? 0 : -1}
              type="button"
            >
              Q&amp;A
            </button>
            <button
              aria-controls="host-audience-panel"
              aria-selected={audienceTab === "chat"}
              id="audience-tab-chat"
              onClick={() => setAudienceTab("chat")}
              role="tab"
              tabIndex={audienceTab === "chat" ? 0 : -1}
              type="button"
            >
              Chat
            </button>
          </div>
          <div
            aria-labelledby={`audience-tab-${audienceTab}`}
            hidden={audienceTab === "qna"}
            id="host-audience-panel"
            role="tabpanel"
          >
            {snapshot.phase !== "finished" ? (
              <AudiencePanel
                key={audiencePanelKey}
                onKick={(participantId) => command("kick", { participantId })}
                realtimeBatch={audienceRealtimeBatch}
                role="moderator"
                sessionId={sessionId}
                syncRevision={audienceSyncRevision}
                token={mediaCredential}
                view={audienceTab === "qna" ? "participants" : audienceTab}
              />
            ) : (
              <p className="muted">Audience controls close when the round finishes.</p>
            )}
          </div>
          <div
            aria-labelledby="audience-tab-qna"
            hidden={audienceTab !== "qna"}
            id="host-qna-panel"
            role="tabpanel"
          >
            <QnaPanel
              revision={qnaRevision}
              role="moderator"
              sessionId={sessionId}
              token={mediaCredential}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
