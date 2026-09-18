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
import { AudiencePanel, type AudienceRealtimeUpdate } from "../../../components/audience-panel";
import { ExperiencePreferences } from "../../../components/experience-preferences";
import { Countdown } from "../../../components/countdown";
import { JoinAccess } from "../../../components/join-access";
import { QuestionMedia } from "../../../components/question-media";
import { QnaPanel } from "../../../components/qna-panel";
import { apiFetch, humanError } from "../../../lib/api";
import {
  audienceContextKey,
  createAudienceRealtimeReceipt,
  createRealtimeClient,
  withRealtimeReceipt,
} from "../../../lib/realtime";
import { experienceThemeStyle } from "../../../lib/theme";
import { clientUuid } from "../../../lib/uuid";

type Ack<T> = { data?: T; error?: { code: string; message: string } };

function hostCredential(sessionId: string) {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const cohostToken = fragment.get("cohost");
  if (cohostToken) {
    sessionStorage.setItem(`openround:host:${sessionId}`, cohostToken);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return cohostToken;
  }
  return sessionStorage.getItem(`openround:host:${sessionId}`);
}

function actionsFor(
  snapshot: SessionSnapshot,
): Array<{ action: HostAction; label: string; className: string }> {
  switch (snapshot.phase) {
    case "lobby":
      return [{ action: "start", label: "Start round", className: "button" }];
    case "question_open":
      return [
        { action: "pause", label: "Pause", className: "button-quiet" },
        { action: "lock", label: "Lock answers", className: "button" },
      ];
    case "paused":
      return [
        { action: "resume", label: "Resume", className: "button" },
        { action: "lock", label: "Lock answers", className: "button-quiet" },
      ];
    case "question_locked":
      return [{ action: "reveal", label: "Reveal answer", className: "button" }];
    case "question_reveal":
      return [
        { action: "show_leaderboard", label: "Show standings", className: "button-quiet" },
        {
          action: "next",
          label:
            snapshot.roundKind !== "main"
              ? "Continue after recheck"
              : (snapshot.questionPosition ?? snapshot.questionIndex) === snapshot.questionCount - 1
                ? "Finish round"
                : "Next checkpoint",
          className: "button",
        },
      ];
    case "intervention":
      return [
        {
          action: "intervention.finish",
          label: "Finish intervention",
          className: "button",
        },
      ];
    case "leaderboard":
      return [
        {
          action: "next",
          label:
            snapshot.roundKind !== "main"
              ? "Continue after recheck"
              : (snapshot.questionPosition ?? snapshot.questionIndex) === snapshot.questionCount - 1
                ? "Finish round"
                : "Next checkpoint",
          className: "button",
        },
      ];
    default:
      return [];
  }
}

