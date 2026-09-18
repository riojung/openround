import { describe, expect, it } from "vitest";
import type { AudienceEventEnvelope } from "@openround/contracts";
import { applyAudienceRealtimeEvent, type AudienceSync } from "./audience-panel";

const base: AudienceSync = {
  settings: {
    signalsEnabled: true,
    chatEnabled: true,
    chatIdentityMode: "alias_public",
    slowModeSeconds: 5,
    presenterFeedMode: "pinned",
  },
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

function envelope(type: string, payload: unknown): AudienceEventEnvelope {
  return {
    eventId: crypto.randomUUID(),
    sessionId: "8dce12bc-efb8-4b9c-9a60-2cf8e846fc33",
    audienceSeq: 2,
    schemaVersion: 1,
    serverTime: new Date().toISOString(),
    type,
    payload,
  };
}

describe("applyAudienceRealtimeEvent", () => {
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
