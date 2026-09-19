import { describe, expect, it } from "vitest";
import type { AudienceEventEnvelope } from "@openround/contracts";
import {
  applyAudienceRealtimeEvent,
  audienceReplayNeedsAuthoritativeSync,
  audienceRealtimeBatchDelta,
  createInFlightRefreshCoalescer,
  enqueueAudienceRealtimeUpdate,
  mergeAudienceSync,
  type AudienceRealtimeBatch,
  type AudienceSync,
} from "./audience-panel";

const base: AudienceSync = {
  settings: {
    signalsEnabled: true,
    chatEnabled: true,
    chatIdentityMode: "alias_public",
    slowModeSeconds: 5,
    presenterFeedMode: "pinned",
  },
  settingsAudienceSeq: 1,
  chatSyncAudienceSeq: 1,
  capabilities: { audiencePulse: true, roomChat: true },
  summary: {
    audienceSeq: 1,
    contextKey: "lobby",
    connectedParticipants: 1,
    disconnectedParticipants: 0,
    answeredParticipants: 0,
    uniqueSignalers: 1,
    signalCounts: null,
    signalsLastMinute: 1,
    messagesLastMinute: 0,
    uniqueChatContributors: 0,
    moderationCount: 0,
    reportedCount: 0,
    mySignal: "unsure",
  },
  chat: {
    messages: [],
    nextCursor: null,
    settings: {
      signalsEnabled: true,
      chatEnabled: true,
      chatIdentityMode: "alias_public",
      slowModeSeconds: 5,
      presenterFeedMode: "pinned",
    },
    audienceSeq: 1,
  },
};

function envelope(type: string, payload: unknown, audienceSeq = 2): AudienceEventEnvelope {
  return {
    eventId: crypto.randomUUID(),
    sessionId: "8dce12bc-efb8-4b9c-9a60-2cf8e846fc33",
    audienceSeq,
    schemaVersion: 1,
    serverTime: new Date().toISOString(),
    type,
    payload,
  };
}

