"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AudienceSignalSchema,
  ChatMessageSchema,
  InteractionSettingsSchema,
  InteractionSummarySchema,
  type AudienceEventEnvelope,
  type AudienceSignal,
  type ChatMessage,
  type ChatPage,
  type ChatReaction,
  type InteractionSettings,
  type InteractionSummary,
} from "@openround/contracts";
import { apiFetch, humanError } from "../lib/api";
import { clientUuid } from "../lib/uuid";

const signalOptions: Array<{ id: AudienceSignal; label: string; icon: string }> = [
  { id: "got_it", label: "Got it", icon: "✓" },
  { id: "unsure", label: "I’m unsure", icon: "?" },
  { id: "need_example", label: "Show an example", icon: "▣" },
  { id: "too_fast", label: "Too fast", icon: "↘" },
];

const reactionOptions: Array<{ id: ChatReaction; label: string; icon: string }> = [
  { id: "like", label: "Like", icon: "👍" },
  { id: "love", label: "Love", icon: "♥" },
  { id: "insight", label: "Insightful", icon: "💡" },
  { id: "laugh", label: "Funny", icon: "☺" },
];

export interface AudienceSync {
  settings: InteractionSettings;
  capabilities: { audiencePulse: boolean; roomChat: boolean };
  summary: InteractionSummary;
  chat: ChatPage;
}

export interface AudienceRealtimeUpdate {
  gap: boolean;
  envelope: AudienceEventEnvelope;
}

function objectPayload(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

export function applyAudienceRealtimeEvent(
  current: AudienceSync,
  envelope: AudienceEventEnvelope,
): AudienceSync {
  const payload = objectPayload(envelope.payload);
  if (!payload) return current;
  const summaryResult = InteractionSummarySchema.safeParse(payload.summary);
  if (summaryResult.success) {
    const priorOwnSignal = current.summary.mySignal;
    const summary =
      priorOwnSignal !== undefined && summaryResult.data.mySignal === undefined
        ? { ...summaryResult.data, mySignal: priorOwnSignal }
        : summaryResult.data;
    return { ...current, summary };
  }
  const settingsResult = InteractionSettingsSchema.safeParse(payload.settings);
  if (settingsResult.success) {
    return {
      ...current,
      settings: settingsResult.data,
      chat: { ...current.chat, settings: settingsResult.data },
    };
  }
  if (envelope.type.startsWith("chat.")) {
    const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
    if (!messageId) return current;
    const messageResult = ChatMessageSchema.safeParse(payload.message);
    const messages = current.chat.messages.filter((message) => message.id !== messageId);
    if (messageResult.success) messages.unshift(messageResult.data);
    messages.sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() ||
        right.id.localeCompare(left.id),
    );
    return {
      ...current,
      chat: {
        ...current.chat,
        messages: messages.slice(0, 50),
        audienceSeq: Math.max(current.chat.audienceSeq, envelope.audienceSeq),
      },
    };
  }
  if (envelope.type === "audience.signal.updated") {
    const participantId = typeof payload.participantId === "string" ? payload.participantId : null;
    const signalResult = AudienceSignalSchema.nullable().safeParse(payload.signal);
    const updatedAt = typeof payload.updatedAt === "string" ? payload.updatedAt : null;
    if (!participantId || !signalResult.success || !current.summary.participants) return current;
    const previous = current.summary.participants.find(
      (participant) => participant.participantId === participantId,
    )?.currentSignal;
    const participants = current.summary.participants.map((participant) =>
      participant.participantId === participantId
        ? {
            ...participant,
            currentSignal: signalResult.data,
            lastSignalAt: updatedAt,
            lastActivityAt: updatedAt ?? participant.lastActivityAt,
          }
        : participant,
    );
    const counts = current.summary.signalCounts
      ? { ...current.summary.signalCounts }
      : current.summary.signalCounts;
    if (counts && previous) counts[previous] = Math.max(0, counts[previous] - 1);
    if (counts && signalResult.data) counts[signalResult.data] += 1;
    return {
      ...current,
      summary: {
        ...current.summary,
        audienceSeq: Math.max(current.summary.audienceSeq, envelope.audienceSeq),
        participants,
        signalCounts: counts,
        uniqueSignalers:
          current.summary.uniqueSignalers +
          (previous ? 0 : signalResult.data ? 1 : 0) -
          (previous && !signalResult.data ? 1 : 0),
        signalsLastMinute: current.summary.signalsLastMinute + 1,
      },
    };
  }
  if (envelope.type === "audience.moderation.updated" && current.summary.participants) {
    const participantId = typeof payload.participantId === "string" ? payload.participantId : null;
    if (!participantId) return current;
    return {
      ...current,
      summary: {
        ...current.summary,
        audienceSeq: Math.max(current.summary.audienceSeq, envelope.audienceSeq),
        participants: current.summary.participants.map((participant) =>
          participant.participantId === participantId
            ? {
                ...participant,
                mutedUntil: typeof payload.mutedUntil === "string" ? payload.mutedUntil : null,
                banned: payload.banned === true,
              }
            : participant,
        ),
      },
    };
  }
  return current;
}

