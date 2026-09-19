import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import type { Report, SessionSnapshot } from "@openround/contracts";
import { MemoryRepository } from "@openround/db";
import { buildApp } from "../src/app.js";
import { ConfigSchema } from "../src/config.js";
import { MemorySessionCache } from "../src/cache.js";

let app: FastifyInstance | undefined;

async function signIn(target: FastifyInstance, email: string) {
  const magic = await target.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await target.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  const setCookie = verified.headers["set-cookie"]!;
  const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  const me = await target.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  return {
    cookie,
    creator: me.json<{ creator: { userId: string; workspaceId: string } }>().creator,
  };
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe("creator to report journey", () => {
  it("publishes, hosts, answers idempotently, and produces a report", async () => {
    const repository = new MemoryRepository();
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;

    const magic = await app.inject({
      method: "POST",
      url: "/v1/auth/magic-link",
      payload: {
        email: "facilitator@example.com",
        segment: "education",
        acceptPolicies: true,
      },
    });
    expect(magic.statusCode).toBe(202);
    const debugUrl = magic.json<{ debugUrl: string }>().debugUrl;
    const token = new URL(debugUrl).searchParams.get("token")!;
    const verified = await app.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
    expect(verified.statusCode).toBe(302);
    const setCookie = verified.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;

    const freeAccount = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie },
    });
    const creator = freeAccount.json<{
      creator: { workspaceId: string };
      entitlements: { brandTheme: boolean };
      brandTheme: unknown;
    }>();
    expect(creator).toMatchObject({ entitlements: { brandTheme: false }, brandTheme: null });

    const invited = await app.inject({
      method: "POST",
      url: "/v1/workspace/invitations",
      headers: { cookie },
      payload: { email: "collaborator@example.com", role: "editor" },
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.body).not.toContain("tokenHash");
    const invitation = invited.json<{
      invitation: { id: string };
      debugUrl: string;
    }>();
    const invitationToken = new URL(invitation.debugUrl).searchParams.get("token")!;
    const acceptedInvitation = await app.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      payload: { token: invitationToken, acceptPolicies: true },
    });
    expect(acceptedInvitation.statusCode).toBe(200);
    expect(acceptedInvitation.json()).toMatchObject({
      creator: {
        workspaceId: creator.creator.workspaceId,
        email: "collaborator@example.com",
        role: "editor",
      },
    });
    const collaboratorSetCookie = acceptedInvitation.headers["set-cookie"]!;
    const collaboratorCookie = (
      Array.isArray(collaboratorSetCookie) ? collaboratorSetCookie[0]! : collaboratorSetCookie
    ).split(";")[0]!;
    const memberList = await app.inject({
      method: "GET",
      url: "/v1/workspace/members",
      headers: { cookie },
    });
    expect(memberList.statusCode).toBe(200);
    expect(memberList.body).not.toContain("tokenHash");
    const collaborator = memberList
      .json<{ members: Array<{ userId: string; email: string; role: string }> }>()
      .members.find((member) => member.email === "collaborator@example.com")!;
    expect(collaborator.role).toBe("editor");
    const changedRole = await app.inject({
      method: "PATCH",
      url: `/v1/workspace/members/${collaborator.userId}`,
      headers: { cookie },
      payload: { role: "viewer" },
    });
    expect(changedRole.json()).toMatchObject({ member: { role: "viewer" } });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/quizzes",
          headers: { cookie: collaboratorCookie },
          payload: { title: "Viewer cannot create", description: "" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/workspace/members/${collaborator.userId}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/auth/me",
          headers: { cookie: collaboratorCookie },
        })
      ).statusCode,
    ).toBe(401);

    const freeTheme = await app.inject({
      method: "PUT",
      url: "/v1/account/theme",
      headers: { cookie },
      payload: {
        organizationName: "Northern Learning",
        primaryColor: "#0B2239",
        accentColor: "#087375",
      },
    });
    expect(freeTheme.statusCode).toBe(402);
    expect(freeTheme.json()).toMatchObject({ error: { code: "ENTITLEMENT_LIMIT" } });
    await repository.setPlan(creator.creator.workspaceId, "pro");
    const lowContrastTheme = await app.inject({
      method: "PUT",
      url: "/v1/account/theme",
      headers: { cookie },
      payload: {
        organizationName: "Northern Learning",
        primaryColor: "#FFFFFF",
        accentColor: "#FFFF00",
      },
    });
    expect(lowContrastTheme.statusCode).toBe(400);
    const savedTheme = await app.inject({
      method: "PUT",
      url: "/v1/account/theme",
      headers: { cookie },
      payload: {
        organizationName: "Northern Learning",
        primaryColor: "#0b2239",
        accentColor: "#087375",
      },
    });
    expect(savedTheme.statusCode).toBe(200);
    expect(savedTheme.json()).toMatchObject({
      theme: {
        organizationName: "Northern Learning",
        primaryColor: "#0B2239",
        accentColor: "#087375",
      },
    });
    await repository.setPlan(creator.creator.workspaceId, "free");

    const created = await app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Canadian geography", description: "A short check" },
    });
    expect(created.statusCode).toBe(201);
    const quizId = created.json<{ quiz: { id: string } }>().quiz.id;
    const correctChoiceId = randomUUID();
    const wrongChoiceId = randomUUID();
    const questionId = randomUUID();
    const draft = {
      title: "Canadian geography",
      description: "A short check",
      questions: [
        {
          id: questionId,
          type: "single_select",
          prompt: "What is the capital of Alberta?",
          choices: [
            { id: correctChoiceId, label: "Edmonton", isCorrect: true },
            { id: wrongChoiceId, label: "Calgary", isCorrect: false },
          ],
          timeLimitSeconds: 20,
          basePoints: 1_000,
          explanation: "Edmonton is Alberta's capital.",
          mediaId: null,
          mediaAlt: null,
        },
      ],
    };
    const updated = await app.inject({
      method: "PATCH",
      url: `/v1/quizzes/${quizId}`,
      headers: { cookie },
      payload: draft,
    });
    expect(updated.statusCode).toBe(200);
    const published = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${quizId}/publish`,
      headers: { cookie },
      payload: {},
    });
    expect(published.statusCode).toBe(200);

    const hosted = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { cookie },
      payload: {
        quizId,
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "friendly_only",
        },
      },
    });
    expect(hosted.statusCode).toBe(201);
    const session = hosted.json<{
      sessionId: string;
      code: string;
      hostToken: string;
      snapshot: SessionSnapshot;
    }>();
    expect(session.snapshot.brandTheme).toBeNull();

    const embedOriginsPreflight = await app.inject({
      method: "OPTIONS",
      url: "/v1/account/embed-origins",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "PUT",
      },
    });
    expect(embedOriginsPreflight.statusCode).toBe(204);
    expect(embedOriginsPreflight.headers["access-control-allow-methods"]).toContain("PUT");

    const embedOrigins = await app.inject({
      method: "PUT",
      url: "/v1/account/embed-origins",
      headers: { cookie },
      payload: {
        origins: ["https://lms.example.edu", "https://slides.example.org/"],
      },
    });
    expect(embedOrigins.statusCode).toBe(200);
    expect(embedOrigins.json()).toEqual({
      origins: ["https://lms.example.edu", "https://slides.example.org"],
    });

    const presenterCredentialResponse = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/staff`,
      headers: { cookie },
      payload: { role: "presenter", label: "Projector" },
    });
    expect(presenterCredentialResponse.statusCode).toBe(201);
    const presenterCredential = presenterCredentialResponse.json<{
      token: string;
      embedPolicyKey: string;
      embedAllowedOrigins: string[];
      credential: { id: string };
    }>();
    expect(presenterCredential.embedAllowedOrigins).toEqual([
      "https://lms.example.edu",
      "https://slides.example.org",
    ]);
    const embedPolicy = await app.inject({
      method: "GET",
      url: `/v1/embed/policies/${session.sessionId}/${presenterCredential.embedPolicyKey}`,
    });
    expect(embedPolicy.statusCode).toBe(200);
    expect(embedPolicy.json()).toMatchObject({
      sessionId: session.sessionId,
      allowedOrigins: ["https://lms.example.edu", "https://slides.example.org"],
    });
    const presenterSnapshot = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.sessionId}/snapshot?role=presenter`,
      headers: { authorization: `Bearer ${presenterCredential.token}` },
    });
    expect(presenterSnapshot.statusCode).toBe(200);
    const presenterCommand = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/commands`,
      headers: { authorization: `Bearer ${presenterCredential.token}` },
      payload: {
        commandId: randomUUID(),
        expectedVersion: session.snapshot.version,
        action: "start",
      },
    });
    expect(presenterCommand.statusCode).toBe(401);
    const staffList = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.sessionId}/staff`,
      headers: { cookie },
    });
    expect(staffList.statusCode).toBe(200);
    expect(staffList.body).not.toContain("tokenHash");
    expect(staffList.json()).toMatchObject({
      credentials: [{ id: presenterCredential.credential.id, role: "presenter" }],
    });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/sessions/${session.sessionId}/staff/${presenterCredential.credential.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/sessions/${session.sessionId}/snapshot?role=presenter`,
          headers: { authorization: `Bearer ${presenterCredential.token}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/embed/policies/${session.sessionId}/${presenterCredential.embedPolicyKey}`,
        })
      ).statusCode,
    ).toBe(404);

    const invalidAvatar = await app.inject({
      method: "POST",
      url: "/v1/sessions/join",
      payload: { code: session.code, nickname: "Invalid avatar", avatarId: "dragon" },
    });
    expect(invalidAvatar.statusCode).toBe(400);
    expect(invalidAvatar.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const joined = await app.inject({
      method: "POST",
      url: "/v1/sessions/join",
      payload: { code: session.code, nickname: "Ignored in friendly mode", avatarId: "robot" },
    });
    expect(joined.statusCode).toBe(201);
    const participant = joined.json<{ participantToken: string; snapshot: SessionSnapshot }>();
    expect(participant.snapshot.participants[0]?.nickname).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(participant.snapshot.participants[0]?.avatarId).toBe("robot");
    expect(participant.snapshot.experienceTheme).toMatchObject({
      preset: { id: "focus", version: 1 },
      category: "general",
    });

    const presets = await app.inject({ method: "GET", url: "/v1/experience-presets" });
    expect(presets.statusCode).toBe(200);
    expect(presets.json<{ presets: unknown[] }>().presets).toHaveLength(6);
    const defaultInteractions = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.sessionId}/interactions/settings`,
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(defaultInteractions.json()).toMatchObject({
      signalsEnabled: true,
      chatEnabled: false,
      slowModeSeconds: 5,
    });
    const blockedChat = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/chat/messages`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
      payload: { body: "Can anyone see this?", idempotencyKey: randomUUID() },
    });
    expect(blockedChat.statusCode).toBe(409);
    expect(blockedChat.json()).toMatchObject({ error: { code: "CHAT_DISABLED" } });
    const interactionUpdateKey = randomUUID();
    const enabledInteractions = await app.inject({
      method: "PATCH",
      url: `/v1/sessions/${session.sessionId}/interactions/settings`,
      headers: {
        authorization: `Bearer ${session.hostToken}`,
        "x-idempotency-key": interactionUpdateKey,
      },
      payload: { chatEnabled: true, chatIdentityMode: "alias_private" },
    });
    expect(enabledInteractions.statusCode).toBe(200);
    expect(enabledInteractions.json()).toMatchObject({
      chatEnabled: true,
      chatIdentityMode: "alias_private",
    });
    const pulse = await app.inject({
      method: "PUT",
      url: `/v1/sessions/${session.sessionId}/signals/current`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
      payload: { signal: "need_example", idempotencyKey: randomUUID() },
    });
    expect(pulse.statusCode).toBe(200);
    expect(pulse.json()).toMatchObject({ contextKey: "lobby", signal: "need_example" });
    const chatKey = randomUUID();
    const chatResponse = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/chat/messages`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
      payload: { body: "<b>I need</b> a worked example", idempotencyKey: chatKey },
    });
    expect(chatResponse.statusCode).toBe(201);
    const chatMessage = chatResponse.json<{ id: string }>();
    expect(chatResponse.json()).toMatchObject({
      body: "I need a worked example",
      author: { displayName: "You", mine: true },
    });
    const hostChat = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.sessionId}/chat/messages`,
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(hostChat.json()).toMatchObject({
      messages: [
        {
          id: chatMessage.id,
          author: { displayName: participant.snapshot.participants[0]!.nickname },
        },
      ],
    });
    const publicChatSettings = await app.inject({
      method: "PATCH",
      url: `/v1/sessions/${session.sessionId}/interactions/settings`,
      headers: {
        authorization: `Bearer ${session.hostToken}`,
        "x-idempotency-key": randomUUID(),
      },
      payload: { chatIdentityMode: "alias_public", presenterFeedMode: "live" },
    });
    expect(publicChatSettings.statusCode).toBe(200);
    const audiencePresenter = (
      await app.inject({
        method: "POST",
        url: `/v1/sessions/${session.sessionId}/staff`,
        headers: { cookie },
        payload: { role: "presenter", label: "Audience display" },
      })
    ).json<{ token: string }>();
    const presenterChat = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.sessionId}/chat/messages`,
      headers: { authorization: `Bearer ${audiencePresenter.token}` },
    });
    expect(presenterChat.json()).toMatchObject({
      messages: [{ id: chatMessage.id, author: { displayName: "Anonymous" } }],
    });
    const selfReport = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/chat/messages/${chatMessage.id}/report`,
      headers: {
        authorization: `Bearer ${participant.participantToken}`,
        "x-idempotency-key": randomUUID(),
      },
    });
    expect(selfReport.statusCode).toBe(409);
    const reaction = await app.inject({
      method: "PUT",
      url: `/v1/sessions/${session.sessionId}/chat/messages/${chatMessage.id}/reaction`,
      headers: {
        authorization: `Bearer ${participant.participantToken}`,
        "x-idempotency-key": randomUUID(),
      },
      payload: { reaction: "insight" },
    });
    expect(reaction.statusCode).toBe(200);
    expect(reaction.json()).toMatchObject({ viewerReaction: "insight" });
    const hostPulse = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.sessionId}/interactions/summary`,
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(hostPulse.json()).toMatchObject({
      uniqueSignalers: 1,
      signalsLastMinute: 1,
      signalCounts: { need_example: 1 },
      participants: [
        {
          nickname: participant.snapshot.participants[0]!.nickname,
          avatarId: "robot",
          currentSignal: "need_example",
          chatMessageCount: 1,
        },
      ],
    });
    const participantPulse = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.sessionId}/interactions/summary`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
    });
    expect(participantPulse.json()).toMatchObject({
      signalCounts: null,
      mySignal: "need_example",
    });
    const interactionParticipantId = participant.snapshot.participants[0]!.id;
    const bannedAudience = await app.inject({
      method: "PATCH",
      url: `/v1/sessions/${session.sessionId}/interactions/participants/${interactionParticipantId}`,
      headers: {
        authorization: `Bearer ${session.hostToken}`,
        "x-idempotency-key": randomUUID(),
      },
      payload: { action: "ban" },
    });
    expect(bannedAudience.json()).toMatchObject({ banned: true });
    expect(
      await repository.isQnaBanned(
        creator.creator.workspaceId,
        session.sessionId,
        interactionParticipantId,
      ),
    ).toBe(true);
    const restoredAudience = await app.inject({
      method: "PATCH",
      url: `/v1/sessions/${session.sessionId}/interactions/participants/${interactionParticipantId}`,
      headers: {
        authorization: `Bearer ${session.hostToken}`,
        "x-idempotency-key": randomUUID(),
      },
      payload: { action: "unban" },
    });
    expect(restoredAudience.json()).toMatchObject({ banned: false });
    expect(
      await repository.isQnaBanned(
        creator.creator.workspaceId,
        session.sessionId,
        interactionParticipantId,
      ),
    ).toBe(false);

    const submittedQuestion = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/qna/questions`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
      payload: { body: "<strong>Could you explain</strong> why Edmonton is correct?" },
    });
    expect(submittedQuestion.statusCode).toBe(201);
    const audienceQuestion = submittedQuestion.json<{ id: string; body: string; status: string }>();
    expect(audienceQuestion).toMatchObject({
      body: "Could you explain why Edmonton is correct?",
      status: "pending",
    });
    expect(
      [...repository.audienceOutbox.values()].some(
        (event) => event.sessionId === session.sessionId && event.type === "qna.question.created",
      ),
    ).toBe(true);
    const participantQuestions = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.sessionId}/qna/questions`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
    });
    expect(participantQuestions.json()).toMatchObject({
      settings: {
        displayMode: "anonymous_public",
        moderationMode: "pre",
        participantReplies: false,
      },
      questions: [{ id: audienceQuestion.id, author: { displayName: "You", mine: true } }],
    });
    const hostQuestions = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.sessionId}/qna/questions`,
      headers: { authorization: `Bearer ${session.hostToken}` },
    });
    expect(hostQuestions.statusCode).toBe(200);
    expect(hostQuestions.json()).toMatchObject({
      questions: [
        {
          id: audienceQuestion.id,
          status: "pending",
          author: { displayName: participant.snapshot.participants[0]!.nickname },
        },
      ],
    });
    const pendingVote = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/qna/questions/${audienceQuestion.id}/vote`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
    });
    expect(pendingVote.statusCode).toBe(409);
    expect(pendingVote.json()).toMatchObject({ error: { code: "MODERATION_REQUIRED" } });
    const publishedQuestion = await app.inject({
      method: "PATCH",
      url: `/v1/sessions/${session.sessionId}/qna/questions/${audienceQuestion.id}`,
      headers: { authorization: `Bearer ${session.hostToken}` },
      payload: { status: "published", label: "Clarification" },
    });
    expect(publishedQuestion.statusCode).toBe(200);
    expect(publishedQuestion.json()).toMatchObject({
      id: audienceQuestion.id,
      status: "published",
      label: "Clarification",
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const voted = await app.inject({
        method: "POST",
        url: `/v1/sessions/${session.sessionId}/qna/questions/${audienceQuestion.id}/vote`,
        headers: { authorization: `Bearer ${participant.participantToken}` },
      });
      expect(voted.json()).toMatchObject({ voteCount: 1, voted: true });
    }
    const blockedReply = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/qna/questions/${audienceQuestion.id}/replies`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
      payload: { body: "I have the same question." },
    });
    expect(blockedReply.statusCode).toBe(409);
    expect(blockedReply.json()).toMatchObject({ error: { code: "QNA_DISABLED" } });
    const facilitatorReply = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/qna/questions/${audienceQuestion.id}/replies`,
      headers: { authorization: `Bearer ${session.hostToken}` },
      payload: { body: "We will revisit the provincial-capital distinction." },
    });
    expect(facilitatorReply.statusCode).toBe(201);
    expect(facilitatorReply.json()).toMatchObject({
      status: "published",
      author: { kind: "staff" },
    });

    const started = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/commands`,
      headers: { authorization: `Bearer ${session.hostToken}` },
      payload: {
        commandId: randomUUID(),
        expectedVersion: participant.snapshot.version,
        action: "start",
      },
    });
    expect(started.statusCode).toBe(200);
    const open = started.json<{ snapshot: SessionSnapshot }>().snapshot;
    expect(open.phase).toBe("question_open");
    expect(JSON.stringify(open.question)).not.toContain("isCorrect");
    const resetPulse = await app.inject({
      method: "GET",
      url: `/v1/sessions/${session.sessionId}/interactions/summary`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
    });
    expect(resetPulse.json()).toMatchObject({
      contextKey: `round:${open.roundId}`,
      mySignal: null,
    });

    const idempotencyKey = randomUUID();
    const attempts = await Promise.all([
      ...[0, 1].map(() =>
        app!.inject({
          method: "POST",
          url: `/v1/sessions/${session.sessionId}/answers`,
          headers: { authorization: `Bearer ${participant.participantToken}` },
          payload: { roundId: open.roundId, choiceId: correctChoiceId, idempotencyKey },
        }),
      ),
      app.inject({
        method: "POST",
        url: `/v1/sessions/${session.sessionId}/answers`,
        headers: { authorization: `Bearer ${participant.participantToken}` },
        payload: {
          roundId: randomUUID(),
          choiceId: correctChoiceId,
          idempotencyKey: randomUUID(),
        },
      }),
    ]);
    const firstAttempt = attempts[0]!;
    const retryAttempt = attempts[1]!;
    const staleRoundAttempt = attempts[2]!;
    expect(firstAttempt.statusCode).toBe(200);
    expect(retryAttempt.statusCode).toBe(200);
    expect(staleRoundAttempt.statusCode).toBe(200);
    const acknowledgements = [firstAttempt, retryAttempt].map((response) =>
      response.json<{ accepted: boolean; score: number; duplicate: boolean; answerId: string }>(),
    );
    expect(acknowledgements.map(({ accepted }) => accepted)).toEqual([true, true]);
    expect(acknowledgements.map(({ score }) => score)).toEqual([1_000, 1_000]);
    expect(acknowledgements.map(({ duplicate }) => duplicate).sort()).toEqual([false, true]);
    expect(new Set(acknowledgements.map(({ answerId }) => answerId)).size).toBe(1);
    expect(staleRoundAttempt.json()).toMatchObject({
      accepted: false,
      duplicate: false,
      code: "ANSWER_INVALID",
    });

    const synced = await built.sessions.snapshot({
      sessionId: session.sessionId,
      hostToken: session.hostToken,
      role: "host",
    });
    const locked = await built.sessions.hostCommand({
      sessionId: session.sessionId,
      hostToken: session.hostToken,
      commandId: randomUUID(),
      expectedVersion: synced.version,
      action: "lock",
    });
    const revealed = await built.sessions.hostCommand({
      sessionId: session.sessionId,
      hostToken: session.hostToken,
      commandId: randomUUID(),
      expectedVersion: locked.version,
      action: "reveal",
    });
    const finished = await built.sessions.hostCommand({
      sessionId: session.sessionId,
      hostToken: session.hostToken,
      commandId: randomUUID(),
      expectedVersion: revealed.version,
      action: "next",
    });
    expect(finished.phase).toBe("finished");
    const latePulse = await app.inject({
      method: "PUT",
      url: `/v1/sessions/${session.sessionId}/signals/current`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
      payload: { signal: "got_it", idempotencyKey: randomUUID() },
    });
    expect(latePulse.statusCode).toBe(409);
    expect(latePulse.json()).toMatchObject({ error: { code: "INTERACTIONS_DISABLED" } });
    const lateChat = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/chat/messages`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
      payload: { body: "This must not enter the report", idempotencyKey: randomUUID() },
    });
    expect(lateChat.statusCode).toBe(409);
    expect(lateChat.json()).toMatchObject({ error: { code: "INTERACTIONS_DISABLED" } });
    const questionCountAtFinish = repository.qnaQuestions.size;
    const lateQuestion = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/qna/questions`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
      payload: { body: "This must not be persisted after the round finishes." },
    });
    expect(lateQuestion.statusCode).toBe(409);
    expect(lateQuestion.json()).toMatchObject({ error: { code: "QNA_DISABLED" } });
    expect(repository.qnaQuestions.size).toBe(questionCountAtFinish);
    expect(
      await repository.getInteractionSettings(creator.creator.workspaceId, session.sessionId),
    ).toMatchObject({ chatEnabled: false, signalsEnabled: false, closedAt: expect.any(Date) });
    const delayedRetry = await app.inject({
      method: "POST",
      url: `/v1/sessions/${session.sessionId}/answers`,
      headers: { authorization: `Bearer ${participant.participantToken}` },
      payload: { roundId: open.roundId, choiceId: correctChoiceId, idempotencyKey },
    });
    expect(delayedRetry.statusCode).toBe(200);
    expect(delayedRetry.json()).toMatchObject({
      accepted: true,
      duplicate: true,
      answerId: acknowledgements[0]!.answerId,
    });
    const replayed = await built.sessions.sync({
      sessionId: session.sessionId,
      hostToken: session.hostToken,
      role: "host",
      lastSeq: open.seq,
    });
    expect(replayed.replayComplete).toBe(true);
    expect(replayed.replay.map(({ seq }) => seq)).toEqual([3, 4, 5, 6, 7]);
    expect(replayed.replay.map(({ eventId }) => eventId)).toEqual(
      [3, 4, 5, 6, 7].map((seq) => `${session.sessionId}:${seq}`),
    );
    expect(replayed.snapshot.seq).toBe(7);

    await built.sessions.disconnect(participant.participantToken);
    const disconnected = await built.sessions.snapshot({
      sessionId: session.sessionId,
      hostToken: session.hostToken,
      role: "host",
    });
    expect(disconnected.participants[0]?.connected).toBe(false);
    const reconnected = await built.sessions.sync({
      sessionId: session.sessionId,
      participantToken: participant.participantToken,
      role: "participant",
      lastSeq: disconnected.seq,
    });
    expect(reconnected.snapshot.participants[0]?.connected).toBe(true);

    const storedSession = await repository.getSessionById(session.sessionId);
    expect(storedSession?.state.answers).toEqual({});
    const pendingReport = storedSession
      ? await repository.getReportBySession(storedSession.workspaceId, session.sessionId)
      : null;
    expect(pendingReport).toMatchObject({ status: "pending", schemaVersion: 3 });
    const pendingCsv = await app.inject({
      method: "GET",
      url: `/v1/reports/${pendingReport!.id}.csv`,
      headers: { cookie },
    });
    expect(pendingCsv.statusCode).toBe(409);
    await built.reportWorker.runUntilIdle();
    const report = storedSession
      ? await repository.getReportBySession(storedSession.workspaceId, session.sessionId)
      : null;
    expect((report as Report).metrics).toMatchObject({
      participantCount: 1,
      answerCount: 1,
      accuracyPercent: 100,
    });
    expect(report).toMatchObject({
      schemaVersion: 3,
      status: "ready",
      initialAccuracy: { correct: 1, responses: 1, percent: 100 },
      audiencePulse: { uniqueParticipants: 1, events: 1 },
      conversation: { messages: 1, uniqueContributors: 1, reactions: 1 },
    });
    const generatedAt = new Date((report as Report).generatedAt!).getTime();
    const expiresAt = new Date((report as Report).expiresAt).getTime();
    expect(expiresAt - generatedAt).toBeGreaterThanOrEqual(30 * 24 * 60 * 60_000 - 5_000);
    expect(expiresAt - generatedAt).toBeLessThanOrEqual(30 * 24 * 60 * 60_000 + 5_000);

    const reportResponse = await app.inject({
      method: "GET",
      url: `/v1/reports/${(report as Report).id}`,
      headers: { cookie },
    });
    expect(reportResponse.statusCode).toBe(200);
    expect(reportResponse.json()).toMatchObject({
      report: { expiresAt: (report as Report).expiresAt },
      entitlements: { plan: "free", reportRetentionDays: 30, csvExport: false },
    });
    const freeCsv = await app.inject({
      method: "GET",
      url: `/v1/reports/${(report as Report).id}.csv`,
      headers: { cookie },
    });
    expect(freeCsv.statusCode).toBe(402);
    expect(freeCsv.json()).toMatchObject({ error: { code: "ENTITLEMENT_LIMIT" } });
    await repository.setPlan(storedSession!.workspaceId, "pro");
    const proCsv = await app.inject({
      method: "GET",
      url: `/v1/reports/${(report as Report).id}.csv`,
      headers: { cookie },
    });
    expect(proCsv.statusCode).toBe(200);
    expect(proCsv.headers["content-type"]).toContain("text/csv");
    expect(proCsv.body).toContain("participant_id,nickname,score");
    expect(proCsv.body).toContain("report_schema_version,3");
    const proJson = await app.inject({
      method: "GET",
      url: `/v1/reports/${(report as Report).id}.json`,
      headers: { cookie },
    });
    expect(proJson.statusCode).toBe(200);
    expect(proJson.headers["content-type"]).toContain("application/json");
    expect(proJson.json()).toMatchObject({ schemaVersion: 3, status: "ready" });
    const interactionCsv = await app.inject({
      method: "GET",
      url: `/v1/reports/${(report as Report).id}/interactions.csv`,
      headers: { cookie },
    });
    expect(interactionCsv.statusCode).toBe(200);
    expect(interactionCsv.body).toContain("signal");
    expect(interactionCsv.body).toContain("I need a worked example");
    const facilitatorUser = [...repository.users.values()].find(
      (candidate) => candidate.email === "facilitator@example.com",
    )!;
    facilitatorUser.role = "viewer";
    const viewerTranscript = await app.inject({
      method: "GET",
      url: `/v1/reports/${(report as Report).id}/interactions`,
      headers: { cookie },
    });
    expect(viewerTranscript.statusCode).toBe(200);
    const viewerPrivateMessage = viewerTranscript
      .json<{
        transcript: {
          messages: Array<{ id: string; participantId: string | null; alias: string }>;
        };
      }>()
      .transcript.messages.find((message) => message.id === chatMessage.id);
    expect(viewerPrivateMessage).toEqual(
      expect.objectContaining({ participantId: null, alias: "Anonymous" }),
    );
    facilitatorUser.role = "owner";
    const brandedSession = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { cookie },
      payload: {
        quizId,
        settings: {
          audienceLimit: 20,
          scoringMode: "accuracy",
          resultVisibility: "private",
          allowLateJoin: true,
          nicknamePolicy: "friendly_only",
        },
      },
    });
    expect(brandedSession.statusCode).toBe(201);
    const branded = brandedSession.json<{
      sessionId: string;
      hostToken: string;
      snapshot: SessionSnapshot;
    }>();
    expect(branded.snapshot.brandTheme).toEqual({
      organizationName: "Northern Learning",
      primaryColor: "#0B2239",
      accentColor: "#087375",
    });
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/v1/account/theme",
          headers: { cookie },
          payload: {
            organizationName: "Updated organization",
            primaryColor: "#102A43",
            accentColor: "#055D5F",
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await built.sessions.snapshot({
          sessionId: branded.sessionId,
          hostToken: branded.hostToken,
          role: "host",
        })
      ).brandTheme,
    ).toEqual({
      organizationName: "Northern Learning",
      primaryColor: "#0B2239",
      accentColor: "#087375",
    });
    await built.audienceOutboxWorker.runUntilIdle();
    const metrics = await app.inject({ method: "GET", url: "/metrics" });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain("openround_join_acknowledgement_duration_seconds");
    expect(metrics.body).toContain("openround_join_batch_size_count 1");
    expect(metrics.body).toContain("openround_answer_acknowledgement_duration_seconds");
    expect(metrics.body).toContain('openround_answers_total{outcome="accepted"} 1');
    expect(metrics.body).toContain("openround_session_mutation_lease_wait_seconds");
    expect(metrics.body).toContain("openround_session_version_conflicts_total");
    expect(metrics.body).toContain("openround_audience_events_total");
    expect(metrics.body).toContain("openround_audience_outbox_backlog 0");
    expect(metrics.body).toContain("openround_audience_sync_total");
    expect(metrics.body).toContain("openround_chat_enabled_sessions");

    const accountExport = await repository.exportAccount(
      [...repository.users.values()].find(
        (candidate) => candidate.email === "facilitator@example.com",
      )!.userId,
    );
    expect(accountExport).toMatchObject({
      interactionSettings: expect.arrayContaining([
        expect.objectContaining({ sessionId: session.sessionId }),
      ]),
      signalEvents: expect.arrayContaining([
        expect.objectContaining({ sessionId: session.sessionId }),
      ]),
      chatMessages: expect.arrayContaining([expect.objectContaining({ id: chatMessage.id })]),
      chatReactions: expect.arrayContaining([
        expect.objectContaining({ messageId: chatMessage.id }),
      ]),
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/sessions/${session.sessionId}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(204);
    expect(
      await repository.getInteractionSettings(creator.creator.workspaceId, session.sessionId),
    ).toBeNull();
    expect(
      [...repository.chatMessages.values()].filter(
        (message) => message.sessionId === session.sessionId,
      ),
    ).toEqual([]);
    expect(
      repository.signalEvents.filter((event) => event.sessionId === session.sessionId),
    ).toEqual([]);
    await expect(
      built.sessions.snapshot({
        sessionId: session.sessionId,
        hostToken: session.hostToken,
        role: "host",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const user = [...repository.users.values()].find(
      (candidate) => candidate.email === "facilitator@example.com",
    )!;
    user.role = "viewer";
    const viewerRead = await app.inject({
      method: "GET",
      url: "/v1/quizzes",
      headers: { cookie },
    });
    expect(viewerRead.statusCode).toBe(200);
    const viewerWrite = await app.inject({
      method: "POST",
      url: "/v1/quizzes",
      headers: { cookie },
      payload: { title: "Blocked viewer set", description: "" },
    });
    expect(viewerWrite.statusCode).toBe(403);
    expect(viewerWrite.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
    user.role = "owner";
  });

  it("returns the stable RATE_LIMITED error envelope", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        LOG_LEVEL: "silent",
      }),
      { repository: new MemoryRepository(), cache: new MemorySessionCache() },
    );
    app = built.app;

    let response = await app.inject({
      method: "POST",
      url: "/v1/sessions/join",
      payload: { code: "0000000", nickname: "Rate test" },
    });
    for (let attempt = 1; attempt < 21; attempt += 1) {
      response = await app.inject({
        method: "POST",
        url: "/v1/sessions/join",
        payload: { code: "0000000", nickname: "Rate test" },
      });
    }

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("keeps account data intact when owned media cannot be removed", async () => {
    const repository = new MemoryRepository();
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;

    const magic = await app.inject({
      method: "POST",
      url: "/v1/auth/magic-link",
      payload: { email: "delete@example.com", segment: "workplace", acceptPolicies: true },
    });
    const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
    const verified = await app.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
    const setCookie = verified.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    const creator = me.json<{ creator: { userId: string; workspaceId: string } }>().creator;
    const mediaId = randomUUID();
    await repository.createMediaAsset({
      id: mediaId,
      workspaceId: creator.workspaceId,
      objectKey: `media/${creator.workspaceId}/${mediaId}.png`,
      mimeType: "image/png",
      sizeBytes: 128,
      scanStatus: "clean",
      altText: "A chart",
      createdAt: new Date(),
    });

    const exported = await app.inject({
      method: "GET",
      url: "/v1/account/export",
      headers: { cookie },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.body).not.toContain("tokenHash");
    expect(exported.json<{ mediaAssets: unknown[] }>().mediaAssets).toHaveLength(1);

    const blocked = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { cookie },
      payload: { confirmation: "DELETE" },
    });
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json()).toMatchObject({
      error: { code: "DEPENDENCY_UNAVAILABLE" },
    });
    expect(await repository.getMediaAsset(creator.workspaceId, mediaId)).not.toBeNull();
    expect(
      (await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } })).statusCode,
    ).toBe(200);

    await repository.deleteMediaAsset(creator.workspaceId, mediaId);
    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { cookie },
      payload: { confirmation: "DELETE" },
    });
    expect(deleted.statusCode).toBe(204);
    expect(await repository.exportAccount(creator.userId)).toEqual({});
  });

  it("deletes only owned workspaces when the active workspace is shared", async () => {
    const repository = new MemoryRepository();
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        AUTH_DEBUG_MAGIC_LINKS: "true",
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;
    const member = await signIn(app, "member-delete@example.com");
    const owner = await signIn(app, "shared-owner@example.com");
    const invitation = await app.inject({
      method: "POST",
      url: "/v1/workspace/invitations",
      headers: { cookie: owner.cookie },
      payload: { email: "member-delete@example.com", role: "editor" },
    });
    const invitationToken = new URL(
      invitation.json<{ debugUrl: string }>().debugUrl,
    ).searchParams.get("token")!;
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/invitations/accept",
      payload: { token: invitationToken, acceptPolicies: true },
    });
    const acceptedCookieHeader = accepted.headers["set-cookie"]!;
    const sharedCookie = (
      Array.isArray(acceptedCookieHeader) ? acceptedCookieHeader[0]! : acceptedCookieHeader
    ).split(";")[0]!;
    const sharedAssetId = randomUUID();
    await repository.createMediaAsset({
      id: sharedAssetId,
      workspaceId: owner.creator.workspaceId,
      objectKey: `media/${owner.creator.workspaceId}/${sharedAssetId}.png`,
      mimeType: "image/png",
      sizeBytes: 128,
      scanStatus: "clean",
      altText: "Shared workspace asset",
      createdAt: new Date(),
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/v1/account",
      headers: { cookie: sharedCookie },
      payload: { confirmation: "DELETE" },
    });

    expect(deleted.statusCode).toBe(204);
    expect(repository.workspaces.has(member.creator.workspaceId)).toBe(false);
    expect(repository.workspaces.has(owner.creator.workspaceId)).toBe(true);
    expect(await repository.getMediaAsset(owner.creator.workspaceId, sharedAssetId)).not.toBeNull();
  });

  it("verifies and applies Stripe events atomically and in order", async () => {
    const repository = new MemoryRepository();
    const webhookSecret = "whsec_openround_test_secret";
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        BILLING_MODE: "stripe",
        STRIPE_SECRET_KEY: "sk_test_openround",
        STRIPE_WEBHOOK_SECRET: webhookSecret,
        STRIPE_PRO_PRICE_ID: "price_openround_pro",
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;

    const tokenHash = `stripe-${randomUUID()}`;
    await repository.createMagicToken({
      id: randomUUID(),
      email: "billing@example.com",
      segment: "workplace",
      tokenHash,
      policyVersion: "test-v1",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    const creator = (await repository.consumeMagicToken(tokenHash, new Date()))!;
    const created = 1_789_387_200;
    const checkoutPayload = JSON.stringify({
      id: "evt_checkout_once",
      object: "event",
      api_version: "2026-08-27.basil",
      created,
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_openround",
          object: "checkout.session",
          customer: "cus_openround",
          subscription: "sub_openround",
          metadata: { workspaceId: creator.workspaceId },
        },
      },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload: checkoutPayload,
      secret: webhookSecret,
    });
    const sendWebhook = (payload: string, stripeSignature: string) =>
      app!.inject({
        method: "POST",
        url: "/v1/webhooks/stripe",
        headers: { "content-type": "application/json", "stripe-signature": stripeSignature },
        payload,
      });

    expect((await sendWebhook(checkoutPayload, signature)).statusCode).toBe(204);
    expect((await sendWebhook(checkoutPayload, signature)).statusCode).toBe(204);
    expect(repository.billingEvents.size).toBe(1);
    expect(await repository.getBillingProfile(creator.workspaceId)).toMatchObject({
      plan: "pro",
      customerId: "cus_openround",
      subscriptionId: "sub_openround",
    });

    const stalePayload = JSON.stringify({
      id: "evt_stale_subscription",
      object: "event",
      api_version: "2026-08-27.basil",
      created: created - 60,
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_openround",
          object: "subscription",
          customer: "cus_openround",
          metadata: { workspaceId: creator.workspaceId },
          status: "canceled",
        },
      },
    });
    expect(
      (
        await sendWebhook(
          stalePayload,
          Stripe.webhooks.generateTestHeaderString({
            payload: stalePayload,
            secret: webhookSecret,
          }),
        )
      ).statusCode,
    ).toBe(204);
    expect(await repository.getPlan(creator.workspaceId)).toBe("pro");
    expect((await sendWebhook(stalePayload, "bad-signature")).statusCode).toBe(400);
  });

  it("reuses a checkout attempt and rejects workspaces with an existing subscription", async () => {
    const repository = new MemoryRepository();
    const createCheckout = vi.fn().mockResolvedValue({
      url: "https://checkout.stripe.test/openround",
    });
    const stripe = {
      checkout: { sessions: { create: createCheckout } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn() },
    } as unknown as Stripe;
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        BILLING_MODE: "stripe",
        STRIPE_SECRET_KEY: "sk_test_openround",
        STRIPE_WEBHOOK_SECRET: "whsec_openround",
        STRIPE_PRO_PRICE_ID: "price_openround_pro",
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache(), stripe },
    );
    app = built.app;

    const magic = await app.inject({
      method: "POST",
      url: "/v1/auth/magic-link",
      payload: { email: "checkout@example.com", segment: "workplace", acceptPolicies: true },
    });
    const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
    const verified = await app.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
    const setCookie = verified.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    const workspaceId = account.json<{ creator: { workspaceId: string } }>().creator.workspaceId;

    const first = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { cookie },
    });
    const retry = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { cookie },
    });
    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(createCheckout).toHaveBeenCalledTimes(2);
    const firstIdempotencyKey = createCheckout.mock.calls[0]?.[1]?.idempotencyKey;
    expect(firstIdempotencyKey).toMatch(/^openround-pro-[a-f0-9]{64}$/);
    expect(createCheckout.mock.calls[1]?.[1]?.idempotencyKey).toBe(firstIdempotencyKey);
    expect(createCheckout.mock.calls[0]?.[0]).toMatchObject({
      customer_email: "checkout@example.com",
      client_reference_id: workspaceId,
      metadata: { workspaceId },
    });

    await repository.setPlan(workspaceId, "pro", {
      customerId: "cus_existing",
      subscriptionId: "sub_existing",
      status: "active",
    });
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/billing/checkout",
      headers: { cookie },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ error: { code: "CONFLICT" } });
    expect(createCheckout).toHaveBeenCalledTimes(2);
  });

  it("enforces the published quiz limit when an archived quiz is restored", async () => {
    const repository = new MemoryRepository();
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        COMMUNITY_MODE: "false",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;

    const magic = await app.inject({
      method: "POST",
      url: "/v1/auth/magic-link",
      payload: { email: "limits@example.com", segment: "education", acceptPolicies: true },
    });
    const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
    const verified = await app.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
    const setCookie = verified.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    const account = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    const workspaceId = account.json<{ creator: { workspaceId: string } }>().creator.workspaceId;
    const now = new Date();
    const draft = { title: "Limit fixture", description: "", questions: [] };
    const archivedId = randomUUID();
    await repository.createQuiz({
      id: archivedId,
      workspaceId,
      title: draft.title,
      description: "",
      status: "archived",
      draft,
      currentVersionId: randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    for (let index = 0; index < 5; index += 1) {
      await repository.createQuiz({
        id: randomUUID(),
        workspaceId,
        title: `Published ${index + 1}`,
        description: "",
        status: "published",
        draft: { ...draft, title: `Published ${index + 1}` },
        currentVersionId: randomUUID(),
        createdAt: now,
        updatedAt: now,
      });
    }

    const restored = await app.inject({
      method: "POST",
      url: `/v1/quizzes/${archivedId}/archive`,
      headers: { cookie },
      payload: { archived: false },
    });
    expect(restored.statusCode).toBe(402);
    expect(restored.json()).toMatchObject({ error: { code: "ENTITLEMENT_LIMIT" } });
    expect((await repository.getQuiz(workspaceId, archivedId))?.status).toBe("archived");
  });

  it("exposes configuration-backed operational kill switches", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        COMMUNITY_MODE: "true",
        DEVELOPMENT_EMAIL_INBOX_URL: "http://localhost:8025",
        FEATURE_SIGNUPS: "false",
        FEATURE_SESSION_CREATION: "false",
        FEATURE_MEDIA_UPLOADS: "false",
        FEATURE_ROUND_EXPERIENCES: "false",
        FEATURE_AUDIENCE_PULSE: "false",
        FEATURE_ROOM_CHAT: "false",
        LOG_LEVEL: "silent",
      }),
      { repository: new MemoryRepository(), cache: new MemorySessionCache() },
    );
    app = built.app;

    const features = await app.inject({ method: "GET", url: "/v1/features" });
    expect(features.json()).toMatchObject({
      publicWebUrl: "http://localhost:3000",
      developmentEmailInboxUrl: "http://localhost:8025",
      signups: false,
      sessionCreation: false,
      mediaUploads: false,
      roundExperiences: false,
      audiencePulse: false,
      roomChat: false,
    });
    expect((await app.inject({ method: "GET", url: "/v1/experience-presets" })).statusCode).toBe(
      503,
    );
    const signup = await app.inject({
      method: "POST",
      url: "/v1/auth/magic-link",
      payload: {
        email: "paused@example.com",
        segment: "education",
        acceptPolicies: true,
      },
    });
    expect(signup.statusCode).toBe(503);
    expect(signup.json()).toMatchObject({ error: { code: "DEPENDENCY_UNAVAILABLE" } });
  });

  it("applies the design-partner workspace rollout allowlist", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST: "11111111-1111-4111-8111-111111111111",
        LOG_LEVEL: "silent",
      }),
      { repository: new MemoryRepository(), cache: new MemorySessionCache() },
    );
    app = built.app;

    const { cookie } = await signIn(app, "rollout-unlisted@example.com");
    const account = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie },
    });
    expect(account.json()).toMatchObject({
      productFeatures: {
        roundExperiences: false,
        audiencePulse: false,
        roomChat: false,
      },
    });
  });

  it("applies audited operational kill switches without a restart", async () => {
    const repository = new MemoryRepository();
    const adminToken = "runtime-admin-token-1234567890";
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        ADMIN_TOKEN: adminToken,
        LOG_LEVEL: "silent",
      }),
      { repository, cache: new MemorySessionCache() },
    );
    app = built.app;

    const magic = await app.inject({
      method: "POST",
      url: "/v1/auth/magic-link",
      payload: {
        email: "runtime-flags@example.com",
        segment: "workplace",
        acceptPolicies: true,
      },
    });
    const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
    const verified = await app.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
    const setCookie = verified.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;

    const unauthorized = await app.inject({
      method: "PATCH",
      url: "/v1/admin/features",
      payload: { signups: false },
    });
    expect(unauthorized.statusCode).toBe(401);

    const paused = await app.inject({
      method: "PATCH",
      url: "/v1/admin/features",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        signups: false,
        sessionCreation: false,
        mediaUploads: false,
        roundExperiences: false,
        audiencePulse: false,
        roomChat: false,
      },
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json()).toMatchObject({
      configured: { signups: true, sessionCreation: true, mediaUploads: false },
      runtime: {
        signups: false,
        sessionCreation: false,
        mediaUploads: false,
        roundExperiences: false,
        audiencePulse: false,
        roomChat: false,
      },
      effective: {
        signups: false,
        sessionCreation: false,
        mediaUploads: false,
        roundExperiences: false,
        audiencePulse: false,
        roomChat: false,
      },
    });
    expect(repository.audits.at(-1)).toMatchObject({
      action: "operations.features.update",
      requestId: paused.headers["x-request-id"],
    });

    const publicFeatures = await app.inject({ method: "GET", url: "/v1/features" });
    expect(publicFeatures.json()).toMatchObject({
      signups: false,
      sessionCreation: false,
      mediaUploads: false,
      roundExperiences: false,
      audiencePulse: false,
      roomChat: false,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/magic-link",
          payload: {
            email: "paused@example.com",
            segment: "education",
            acceptPolicies: true,
          },
        })
      ).statusCode,
    ).toBe(503);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/sessions",
          headers: { cookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(503);
    const mediaPaused = await app.inject({
      method: "POST",
      url: "/v1/media",
      headers: { cookie },
      payload: {},
    });
    expect(mediaPaused.statusCode).toBe(503);
    expect(mediaPaused.json()).toMatchObject({ error: { code: "DEPENDENCY_UNAVAILABLE" } });

    const resumed = await app.inject({
      method: "PATCH",
      url: "/v1/admin/features",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { signups: true, sessionCreation: true, mediaUploads: true },
    });
    expect(resumed.json()).toMatchObject({
      runtime: { signups: true, sessionCreation: true, mediaUploads: true },
      effective: { signups: true, sessionCreation: true, mediaUploads: false },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/magic-link",
          payload: {
            email: "resumed@example.com",
            segment: "education",
            acceptPolicies: true,
          },
        })
      ).statusCode,
    ).toBe(202);
  });
});

describe("health probes", () => {
  it("keeps liveness healthy while failing readiness when a dependency is unavailable", async () => {
    const built = await buildApp(
      ConfigSchema.parse({
        NODE_ENV: "test",
        ALLOW_IN_MEMORY: "true",
        WEB_ORIGIN: "http://localhost:3000",
        PUBLIC_API_URL: "http://localhost:4000",
        LOG_LEVEL: "silent",
      }),
      {
        repository: new MemoryRepository(),
        cache: new MemorySessionCache(),
        readiness: async () => {
          throw new Error("database credential expired");
        },
      },
    );
    app = built.app;

    const live = await app.inject({ method: "GET", url: "/health/live" });
    const ready = await app.inject({ method: "GET", url: "/health/ready" });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok" });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({
      status: "not_ready",
      dependencies: { database: "unknown", coordination: "unknown" },
    });
    expect(ready.body).not.toContain("credential expired");
  });
});