export default function HostPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const socket = useMemo(createRealtimeClient, []);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const snapshotRef = useRef<SessionSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reportId, setReportId] = useState("");
  const [mediaCredential, setMediaCredential] = useState("");
  const [qnaRevision, setQnaRevision] = useState(0);
  const [audienceSyncRevision, setAudienceSyncRevision] = useState(0);
  const [audienceRealtimeUpdate, setAudienceRealtimeUpdate] =
    useState<AudienceRealtimeUpdate | null>(null);
  const [staffCredentials, setStaffCredentials] = useState<SessionStaffCredential[]>([]);
  const [cohostLabel, setCohostLabel] = useState("");
  const [cohostLink, setCohostLink] = useState("");
  const [embedLink, setEmbedLink] = useState("");
  const [embedCopyStatus, setEmbedCopyStatus] = useState("");
  const [staffManagementAvailable, setStaffManagementAvailable] = useState(false);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    const hostToken = hostCredential(sessionId);
    if (!hostToken) {
      setError(
        "This tab does not have the host credential. Start the session from your dashboard.",
      );
      return;
    }
    setMediaCredential(hostToken);
    const sync = () => {
      socket.emit(
        "sync.request",
        { sessionId, role: "host", hostToken, lastSeq: snapshotRef.current?.seq ?? 0 },
        (response: Ack<{ snapshot: SessionSnapshot }>) => {
          if (response.error) setError(response.error.message);
          if (response.data) setSnapshot(response.data.snapshot);
        },
      );
    };
    const update = withRealtimeReceipt(
      (envelope: EventEnvelope<{ snapshot: SessionSnapshot; reportId?: string }>) => {
        if (
          audienceContextKey(envelope.payload.snapshot) !== audienceContextKey(snapshotRef.current)
        ) {
          setAudienceSyncRevision((current) => current + 1);
        }
        setSnapshot(envelope.payload.snapshot);
        if (envelope.payload.reportId) setReportId(envelope.payload.reportId);
        setBusy(false);
      },
    );
    const qnaUpdate = withRealtimeReceipt(() => setQnaRevision((current) => current + 1));
    const audienceUpdate = createAudienceRealtimeReceipt((gap, envelope) => {
      setAudienceRealtimeUpdate({ gap, envelope });
      if (envelope.type.startsWith("qna.")) setQnaRevision((current) => current + 1);
    });
    socket.on("connect", () => {
      setConnected(true);
      setError("");
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
    socket.connect();
    return () => {
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
    if (!snapshot || busy) return;
    const hostToken = sessionStorage.getItem(`openround:host:${sessionId}`);
    if (!hostToken) return;
    setBusy(true);
    setError("");
    socket.emit(
      "host.command",
      {
        sessionId,
        hostToken,
        commandId: clientUuid(),
        expectedVersion: snapshot.version,
        action,
        ...options,
      },
      (response: Ack<{ snapshot: SessionSnapshot }>) => {
        setBusy(false);
        if (response.error) {
          setError(response.error.message);
          socket.emit(
            "sync.request",
            { sessionId, role: "host", hostToken, lastSeq: snapshotRef.current?.seq ?? 0 },
            (sync: Ack<{ snapshot: SessionSnapshot }>) => {
              if (sync.data) setSnapshot(sync.data.snapshot);
            },
          );
        } else if (response.data) setSnapshot(response.data.snapshot);
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
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function createEmbedLink() {
    setError("");
    setEmbedCopyStatus("");
    setBusy(true);
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
      setBusy(false);
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
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function revokeStaff(credentialId: string) {
    setError("");
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/staff/${credentialId}`, { method: "DELETE" });
      await loadStaff();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="live-shell"
      data-corners={snapshot?.experienceTheme.tokens.corners}
      data-motion={snapshot?.experienceTheme.motion}
      data-pattern={snapshot?.experienceTheme.tokens.pattern}
      data-typography={snapshot?.experienceTheme.tokens.typography}
      style={experienceThemeStyle(snapshot?.experienceTheme)}
    >
      <header className="shell live-topbar">
        <Brand inverted name={snapshot?.brandTheme?.organizationName} />
        <div className="button-row">
          <ExperiencePreferences />
          <span className="connection" data-connected={connected} role="status">
            <span className="connection-dot" aria-hidden="true" />
            {connected ? "Connected" : "Reconnecting…"}
          </span>
          <button
            className="button-quiet small-button"
            disabled={busy}
            onClick={() => void presenter()}
            type="button"
          >
            Presenter view
          </button>
        </div>
      </header>
      <main className="shell" style={{ padding: "26px 0 70px" }}>
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
          <div className="host-grid">
            <section className="live-card" aria-live="polite">
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
                          disabled={busy}
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
                  <div className="page-heading" style={{ alignItems: "center", marginBottom: 18 }}>
                    <span className="status-pill">{snapshot.phase.replaceAll("_", " ")}</span>
                    {snapshot.phase === "question_open" ? (
                      <Countdown deadline={snapshot.deadline} />
                    ) : null}
                  </div>
                  <h1 style={{ fontSize: "clamp(2rem, 6vw, 4rem)" }}>{snapshot.question.prompt}</h1>
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
            </section>
            <aside className="panel">
              <h2 style={{ fontSize: "1.35rem" }}>Host controls</h2>
              {snapshot.phase === "lobby" ? <JoinAccess code={snapshot.code} editable /> : null}
              <div
                className="metric-grid"
                style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 18 }}
              >
                <div className="metric">
                  <strong>{snapshot.participants.length}</strong>
                  <span>joined</span>
                </div>
                <div className="metric">
                  <strong>{snapshot.answerCount}</strong>
                  <span>answered</span>
                </div>
              </div>
              {snapshot.insight ? (
                <div className="notice" aria-live="polite" style={{ marginBottom: 18 }}>
                  <p className="eyebrow">Facilitator guidance</p>
                  <strong>{snapshot.insight.recommendation.title}</strong>
                  <p>{snapshot.insight.recommendation.reason}</p>
                  <small>
                    Based on {snapshot.insight.sampleSize} responses ·{" "}
                    {snapshot.insight.participationPercent}% participation
                    {snapshot.insight.correctnessPercent === null
                      ? " · unscored"
                      : ` · ${snapshot.insight.correctnessPercent}% correct`}
                    . This is a deterministic suggestion; use your judgment.
                  </small>
                </div>
              ) : null}
              {snapshot.phase === "question_locked" && snapshot.roundKind === "main" ? (
                <div className="host-controls" style={{ marginBottom: 18 }}>
                  <strong>Recover understanding</strong>
                  <button
                    className="button-quiet"
                    disabled={busy}
                    onClick={() =>
                      command("intervention.start", { interventionType: "peer_discussion" })
                    }
                    type="button"
                  >
                    Start peer discussion
                  </button>
                  <button
                    className="button-quiet"
                    disabled={busy}
                    onClick={() => command("recheck.open", { recheckMode: "revote" })}
                    type="button"
                  >
                    Reopen as revote
                  </button>
                  {snapshot.question?.linkedRecheckAvailable ? (
                    <button
                      className="button-quiet"
                      disabled={busy}
                      onClick={() => command("recheck.open", { recheckMode: "linked" })}
                      type="button"
                    >
                      Open linked recheck
                    </button>
                  ) : null}
                </div>
              ) : null}
              {snapshot.phase === "question_reveal" && snapshot.roundKind === "main" ? (
                <div className="host-controls" style={{ marginBottom: 18 }}>
                  <strong>Intervene and verify</strong>
                  <button
                    className="button-quiet"
                    disabled={busy}
                    onClick={() => command("intervention.start", { interventionType: "explain" })}
                    type="button"
                  >
                    Record explanation
                  </button>
                  <button
                    className="button-quiet"
                    disabled={busy}
                    onClick={() => command("intervention.start", { interventionType: "example" })}
                    type="button"
                  >
                    Work an example
                  </button>
                  <button
                    className="button-quiet"
                    disabled={busy}
                    onClick={() => command("recheck.open", { recheckMode: "revote" })}
                    type="button"
                  >
                    Recheck by revote
                  </button>
                  {snapshot.question?.linkedRecheckAvailable ? (
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => command("recheck.open", { recheckMode: "linked" })}
                      type="button"
                    >
                      Open linked recheck
                    </button>
                  ) : null}
                </div>
              ) : null}
              {snapshot.phase === "intervention" && snapshot.intervention ? (
                <p className="notice">
                  Active intervention: {snapshot.intervention.type.replaceAll("_", " ")}. Finish it
                  before revealing or rechecking.
                </p>
              ) : null}
              <div className="host-controls">
                {actionsFor(snapshot).map((item) => (
                  <button
                    className={item.className}
                    disabled={
                      busy || (item.action === "start" && snapshot.participants.length === 0)
                    }
                    key={item.action}
                    onClick={() => command(item.action)}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
                {snapshot.phase === "lobby" ? (
                  <button
                    className="button-quiet"
                    disabled={busy}
                    onClick={() => command(snapshot.lobbyLocked ? "unlock_lobby" : "lock_lobby")}
                    type="button"
                  >
                    {snapshot.lobbyLocked ? "Unlock lobby" : "Lock lobby"}
                  </button>
                ) : null}
                {snapshot.phase !== "lobby" && snapshot.phase !== "finished" ? (
                  <button
                    className="button-danger"
                    disabled={busy}
                    onClick={() => window.confirm("End this session now?") && command("end")}
                    type="button"
                  >
                    End session
                  </button>
                ) : null}
              </div>
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
                    Cohosts can run this round. Presenter credentials remain read-only. Links expire
                    automatically and can be revoked here.
                  </p>
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
                    disabled={busy}
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
                  <hr className="staff-divider" />
                  <h3>Presenter embed</h3>
                  <p className="muted">
                    Creates a read-only presenter link restricted to the workspace&apos;s configured
                    HTTPS origins. The credential is carried in the URL fragment and removed after
                    opening.
                  </p>
                  <button
                    className="button-quiet small-button"
                    disabled={busy}
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
                              disabled={busy}
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
            </aside>
          </div>
        )}
        {snapshot && snapshot.phase !== "finished" && mediaCredential ? (
          <AudiencePanel
            onKick={(participantId) => command("kick", { participantId })}
            realtimeUpdate={audienceRealtimeUpdate}
            role="moderator"
            sessionId={sessionId}
            syncRevision={audienceSyncRevision}
            token={mediaCredential}
          />
        ) : null}
        {snapshot && mediaCredential ? (
          <QnaPanel
            revision={qnaRevision}
            role="moderator"
            sessionId={sessionId}
            token={mediaCredential}
          />
        ) : null}
      </main>
    </div>
  );
}