function mutationHeaders() {
  return { "x-idempotency-key": clientUuid() };
}

export function AudiencePanel({
  sessionId,
  token,
  role,
  syncRevision,
  realtimeUpdate,
  onKick,
}: {
  sessionId: string;
  token: string;
  role: "moderator" | "participant" | "presenter";
  syncRevision: number;
  realtimeUpdate: AudienceRealtimeUpdate | null;
  onKick?: (participantId: string) => void;
}) {
  const [data, setData] = useState<AudienceSync | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [reportedMessages, setReportedMessages] = useState<Set<string>>(() => new Set());
  const [participantFilter, setParticipantFilter] = useState<
    "all" | "needs_help" | "not_answered" | "disconnected" | "muted"
  >("all");
  const [muteDurationMinutes, setMuteDurationMinutes] = useState<5 | 15 | 60>(15);
  const authorization = useMemo(() => ({ authorization: `Bearer ${token}` }), [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const synchronized = await apiFetch<AudienceSync>(
        `/v1/sessions/${sessionId}/interactions/sync?limit=50`,
        { headers: authorization },
      );
      setData(synchronized);
      setError("");
    } catch (caught) {
      setError(humanError(caught));
    }
  }, [authorization, sessionId, token]);

  useEffect(() => {
    void refresh();
  }, [refresh, syncRevision]);

  useEffect(() => {
    if (!realtimeUpdate) return;
    if (realtimeUpdate.gap) {
      void refresh();
      return;
    }
    if (role === "presenter" && realtimeUpdate.envelope.type === "audience.settings.updated") {
      void refresh();
      return;
    }
    setData((current) =>
      current ? applyAudienceRealtimeEvent(current, realtimeUpdate.envelope) : current,
    );
  }, [realtimeUpdate, refresh, role]);

  async function updateSettings(update: Partial<InteractionSettings>) {
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/interactions/settings`, {
        method: "PATCH",
        headers: { ...authorization, ...mutationHeaders() },
        body: JSON.stringify(update),
      });
      await refresh();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function setSignal(signal: AudienceSignal | null) {
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/signals/current`, {
        method: "PUT",
        headers: authorization,
        body: JSON.stringify({ signal, idempotencyKey: clientUuid() }),
      });
      await refresh();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/chat/messages`, {
        method: "POST",
        headers: authorization,
        body: JSON.stringify({
          body: message,
          replyToMessageId: replyTo?.id ?? null,
          idempotencyKey: clientUuid(),
        }),
      });
      setMessage("");
      setReplyTo(null);
      await refresh();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function react(messageId: string, reaction: ChatReaction, selected: boolean) {
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/chat/messages/${messageId}/reaction`, {
        method: selected ? "DELETE" : "PUT",
        headers: { ...authorization, ...mutationHeaders() },
        ...(!selected ? { body: JSON.stringify({ reaction }) } : {}),
      });
      await refresh();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function moderateMessage(
    messageId: string,
    update: { status?: "removed"; pinned?: boolean },
  ) {
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/chat/messages/${messageId}`, {
        method: "PATCH",
        headers: { ...authorization, ...mutationHeaders() },
        body: JSON.stringify(update),
      });
      await refresh();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reportMessage(messageId: string) {
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/chat/messages/${messageId}/report`, {
        method: "POST",
        headers: { ...authorization, ...mutationHeaders() },
      });
      setReportedMessages((current) => new Set(current).add(messageId));
      await refresh();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function moderateParticipant(
    participantId: string,
    action: "mute" | "unmute" | "ban" | "unban",
  ) {
    setBusy(true);
    try {
      await apiFetch(`/v1/sessions/${sessionId}/interactions/participants/${participantId}`, {
        method: "PATCH",
        headers: { ...authorization, ...mutationHeaders() },
        body: JSON.stringify({
          action,
          ...(action === "mute" ? { durationMinutes: muteDurationMinutes } : {}),
        }),
      });
      await refresh();
    } catch (caught) {
      setError(humanError(caught));
    } finally {
      setBusy(false);
    }
  }

  const participants = (data?.summary.participants ?? []).filter((participant) => {
    if (participantFilter === "needs_help")
      return ["unsure", "need_example", "too_fast"].includes(participant.currentSignal ?? "");
    if (participantFilter === "not_answered") return !participant.answered;
    if (participantFilter === "disconnected") return !participant.connected;
    if (participantFilter === "muted") return Boolean(participant.mutedUntil || participant.banned);
    return true;
  });

  if (!data) {
    return (
      <section className="panel audience-panel" aria-busy="true">
        <p>{error || "Loading Audience Pulse…"}</p>
      </section>
    );
  }

  return (
    <section className="panel audience-panel" aria-label="Audience interaction">
      <div className="audience-panel-heading">
        <div>
          <p className="eyebrow">Audience Pulse</p>
          <h2>Room signals and conversation</h2>
        </div>
        <span className="status-pill">Live · {data.summary.connectedParticipants} connected</span>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {role === "moderator" ? (
        <>
          <div className="interaction-settings" aria-label="Audience interaction settings">
            <label className="checkbox-field">
              <input
                checked={data.settings.signalsEnabled}
                disabled={busy || !data.capabilities.audiencePulse}
                onChange={(event) => void updateSettings({ signalsEnabled: event.target.checked })}
                type="checkbox"
              />
              Audience Pulse
            </label>
            <label className="checkbox-field">
              <input
                checked={data.settings.chatEnabled}
                disabled={busy || !data.capabilities.roomChat}
                onChange={(event) => void updateSettings({ chatEnabled: event.target.checked })}
                type="checkbox"
              />
              Room chat
            </label>
            <label className="field compact-field">
              <span>Chat names</span>
              <select
                className="select"
                disabled={busy || !data.capabilities.roomChat}
                onChange={(event) =>
                  void updateSettings({
                    chatIdentityMode: event.target.value as InteractionSettings["chatIdentityMode"],
                  })
                }
                value={data.settings.chatIdentityMode}
              >
                <option value="alias_public">Show session aliases</option>
                <option value="alias_private">Anonymous to the room</option>
              </select>
            </label>
            <label className="field compact-field">
              <span>Slow mode</span>
              <select
                className="select"
                disabled={busy || !data.capabilities.roomChat}
                onChange={(event) =>
                  void updateSettings({
                    slowModeSeconds: Number(
                      event.target.value,
                    ) as InteractionSettings["slowModeSeconds"],
                  })
                }
                value={data.settings.slowModeSeconds}
              >
                <option value={0}>Off</option>
                <option value={5}>5 seconds</option>
                <option value={15}>15 seconds</option>
                <option value={30}>30 seconds</option>
              </select>
            </label>
            <label className="field compact-field">
              <span>Presenter feed</span>
              <select
                className="select"
                disabled={busy || !data.capabilities.roomChat}
                onChange={(event) =>
                  void updateSettings({
                    presenterFeedMode: event.target
                      .value as InteractionSettings["presenterFeedMode"],
                  })
                }
                value={data.settings.presenterFeedMode}
              >
                <option value="off">Off</option>
                <option value="pinned">Pinned only</option>
                <option value="live">Live feed</option>
              </select>
            </label>
          </div>

          {!data.capabilities.audiencePulse || !data.capabilities.roomChat ? (
            <p className="notice">
              {!data.capabilities.audiencePulse
                ? "Audience Pulse is not enabled for this workspace. "
                : ""}
              {!data.capabilities.roomChat ? "Room chat is not enabled for this workspace." : ""}
            </p>
          ) : null}

          <div className="audience-metrics">
            <div className="metric">
              <strong>{data.summary.connectedParticipants}</strong>
              <span>connected</span>
            </div>
            <div className="metric">
              <strong>{data.summary.disconnectedParticipants}</strong>
              <span>disconnected</span>
            </div>
            <div className="metric">
              <strong>{data.summary.answeredParticipants}</strong>
              <span>answered</span>
            </div>
            <div className="metric">
              <strong>{data.summary.uniqueSignalers}</strong>
              <span>signaled</span>
            </div>
            <div className="metric">
              <strong>{data.summary.signalsLastMinute}</strong>
              <span>signals / min</span>
            </div>
            <div className="metric">
              <strong>{data.summary.messagesLastMinute}</strong>
              <span>messages / min</span>
            </div>
            <div className="metric">
              <strong>{data.summary.uniqueChatContributors}</strong>
              <span>contributors</span>
            </div>
          </div>
        </>
      ) : data.settings.signalsEnabled && role === "participant" ? (
        <div className="pulse-compose">
          <p>
            <strong>How is this landing?</strong>
          </p>
          <div className="pulse-buttons">
            {signalOptions.map((option) => {
              const selected = data.summary.mySignal === option.id;
              return (
                <button
                  aria-pressed={selected}
                  className="pulse-button"
                  data-selected={selected || undefined}
                  disabled={busy}
                  key={option.id}
                  onClick={() => void setSignal(selected ? null : option.id)}
                  type="button"
                >
                  <span aria-hidden="true">{option.icon}</span>
                  {option.label}
                </button>
              );
            })}
          </div>
          <small className="muted">
            The facilitator can see your session alias and signal; the room sees totals only.
          </small>
        </div>
      ) : null}

      {data.summary.signalCounts ? (
        <div className="pulse-distribution" aria-label="Current pulse distribution">
          {signalOptions.map((option) => {
            const count = data.summary.signalCounts?.[option.id] ?? 0;
            const denominator = Math.max(1, data.summary.uniqueSignalers);
            return (
              <div className="pulse-stat" key={option.id}>
                <div>
                  <span>{option.label}</span>
                  <strong>{count}</strong>
                </div>
                <div className="pulse-meter" aria-hidden="true">
                  <span style={{ width: `${(count / denominator) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : data.summary.uniqueSignalers > 0 ? (
        <p className="muted">
          Aggregate Pulse appears after five people signal to protect individual privacy.
        </p>
      ) : null}

      {role === "moderator" && data.summary.participants ? (
        <div className="participant-pulse-table">
          <div className="toolbar">
            <strong>Participant activity</strong>
            <label>
              <span className="sr-only">Filter participants</span>
              <select
                className="select compact-select"
                onChange={(event) =>
                  setParticipantFilter(event.target.value as typeof participantFilter)
                }
                value={participantFilter}
              >
                <option value="all">Everyone</option>
                <option value="needs_help">Needs help</option>
                <option value="not_answered">Not answered</option>
                <option value="disconnected">Disconnected</option>
                <option value="muted">Muted or banned</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Temporary mute duration</span>
              <select
                className="select compact-select"
                onChange={(event) =>
                  setMuteDurationMinutes(Number(event.target.value) as 5 | 15 | 60)
                }
                value={muteDurationMinutes}
              >
                <option value={5}>Mute: 5 min</option>
                <option value={15}>Mute: 15 min</option>
                <option value={60}>Mute: 60 min</option>
              </select>
            </label>
          </div>
          <div className="table-wrap" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Alias</th>
                  <th>Status</th>
                  <th>Pulse</th>
                  <th>Chat</th>
                  <th>Moderation</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((participant) => (
                  <tr key={participant.participantId}>
                    <td>{participant.nickname}</td>
                    <td>
                      {participant.connected ? "Connected" : "Offline"} ·{" "}
                      {participant.answered ? "answered" : "waiting"}
                    </td>
                    <td>{participant.currentSignal?.replaceAll("_", " ") ?? "—"}</td>
                    <td>{participant.chatMessageCount}</td>
                    <td>
                      <div className="button-row">
                        <button
                          className="button-quiet tiny-button"
                          disabled={busy}
                          onClick={() =>
                            void moderateParticipant(
                              participant.participantId,
                              participant.mutedUntil ? "unmute" : "mute",
                            )
                          }
                          type="button"
                        >
                          {participant.mutedUntil ? "Unmute" : `Mute ${muteDurationMinutes}m`}
                        </button>
                        <button
                          className="button-danger tiny-button"
                          disabled={busy}
                          onClick={() =>
                            void moderateParticipant(
                              participant.participantId,
                              participant.banned ? "unban" : "ban",
                            )
                          }
                          type="button"
                        >
                          {participant.banned ? "Restore" : "Ban"}
                        </button>
                        {onKick ? (
                          <button
                            className="button-danger tiny-button"
                            disabled={busy}
                            onClick={() => onKick(participant.participantId)}
                            type="button"
                          >
                            Kick
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="chat-section">
        <div className="chat-heading">
          <div>
            <p className="eyebrow">Room chat</p>
            <h3>{data.settings.chatEnabled ? "Conversation is open" : "Conversation is closed"}</h3>
          </div>
          {role === "moderator" ? (
            <span className="muted">
              {data.summary.reportedCount} reports · {data.summary.moderationCount} moderated
            </span>
          ) : null}
        </div>
        {data.settings.chatEnabled && role !== "presenter" ? (
          <form className="chat-compose" onSubmit={sendMessage}>
            {replyTo ? (
              <div className="chat-replying">
                Replying to {replyTo.author.displayName}
                <button onClick={() => setReplyTo(null)} type="button">
                  Cancel
                </button>
              </div>
            ) : null}
            <label className="sr-only" htmlFor={`chat-message-${role}`}>
              Chat message
            </label>
            <input
              className="input"
              id={`chat-message-${role}`}
              maxLength={500}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Write a plain-text message…"
              value={message}
            />
            <button className="button" disabled={busy || !message.trim()} type="submit">
              Send
            </button>
          </form>
        ) : null}
        <ol className="chat-list" aria-label="Room messages">
          {data.chat.messages.map((item) => (
            <li className="chat-message" data-removed={item.status === "removed"} key={item.id}>
              <div className="chat-message-meta">
                <span>
                  <strong>{item.author.displayName}</strong>
                  {item.author.kind === "staff" ? " · facilitator" : ""}
                </span>
                {item.pinned ? <span className="status-pill">Pinned</span> : null}
              </div>
              <p>{item.body}</p>
              {item.status !== "removed" ? (
                <div className="chat-actions">
                  {role === "participant"
                    ? reactionOptions.map((reaction) => (
                        <button
                          aria-label={`${reaction.label}: ${item.reactions[reaction.id]}`}
                          aria-pressed={item.myReaction === reaction.id}
                          className="reaction-button"
                          disabled={busy}
                          key={reaction.id}
                          onClick={() =>
                            void react(item.id, reaction.id, item.myReaction === reaction.id)
                          }
                          type="button"
                        >
                          <span aria-hidden="true">{reaction.icon}</span>{" "}
                          {item.reactions[reaction.id] || ""}
                        </button>
                      ))
                    : reactionOptions
                        .filter((reaction) => item.reactions[reaction.id] > 0)
                        .map((reaction) => (
                          <span className="reaction-count" key={reaction.id}>
                            <span aria-hidden="true">{reaction.icon}</span>{" "}
                            {item.reactions[reaction.id]}
                          </span>
                        ))}
                  {role !== "presenter" && !item.replyToMessageId ? (
                    <button className="text-button" onClick={() => setReplyTo(item)} type="button">
                      Reply
                    </button>
                  ) : null}
                  {role === "participant" && !item.author.mine ? (
                    <button
                      className="text-button"
                      disabled={busy || reportedMessages.has(item.id)}
                      onClick={() => void reportMessage(item.id)}
                      type="button"
                    >
                      {reportedMessages.has(item.id) ? "Reported" : "Report"}
                    </button>
                  ) : null}
                  {role === "moderator" ? (
                    <>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void moderateMessage(item.id, { pinned: !item.pinned })}
                        type="button"
                      >
                        {item.pinned ? "Unpin" : "Pin"}
                      </button>
                      <button
                        className="danger-link"
                        disabled={busy}
                        onClick={() => void moderateMessage(item.id, { status: "removed" })}
                        type="button"
                      >
                        Remove
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {data.chat.messages.length === 0 ? (
          <p className="qna-empty">No room messages yet.</p>
        ) : null}
      </div>
    </section>
  );
}