describe("applyAudienceRealtimeEvent", () => {
  it("coalesces a reopen refresh with the successful initial load", async () => {
    const coalescer = createInFlightRefreshCoalescer<string>();
    let resolveInitial!: (value: string) => void;
    const initialResult = new Promise<string>((resolve) => {
      resolveInitial = resolve;
    });
    const initial = coalescer.run("session:token", () => initialResult);
    let redundantRequestStarted = false;
    const reopened = coalescer.run("session:token", async () => {
      redundantRequestStarted = true;
      throw new Error("redundant refresh failed");
    });

    expect(reopened).toBe(initial);
    resolveInitial("loaded");
    await expect(Promise.all([initial, reopened])).resolves.toEqual(["loaded", "loaded"]);
    expect(redundantRequestStarted).toBe(false);
  });

  it("runs one trailing refresh when a gap arrives during an in-flight load", async () => {
    const coalescer = createInFlightRefreshCoalescer<string>();
    let resolveInitial!: (value: string) => void;
    const initial = coalescer.run(
      "session:token",
      () =>
        new Promise<string>((resolve) => {
          resolveInitial = resolve;
        }),
    );
    let trailingRequests = 0;
    const trailing = coalescer.run(
      "session:token",
      async () => {
        trailingRequests += 1;
        return "caught up";
      },
      true,
    );

    expect(trailing).not.toBe(initial);
    expect(coalescer.isActive("session:token")).toBe(true);
    expect(trailingRequests).toBe(0);
    resolveInitial("initial");
    await expect(initial).resolves.toBe("initial");
    await expect(trailing).resolves.toBe("caught up");
    expect(trailingRequests).toBe(1);
    expect(coalescer.isActive("session:token")).toBe(false);
  });

  it("inserts a projected chat message without requesting a full synchronization", () => {
    const message = {
      id: "1181753c-0371-4a62-9863-13f20bcefc2b",
      audienceSeq: 2,
      body: "Could we see another example?",
      status: "published" as const,
      author: { displayName: "Anonymous", kind: "participant" as const, mine: false },
      replyToMessageId: null,
      pinned: false,
      reactions: { like: 0, love: 0, insight: 0, laugh: 0 },
      myReaction: null,
      createdAt: new Date().toISOString(),
    };

    const updated = applyAudienceRealtimeEvent(
      base,
      envelope("chat.message.created", { messageId: message.id, message }),
    );

    expect(updated.chat.messages).toEqual([message]);
    expect(updated.chat.audienceSeq).toBe(2);
  });

  it("preserves chat and aggregate events when React batches parent updates", () => {
    const message = {
      id: "1181753c-0371-4a62-9863-13f20bcefc2b",
      audienceSeq: 2,
      body: "Could we see another example?",
      status: "published" as const,
      author: { displayName: "Anonymous", kind: "participant" as const, mine: false },
      replyToMessageId: null,
      pinned: false,
      reactions: { like: 0, love: 0, insight: 0, laugh: 0 },
      myReaction: null,
      createdAt: new Date().toISOString(),
    };
    const created = envelope("chat.message.created", { messageId: message.id, message });
    const summary = envelope("audience.summary.updated", {
      summary: {
        ...base.summary,
        audienceSeq: 2,
        messagesLastMinute: 1,
        uniqueChatContributors: 1,
      },
    });
    const first = enqueueAudienceRealtimeUpdate(null, { gap: false, envelope: created });
    const batch = enqueueAudienceRealtimeUpdate(first, { gap: false, envelope: summary });
    const projected = batch.updates.reduce(
      (current, update) => applyAudienceRealtimeEvent(current, update.envelope),
      base,
    );

    expect(batch.updates.map((update) => update.envelope.type)).toEqual([
      "chat.message.created",
      "audience.summary.updated",
    ]);
    expect(projected.chat.messages).toEqual([message]);
    expect(projected.summary.messagesLastMinute).toBe(1);
  });

  it("merges sync-only gap messages with a newer realtime chat projection", () => {
    const realtimeMessage = {
      id: "1181753c-0371-4a62-9863-13f20bcefc2b",
      audienceSeq: 11,
      body: "This arrived after gap recovery started.",
      status: "published" as const,
      author: { displayName: "Anonymous", kind: "participant" as const, mine: false },
      replyToMessageId: null,
      pinned: false,
      reactions: { like: 0, love: 0, insight: 0, laugh: 0 },
      myReaction: null,
      createdAt: "2026-09-18T20:00:11.000Z",
    };
    const created = envelope(
      "chat.message.created",
      {
        messageId: realtimeMessage.id,
        message: realtimeMessage,
      },
      11,
    );
    const projected = applyAudienceRealtimeEvent(base, created);
    const missedMessage = {
      id: "36cf77f5-34d3-4cd0-9cef-792a09548b47",
      audienceSeq: 8,
      body: "This was only present in the gap-recovery sync.",
      status: "published" as const,
      author: { displayName: "Anonymous", kind: "participant" as const, mine: false },
      replyToMessageId: null,
      pinned: false,
      reactions: { like: 0, love: 0, insight: 0, laugh: 0 },
      myReaction: null,
      createdAt: "2026-09-18T20:00:08.000Z",
    };
    const synchronized: AudienceSync = {
      ...base,
      settings: { ...base.settings, slowModeSeconds: 30 },
      settingsAudienceSeq: 10,
      summary: { ...base.summary, audienceSeq: 10 },
      chat: {
        ...base.chat,
        audienceSeq: 10,
        messages: [missedMessage],
        settings: { ...base.chat.settings, slowModeSeconds: 30 },
      },
    };

    const merged = mergeAudienceSync(projected, synchronized, { replay: [created] });

    expect(merged.chat.audienceSeq).toBe(11);
    expect(merged.chat.messages).toEqual([realtimeMessage, { ...missedMessage, audienceSeq: 10 }]);
    expect(merged.settings.slowModeSeconds).toBe(30);
    expect(merged.settingsAudienceSeq).toBe(10);
    expect(merged.chat.settings).toEqual(merged.settings);
  });

  it("keeps the newest per-message projection while merging gap recovery", () => {
    const staleMessage = {
      id: "1181753c-0371-4a62-9863-13f20bcefc2b",
      audienceSeq: 8,
      body: "Before moderation",
      status: "published" as const,
      author: { displayName: "Anonymous", kind: "participant" as const, mine: false },
      replyToMessageId: null,
      pinned: false,
      reactions: { like: 0, love: 0, insight: 0, laugh: 0 },
      myReaction: null,
      createdAt: "2026-09-18T20:00:08.000Z",
    };
    const updated = envelope(
      "chat.message.removed",
      {
        messageId: staleMessage.id,
        message: {
          ...staleMessage,
          audienceSeq: 11,
          body: "Message removed",
          status: "removed",
        },
      },
      11,
    );
    const projected = applyAudienceRealtimeEvent(base, updated);
    const synchronized: AudienceSync = {
      ...base,
      summary: { ...base.summary, audienceSeq: 10 },
      chat: { ...base.chat, audienceSeq: 10, messages: [staleMessage] },
    };

    expect(
      mergeAudienceSync(projected, synchronized, { replay: [updated] }).chat.messages[0],
    ).toMatchObject({
      audienceSeq: 11,
      status: "removed",
    });
  });

  it("treats absent presenter messages as authoritative while retaining later projections", () => {
    const formerlyPinned = {
      id: "1181753c-0371-4a62-9863-13f20bcefc2b",
      audienceSeq: 9,
      body: "This message was unpinned during the gap.",
      status: "published" as const,
      author: { displayName: "Anonymous", kind: "participant" as const, mine: false },
      replyToMessageId: null,
      pinned: true,
      reactions: { like: 0, love: 0, insight: 0, laugh: 0 },
      myReaction: null,
      createdAt: "2026-09-18T20:00:09.000Z",
    };
    const hydrated = mergeAudienceSync(null, {
      ...base,
      summary: { ...base.summary, audienceSeq: 9 },
      chat: { ...base.chat, audienceSeq: 9, messages: [formerlyPinned] },
    });
    const laterPinned = {
      ...formerlyPinned,
      id: "36cf77f5-34d3-4cd0-9cef-792a09548b47",
      audienceSeq: 12,
      body: "This pinned message arrived after gap recovery started.",
      createdAt: "2026-09-18T20:00:12.000Z",
    };
    const created = envelope(
      "chat.message.created",
      { messageId: laterPinned.id, message: laterPinned },
      12,
    );
    const projected = applyAudienceRealtimeEvent(hydrated, created);
    const synchronized: AudienceSync = {
      ...base,
      settingsAudienceSeq: 11,
      chatSyncAudienceSeq: 11,
      summary: { ...base.summary, audienceSeq: 11 },
      chat: { ...base.chat, audienceSeq: 11, messages: [] },
    };

    const merged = mergeAudienceSync(projected, synchronized, { replay: [created] });

    expect(merged.chat.messages).toEqual([laterPinned]);
    expect(merged.chat.audienceSeq).toBe(12);
  });

  it("replays a presenter-only null projection over a stale pre-unpin sync", () => {
    const pinnedMessage = {
      id: "1181753c-0371-4a62-9863-13f20bcefc2b",
      audienceSeq: 10,
      body: "This was pinned when the request started.",
      status: "published" as const,
      author: { displayName: "Anonymous", kind: "participant" as const, mine: false },
      replyToMessageId: null,
      pinned: true,
      reactions: { like: 0, love: 0, insight: 0, laugh: 0 },
      myReaction: null,
      createdAt: "2026-09-18T20:00:10.000Z",
    };
    const staleSync: AudienceSync = {
      ...base,
      summary: { ...base.summary, audienceSeq: 10 },
      chat: { ...base.chat, audienceSeq: 10, messages: [pinnedMessage] },
    };
    const unpinned = envelope(
      "chat.message.pinned",
      { messageId: pinnedMessage.id, message: null },
      11,
    );

    const merged = mergeAudienceSync(null, staleSync, { replay: [unpinned] });

    expect(merged.chat.messages).toEqual([]);
    expect(merged.chat.audienceSeq).toBe(11);
  });

  it("keeps newer realtime settings independently from the chat page watermark", () => {
    const settingsUpdate = envelope(
      "audience.settings.updated",
      { settings: { ...base.settings, slowModeSeconds: 30 } },
      11,
    );
    const current = applyAudienceRealtimeEvent(base, settingsUpdate);
    const synchronized: AudienceSync = {
      ...base,
      settings: { ...base.settings, slowModeSeconds: 15 },
      settingsAudienceSeq: 10,
      chat: {
        ...base.chat,
        audienceSeq: 10,
        settings: { ...base.chat.settings, slowModeSeconds: 15 },
      },
    };

    const merged = mergeAudienceSync(current, synchronized, { replay: [settingsUpdate] });

    expect(merged.settings.slowModeSeconds).toBe(30);
    expect(merged.settingsAudienceSeq).toBe(11);
    expect(merged.chat.settings).toEqual(merged.settings);
  });

  it("uses projection freshness when merging missed and realtime reactions", () => {
    const target = {
      id: "1181753c-0371-4a62-9863-13f20bcefc2b",
      audienceSeq: 1,
      body: "React to this",
      status: "published" as const,
      author: { displayName: "Anonymous", kind: "participant" as const, mine: false },
      replyToMessageId: null,
      pinned: false,
      reactions: { like: 0, love: 0, insight: 0, laugh: 0 },
      myReaction: null,
      createdAt: "2026-09-18T20:00:01.000Z",
    };
    const hydrated = mergeAudienceSync(null, {
      ...base,
      chat: { ...base.chat, messages: [target] },
    });
    const newerMessage = {
      ...target,
      id: "36cf77f5-34d3-4cd0-9cef-792a09548b47",
      body: "A newer unrelated message",
      audienceSeq: 11,
      createdAt: "2026-09-18T20:00:11.000Z",
    };
    const newerMessageCreated = envelope(
      "chat.message.created",
      { messageId: newerMessage.id, message: newerMessage },
      11,
    );
    const current = applyAudienceRealtimeEvent(hydrated, newerMessageCreated);
    const missedReaction = { ...target, reactions: { ...target.reactions, like: 1 } };
    const gapSync: AudienceSync = {
      ...base,
      settingsAudienceSeq: 10,
      summary: { ...base.summary, audienceSeq: 10 },
      chat: { ...base.chat, audienceSeq: 10, messages: [missedReaction] },
    };

    const recovered = mergeAudienceSync(current, gapSync, { replay: [newerMessageCreated] });
    const recoveredTarget = recovered.chat.messages.find((message) => message.id === target.id);
    expect(recoveredTarget).toMatchObject({ audienceSeq: 10, reactions: { like: 1 } });
    expect(recovered.chat.messages.some((message) => message.id === newerMessage.id)).toBe(true);

    const reactionUpdated = envelope(
      "chat.reaction.updated",
      {
        messageId: target.id,
        message: { ...target, reactions: { ...target.reactions, like: 2 } },
      },
      11,
    );
    const realtimeReaction = applyAudienceRealtimeEvent(hydrated, reactionUpdated);
    const realtimeWins = mergeAudienceSync(realtimeReaction, gapSync, {
      replay: [reactionUpdated],
    });
    expect(realtimeWins.chat.messages.find((message) => message.id === target.id)).toMatchObject({
      audienceSeq: 11,
      reactions: { like: 2 },
    });
  });

  it("ignores delayed projections older than synchronized watermarks", () => {
    const participantId = "9c7487dc-0990-43b4-8ca9-d49dd14fd28e";
    const message = {
      id: "1181753c-0371-4a62-9863-13f20bcefc2b",
      audienceSeq: 2,
      body: "Current body",
      status: "published" as const,
      author: { displayName: "Anonymous", kind: "participant" as const, mine: false },
      replyToMessageId: null,
      pinned: false,
      reactions: { like: 1, love: 0, insight: 0, laugh: 0 },
      myReaction: null,
      createdAt: "2026-09-18T20:00:02.000Z",
    };
    const synchronized = mergeAudienceSync(null, {
      ...base,
      settings: { ...base.settings, slowModeSeconds: 30 },
      settingsAudienceSeq: 10,
      chatSyncAudienceSeq: 10,
      summary: {
        ...base.summary,
        audienceSeq: 10,
        messagesLastMinute: 1,
        participants: [
          {
            participantId,
            nickname: "Bright Badger",
            connected: true,
            answered: false,
            currentSignal: "unsure",
            lastSignalAt: "2026-09-18T20:00:10.000Z",
            lastActivityAt: "2026-09-18T20:00:10.000Z",
            chatMessageCount: 1,
            mutedUntil: null,
            banned: false,
          },
        ],
      },
      chat: {
        ...base.chat,
        audienceSeq: 10,
        messages: [message],
        settings: { ...base.chat.settings, slowModeSeconds: 30 },
      },
    });

    const delayedChat = envelope(
      "chat.reaction.updated",
      {
        messageId: message.id,
        message: { ...message, reactions: { ...message.reactions, like: 0 } },
      },
      8,
    );
    const delayedSettings = envelope(
      "audience.settings.updated",
      { settings: { ...base.settings, slowModeSeconds: 5 } },
      8,
    );
    const delayedSummary = envelope(
      "audience.summary.updated",
      { summary: { ...base.summary, audienceSeq: 8 } },
      8,
    );
    const delayedSignal = envelope(
      "audience.signal.updated",
      {
        participantId,
        contextKey: base.summary.contextKey,
        signal: "got_it",
        updatedAt: "2026-09-18T20:00:08.000Z",
      },
      8,
    );
    const delayedModeration = envelope(
      "audience.moderation.updated",
      { participantId, mutedUntil: null, banned: true },
      8,
    );

    for (const delayed of [
      delayedChat,
      delayedSettings,
      delayedSummary,
      delayedSignal,
      delayedModeration,
    ]) {
      expect(applyAudienceRealtimeEvent(synchronized, delayed)).toBe(synchronized);
    }
  });

  it("accepts an aggregate payload newer than its asynchronously emitted envelope", () => {
    const current: AudienceSync = {
      ...base,
      summary: { ...base.summary, audienceSeq: 10, messagesLastMinute: 1 },
    };
    const asynchronousSummary = envelope(
      "audience.summary.updated",
      {
        summary: { ...base.summary, audienceSeq: 11, messagesLastMinute: 2 },
      },
      9,
    );

    const updated = applyAudienceRealtimeEvent(current, asynchronousSummary);

    expect(updated.summary.audienceSeq).toBe(11);
    expect(updated.summary.messagesLastMinute).toBe(2);
  });

  it("uses an equal-sequence sync for context and session-count transitions", () => {
    const current: AudienceSync = {
      ...base,
      summary: {
        ...base.summary,
        audienceSeq: 5,
        contextKey: "round:old",
        connectedParticipants: 1,
        answeredParticipants: 1,
      },
    };
    const synchronized: AudienceSync = {
      ...base,
      summary: {
        ...base.summary,
        audienceSeq: 5,
        contextKey: "round:new",
        connectedParticipants: 3,
        answeredParticipants: 0,
        uniqueSignalers: 0,
        signalCounts: null,
      },
      chat: { ...base.chat, audienceSeq: 5 },
    };

    const merged = mergeAudienceSync(current, synchronized);

    expect(merged.summary).toMatchObject({
      audienceSeq: 5,
      contextKey: "round:new",
      connectedParticipants: 3,
      answeredParticipants: 0,
    });
    const delayedSummary = envelope("audience.summary.updated", { summary: current.summary }, 5);
    const delayedSignal = envelope(
      "audience.signal.updated",
      {
        participantId: "9c7487dc-0990-43b4-8ca9-d49dd14fd28e",
        contextKey: "round:old",
        signal: "got_it",
        updatedAt: "2026-09-18T20:00:05.000Z",
      },
      5,
    );
    expect(applyAudienceRealtimeEvent(merged, delayedSummary)).toBe(merged);
    expect(applyAudienceRealtimeEvent(merged, delayedSignal)).toBe(merged);
  });

  it("keeps equal-sequence direct participant projections across a racing sync", () => {
    const participantId = "9c7487dc-0990-43b4-8ca9-d49dd14fd28e";
    const participant = {
      participantId,
      nickname: "Bright Badger",
      connected: true,
      answered: false,
      currentSignal: "unsure" as const,
      lastSignalAt: "2026-09-18T20:00:09.000Z",
      lastActivityAt: "2026-09-18T20:00:09.000Z",
      chatMessageCount: 0,
      mutedUntil: null,
      banned: false,
    };
    const before: AudienceSync = {
      ...base,
      summary: {
        ...base.summary,
        audienceSeq: 9,
        signalCounts: { got_it: 0, unsure: 1, need_example: 0, too_fast: 0 },
        participants: [participant],
      },
    };
    const staleSync: AudienceSync = {
      ...before,
      summary: { ...before.summary, audienceSeq: 10 },
      chat: { ...before.chat, audienceSeq: 10 },
    };
    const signal = envelope(
      "audience.signal.updated",
      {
        participantId,
        contextKey: before.summary.contextKey,
        signal: "got_it",
        updatedAt: "2026-09-18T20:00:10.000Z",
      },
      10,
    );

    const eventThenSync = mergeAudienceSync(applyAudienceRealtimeEvent(before, signal), staleSync, {
      replay: [signal],
    });
    const syncThenEvent = applyAudienceRealtimeEvent(mergeAudienceSync(before, staleSync), signal);

    for (const result of [eventThenSync, syncThenEvent]) {
      expect(result.summary.participants?.[0]).toMatchObject({
        currentSignal: "got_it",
        lastSignalAt: "2026-09-18T20:00:10.000Z",
      });
      expect(result.summary.signalCounts).toEqual({
        got_it: 1,
        unsure: 0,
        need_example: 0,
        too_fast: 0,
      });
    }

    const moderation = envelope(
      "audience.moderation.updated",
      { participantId, mutedUntil: null, banned: true },
      10,
    );
    expect(
      applyAudienceRealtimeEvent(mergeAudienceSync(before, staleSync), moderation).summary
        .participants?.[0],
    ).toMatchObject({ banned: true });
  });

  it("keeps direct private overlays across an older-triggered equal-sequence summary", () => {
    const participantId = "9c7487dc-0990-43b4-8ca9-d49dd14fd28e";
    const participant = {
      participantId,
      nickname: "Bright Badger",
      connected: true,
      answered: false,
      currentSignal: "unsure" as const,
      lastSignalAt: "2026-09-18T20:00:09.000Z",
      lastActivityAt: "2026-09-18T20:00:09.000Z",
      chatMessageCount: 0,
      mutedUntil: null,
      banned: false,
    };
    const current: AudienceSync = {
      ...base,
      summary: {
        ...base.summary,
        audienceSeq: 9,
        signalCounts: { got_it: 0, unsure: 1, need_example: 0, too_fast: 0 },
        participants: [participant],
      },
    };
    const signal = envelope(
      "audience.signal.updated",
      {
        participantId,
        contextKey: current.summary.contextKey,
        signal: "got_it",
        updatedAt: "2026-09-18T20:00:10.000Z",
      },
      10,
    );
    const moderation = envelope(
      "audience.moderation.updated",
      { participantId, mutedUntil: null, banned: true },
      10,
    );
    const staleSummary = envelope(
      "audience.summary.updated",
      {
        summary: {
          ...current.summary,
          audienceSeq: 10,
        },
      },
      9,
    );

    const signaled = applyAudienceRealtimeEvent(
      applyAudienceRealtimeEvent(current, signal),
      staleSummary,
    );
    const moderated = applyAudienceRealtimeEvent(
      applyAudienceRealtimeEvent(current, moderation),
      staleSummary,
    );

    expect(signaled.summary.participants?.[0]).toMatchObject({
      currentSignal: "got_it",
      lastSignalAt: "2026-09-18T20:00:10.000Z",
    });
    expect(signaled.summary.signalCounts).toEqual({
      got_it: 1,
      unsure: 0,
      need_example: 0,
      too_fast: 0,
    });
    expect(moderated.summary.participants?.[0]).toMatchObject({ banned: true });
    expect(signaled.privateProjectionOverlays).toHaveLength(1);
    expect(moderated.privateProjectionOverlays).toHaveLength(1);

    const coveringSummary = envelope(
      "audience.summary.updated",
      { summary: signaled.summary },
      signal.audienceSeq,
    );
    expect(applyAudienceRealtimeEvent(signaled, coveringSummary).privateProjectionOverlays).toEqual(
      [],
    );
    expect(mergeAudienceSync(signaled, signaled).privateProjectionOverlays).toEqual([]);
  });

  it("retains private projections for a full-room signal burst", () => {
    const participants = Array.from({ length: 250 }, (_, index) => ({
      participantId: crypto.randomUUID(),
      nickname: `Participant ${index + 1}`,
      connected: true,
      answered: false,
      currentSignal: null,
      lastSignalAt: null,
      lastActivityAt: null,
      chatMessageCount: 0,
      mutedUntil: null,
      banned: false,
    }));
    let current: AudienceSync = {
      ...base,
      summary: {
        ...base.summary,
        connectedParticipants: participants.length,
        uniqueSignalers: 0,
        signalCounts: { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 },
        signalsLastMinute: 0,
        participants,
      },
    };

    participants.forEach((participant, index) => {
      current = applyAudienceRealtimeEvent(
        current,
        envelope(
          "audience.signal.updated",
          {
            participantId: participant.participantId,
            contextKey: current.summary.contextKey,
            signal: "got_it",
            updatedAt: new Date(Date.UTC(2026, 8, 18, 20, 0, 0, index)).toISOString(),
          },
          index + 2,
        ),
      );
    });

    const staleAggregate = envelope(
      "audience.summary.updated",
      {
        summary: {
          ...base.summary,
          audienceSeq: current.summary.audienceSeq,
          connectedParticipants: participants.length,
          uniqueSignalers: 0,
          signalCounts: { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 },
          signalsLastMinute: 0,
          participants,
        },
      },
      base.summary.audienceSeq,
    );
    current = applyAudienceRealtimeEvent(current, staleAggregate);

    expect(current.privateProjectionOverlays).toHaveLength(250);
    expect(
      current.summary.participants?.every((participant) => participant.currentSignal === "got_it"),
    ).toBe(true);
    expect(current.summary.signalCounts).toEqual({
      got_it: 250,
      unsure: 0,
      need_example: 0,
      too_fast: 0,
    });
    expect(current.summary.uniqueSignalers).toBe(250);
  });

  it("defers an incomplete private projection to one authoritative follow-up sync", () => {
    const participantId = "9c7487dc-0990-43b4-8ca9-d49dd14fd28e";
    const synchronized: AudienceSync = {
      ...base,
      summary: {
        ...base.summary,
        audienceSeq: 10,
        uniqueSignalers: 0,
        signalCounts: { got_it: 0, unsure: 0, need_example: 0, too_fast: 0 },
        participants: [],
      },
      chat: { ...base.chat, audienceSeq: 10 },
    };
    const signal = envelope(
      "audience.signal.updated",
      {
        participantId,
        contextKey: synchronized.summary.contextKey,
        signal: "got_it",
        updatedAt: "2026-09-18T20:00:11.000Z",
      },
      11,
    );

    const incomplete = mergeAudienceSync(null, synchronized, { replay: [signal] });

    expect(incomplete.summary.uniqueSignalers).toBe(0);
    expect(incomplete.summary.signalCounts?.got_it).toBe(0);
    expect(audienceReplayNeedsAuthoritativeSync(incomplete, [signal])).toBe(true);

    const aggregate = envelope(
      "audience.summary.updated",
      {
        summary: {
          ...synchronized.summary,
          audienceSeq: 11,
          uniqueSignalers: 1,
          signalCounts: { got_it: 1, unsure: 0, need_example: 0, too_fast: 0 },
          participants: [
            {
              participantId,
              nickname: "Bright Badger",
              connected: true,
              answered: false,
              currentSignal: "got_it",
              lastSignalAt: "2026-09-18T20:00:11.000Z",
              lastActivityAt: "2026-09-18T20:00:11.000Z",
              chatMessageCount: 0,
              mutedUntil: null,
              banned: false,
            },
          ],
        },
      },
      11,
    );
    const complete = mergeAudienceSync(null, synchronized, { replay: [signal, aggregate] });
    expect(audienceReplayNeedsAuthoritativeSync(complete, [signal, aggregate])).toBe(false);
  });

  it("does not let a later private projection mask an earlier missing participant", () => {
    const missingParticipantId = "9c7487dc-0990-43b4-8ca9-d49dd14fd28e";
    const presentParticipantId = "f046e21a-a23f-4a68-a9f2-fbbd1b54a82b";
    const synchronized: AudienceSync = {
      ...base,
      summary: {
        ...base.summary,
        audienceSeq: 10,
        signalCounts: { got_it: 0, unsure: 1, need_example: 0, too_fast: 0 },
        participants: [
          {
            participantId: presentParticipantId,
            nickname: "Calm Coyote",
            connected: true,
            answered: false,
            currentSignal: "unsure",
            lastSignalAt: "2026-09-18T20:00:10.000Z",
            lastActivityAt: "2026-09-18T20:00:10.000Z",
            chatMessageCount: 0,
            mutedUntil: null,
            banned: false,
          },
        ],
      },
      chat: { ...base.chat, audienceSeq: 10 },
    };
    const missingSignal = envelope(
      "audience.signal.updated",
      {
        participantId: missingParticipantId,
        contextKey: synchronized.summary.contextKey,
        signal: "got_it",
        updatedAt: "2026-09-18T20:00:11.000Z",
      },
      11,
    );
    const laterSignal = envelope(
      "audience.signal.updated",
      {
        participantId: presentParticipantId,
        contextKey: synchronized.summary.contextKey,
        signal: "got_it",
        updatedAt: "2026-09-18T20:00:12.000Z",
      },
      12,
    );

    const merged = mergeAudienceSync(null, synchronized, {
      replay: [missingSignal, laterSignal],
    });

    expect(merged.summary.audienceSeq).toBe(12);
    expect(audienceReplayNeedsAuthoritativeSync(merged, [missingSignal, laterSignal])).toBe(true);
  });

  it("replays per-participant fields over a newer non-atomic aggregate watermark", () => {
    const participantId = "9c7487dc-0990-43b4-8ca9-d49dd14fd28e";
    const synchronized: AudienceSync = {
      ...base,
      summary: {
        ...base.summary,
        audienceSeq: 10,
        signalCounts: { got_it: 0, unsure: 1, need_example: 0, too_fast: 0 },
        participants: [
          {
            participantId,
            nickname: "Bright Badger",
            connected: true,
            answered: false,
            currentSignal: "unsure",
            lastSignalAt: "2026-09-18T20:00:08.000Z",
            lastActivityAt: "2026-09-18T20:00:08.000Z",
            chatMessageCount: 0,
            mutedUntil: null,
            banned: false,
          },
        ],
      },
      chat: { ...base.chat, audienceSeq: 10 },
    };
    const signal = envelope(
      "audience.signal.updated",
      {
        participantId,
        contextKey: synchronized.summary.contextKey,
        signal: "got_it",
        updatedAt: "2026-09-18T20:00:09.000Z",
      },
      8,
    );
    const moderation = envelope(
      "audience.moderation.updated",
      { participantId, mutedUntil: null, banned: true },
      9,
    );

    const merged = mergeAudienceSync(null, synchronized, { replay: [signal, moderation] });

    expect(merged.summary.participants?.[0]).toMatchObject({
      currentSignal: "got_it",
      lastSignalAt: "2026-09-18T20:00:09.000Z",
      banned: true,
    });
    expect(merged.summary.signalCounts).toEqual({
      got_it: 1,
      unsure: 0,
      need_example: 0,
      too_fast: 0,
    });
    expect(merged.summary.audienceSeq).toBe(10);
  });

  it("detects only unprocessed bounded-queue overflow as a synchronization gap", () => {
    let batch: AudienceRealtimeBatch | null = null;
    for (let index = 0; index < 65; index += 1) {
      batch = enqueueAudienceRealtimeUpdate(batch, {
        gap: false,
        envelope: envelope("audience.summary.updated", {
          summary: { ...base.summary, audienceSeq: index + 2 },
        }),
      });
    }

    expect(batch!.updates).toHaveLength(64);
    expect(batch!.updates[0]?.ordinal).toBe(2);
    expect(audienceRealtimeBatchDelta(batch!, 0)).toMatchObject({
      overflow: true,
      lastProcessedOrdinal: 65,
    });
    expect(audienceRealtimeBatchDelta(batch!, 64)).toMatchObject({
      overflow: false,
      lastProcessedOrdinal: 65,
    });
  });

  it("preserves a participant's private signal when applying a public aggregate", () => {
    const updated = applyAudienceRealtimeEvent(
      base,
      envelope("audience.summary.updated", {
        summary: { ...base.summary, audienceSeq: 2, mySignal: undefined },
      }),
    );

    expect(updated.summary.mySignal).toBe("unsure");
    expect(updated.summary.audienceSeq).toBe(2);
  });
});
