import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, jwtVerify, type JWTPayload } from "jose";
import type { QuizDraft } from "@openround/contracts";
import { MemoryRepository, type CreatorContext, type LtiRegistrationRecord } from "@openround/db";
import { ConfigSchema } from "../src/config.js";
import { JoseLtiJwtAdapter, LtiService, type LtiJwtAdapter } from "../src/lti-service.js";

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim";
const DL_CLAIM = "https://purl.imsglobal.org/spec/lti-dl/claim";

class FakeLtiJwtAdapter implements LtiJwtAdapter {
  payload: JWTPayload = {};
  signedPayload: JWTPayload | null = null;
  signCount = 0;

  async verify(_idToken: string, _registration: LtiRegistrationRecord) {
    return structuredClone(this.payload);
  }

  async sign(payload: JWTPayload) {
    this.signCount += 1;
    this.signedPayload = structuredClone(payload);
    return "signed.deep-link.response";
  }

  async publicJwks() {
    return { keys: [{ kty: "RSA", kid: "test-key", n: "test", e: "AQAB" }] };
  }
}

const config = ConfigSchema.parse({
  NODE_ENV: "test",
  ALLOW_IN_MEMORY: "true",
  WEB_ORIGIN: "http://localhost:3000",
  PUBLIC_API_URL: "http://localhost:4000",
  LTI_MODE: "tool",
  LTI_TOOL_PRIVATE_JWK: "{}",
});

async function creator(repository: MemoryRepository): Promise<CreatorContext> {
  const tokenHash = `magic-${randomUUID()}`;
  await repository.createMagicToken({
    id: randomUUID(),
    email: "instructor@example.edu",
    segment: "education",
    tokenHash,
    policyVersion: "test-v1",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}

async function institutionSetup(repository: MemoryRepository, currentCreator: CreatorContext) {
  await repository.updateInstitutionPolicy(
    {
      workspaceId: currentCreator.workspaceId,
      contractStatus: "pilot",
      identityRequirement: "optional",
      capabilities: {
        oidc: false,
        managedSso: false,
        scim: false,
        lti: true,
        nrps: false,
        ags: false,
        auditExports: true,
        residencyControls: true,
      },
      k12Enabled: false,
      updatedAt: new Date(),
    },
    "test-policy",
  );
}

function registrationInput() {
  return {
    name: "Example LMS",
    issuer: "https://lms.example.edu",
    clientId: "openround-client",
    deploymentId: "deployment-1",
    authorizationEndpoint: "https://lms.example.edu/oidc/auth",
    tokenEndpoint: "https://lms.example.edu/oauth/token",
    jwksUrl: "https://lms.example.edu/.well-known/jwks.json",
    deepLinkReturnOrigins: ["https://lms.example.edu"],
    status: "active" as const,
  };
}

function deepLinkPayload(nonce: string): JWTPayload {
  return {
    iss: "https://lms.example.edu",
    sub: "lti-user-42",
    aud: "openround-client",
    nonce,
    [`${CLAIM}/deployment_id`]: "deployment-1",
    [`${CLAIM}/version`]: "1.3.0",
    [`${CLAIM}/message_type`]: "LtiDeepLinkingRequest",
    [`${CLAIM}/target_link_uri`]: "http://localhost:4000/v1/lti/launch",
    [`${CLAIM}/roles`]: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
    [`${CLAIM}/context`]: { id: "course-101" },
    [`${DL_CLAIM}/deep_linking_settings`]: {
      deep_link_return_url: "https://lms.example.edu/deep-links/return",
      accept_types: ["ltiResourceLink"],
      accept_presentation_document_targets: ["window", "iframe"],
      data: "opaque-platform-data",
    },
  };
}

async function publishedQuiz(repository: MemoryRepository, currentCreator: CreatorContext) {
  const quizId = randomUUID();
  const choiceId = randomUUID();
  const draft: QuizDraft = {
    title: "Safety diagnosis",
    description: "Check and recover understanding",
    questions: [
      {
        id: randomUUID(),
        type: "single_select",
        prompt: "Which control comes first?",
        purpose: "diagnostic",
        confidence: "optional",
        delivery: "main",
        conceptKeys: ["controls"],
        linkedRecheckQuestionId: null,
        choices: [
          { id: choiceId, label: "Eliminate the hazard", isCorrect: true },
          { id: randomUUID(), label: "Use PPE", isCorrect: false },
        ],
        timeLimitSeconds: 30,
        basePoints: 1_000,
        explanation: "Elimination is the strongest control.",
        mediaId: null,
        mediaAlt: null,
      },
    ],
  };
  const now = new Date();
  await repository.createQuiz({
    id: quizId,
    workspaceId: currentCreator.workspaceId,
    title: draft.title,
    description: draft.description,
    status: "draft",
    draft,
    currentVersionId: null,
    folderId: null,
    tags: [],
    createdAt: now,
    updatedAt: now,
  });
  const versionId = randomUUID();
  await repository.publishQuiz({
    id: versionId,
    workspaceId: currentCreator.workspaceId,
    quizId,
    version: 1,
    content: draft,
    contentHash: "test-content-hash",
    publishedAt: now,
  });
  return quizId;
}

describe("LTI 1.3 launch and deep linking", () => {
  it("publishes only the public half of the tool signing key", async () => {
    const pair = await generateKeyPair("RS256", { extractable: true, modulusLength: 2048 });
    const privateJwk = { ...(await exportJWK(pair.privateKey)), alg: "RS256" };
    const adapter = new JoseLtiJwtAdapter(privateJwk, "rotation-key-1");

    const signed = await adapter.sign({ iss: "openround", aud: "platform", sub: "openround" });
    await expect(
      jwtVerify(signed, pair.publicKey, { issuer: "openround", audience: "platform" }),
    ).resolves.toMatchObject({ payload: { sub: "openround" } });
    const jwks = await adapter.publicJwks();
    expect(jwks).toEqual({
      keys: [
        expect.objectContaining({
          kty: "RSA",
          kid: "rotation-key-1",
          alg: "RS256",
          use: "sig",
        }),
      ],
    });
    expect(jwks.keys[0]).not.toHaveProperty("d");
    expect(jwks.keys[0]).not.toHaveProperty("p");
    expect(jwks.keys[0]).not.toHaveProperty("q");
  });

  it("validates state and launch claims, requires explicit binding, and signs a deep link", async () => {
    const repository = new MemoryRepository();
    const currentCreator = await creator(repository);
    await institutionSetup(repository, currentCreator);
    const jwt = new FakeLtiJwtAdapter();
    const service = new LtiService(repository, config, jwt);
    const registration = await service.upsertRegistration(
      currentCreator.workspaceId,
      registrationInput(),
    );

    const login = await service.login({
      iss: registration.issuer,
      client_id: registration.clientId,
      lti_deployment_id: registration.deploymentId,
      login_hint: "login-hint",
      lti_message_hint: "message-hint",
      target_link_uri: "http://localhost:4000/v1/lti/launch",
    });
    const authorizationUrl = new URL(login.authorizationUrl);
    expect(authorizationUrl.searchParams.get("response_mode")).toBe("form_post");
    expect(authorizationUrl.searchParams.get("prompt")).toBe("none");
    const state = authorizationUrl.searchParams.get("state")!;
    jwt.payload = deepLinkPayload(authorizationUrl.searchParams.get("nonce")!);

    const launched = await service.launch(state, "signed-platform-token");
    expect(launched).toMatchObject({
      creator: null,
      launch: {
        messageType: "LtiDeepLinkingRequest",
        role: "instructor",
        deepLinkData: "opaque-platform-data",
      },
      linkToken: expect.any(String),
    });
    await expect(service.launch(state, "signed-platform-token")).rejects.toMatchObject({
      code: "LTI_LAUNCH_INVALID",
    });

    const bound = await service.bind(currentCreator, launched.linkToken!);
    expect(bound.creatorUserId).toBe(currentCreator.userId);
    expect(
      await repository.listExternalIdentities(currentCreator.workspaceId, currentCreator.userId),
    ).toEqual([expect.objectContaining({ provider: "lti", subject: "lti-user-42" })]);

    const quizId = await publishedQuiz(repository, currentCreator);
    const deepLink = await service.createDeepLink(currentCreator, launched.launch.id, quizId);
    expect(deepLink).toEqual({
      returnUrl: "https://lms.example.edu/deep-links/return",
      jwt: "signed.deep-link.response",
      quizId,
    });
    expect(jwt.signedPayload).toMatchObject({
      iss: "openround-client",
      sub: "openround-client",
      aud: "https://lms.example.edu",
      [`${CLAIM}/deployment_id`]: "deployment-1",
      [`${CLAIM}/message_type`]: "LtiDeepLinkingResponse",
      [`${DL_CLAIM}/data`]: "opaque-platform-data",
      [`${DL_CLAIM}/content_items`]: [
        expect.objectContaining({
          type: "ltiResourceLink",
          title: "Safety diagnosis",
          custom: { openround_quiz_id: quizId },
        }),
      ],
    });
    expect(await service.createDeepLink(currentCreator, launched.launch.id, quizId)).toEqual(
      deepLink,
    );
    const retryQuizId = await publishedQuiz(repository, currentCreator);
    expect(await service.createDeepLink(currentCreator, launched.launch.id, retryQuizId)).toEqual(
      deepLink,
    );
    expect(
      (await repository.getLtiLaunch(currentCreator.workspaceId, launched.launch.id, new Date()))
        ?.quizId,
    ).toBe(quizId);
    expect(jwt.signCount).toBe(1);
  });

  it("rejects launch before contract capability and rejects unregistered return origins", async () => {
    const repository = new MemoryRepository();
    const currentCreator = await creator(repository);
    const service = new LtiService(repository, config, new FakeLtiJwtAdapter());
    await expect(
      service.upsertRegistration(currentCreator.workspaceId, registrationInput()),
    ).rejects.toMatchObject({ code: "INSTITUTION_NOT_ENABLED" });

    await institutionSetup(repository, currentCreator);
    const jwt = new FakeLtiJwtAdapter();
    const enabledService = new LtiService(repository, config, jwt);
    const registration = await enabledService.upsertRegistration(
      currentCreator.workspaceId,
      registrationInput(),
    );
    const login = await enabledService.login({
      iss: registration.issuer,
      client_id: registration.clientId,
      login_hint: "login-hint",
      target_link_uri: "http://localhost:4000/v1/lti/launch",
    });
    const authorizationUrl = new URL(login.authorizationUrl);
    jwt.payload = deepLinkPayload(authorizationUrl.searchParams.get("nonce")!);
    (jwt.payload[`${DL_CLAIM}/deep_linking_settings`] as Record<string, unknown>)[
      "deep_link_return_url"
    ] = "https://attacker.example/collect";

    await expect(
      enabledService.launch(authorizationUrl.searchParams.get("state")!, "signed-platform-token"),
    ).rejects.toMatchObject({ code: "LTI_LAUNCH_INVALID" });
  });

  it("rejects platform registration URLs containing credentials or fragments", async () => {
    const repository = new MemoryRepository();
    const currentCreator = await creator(repository);
    await institutionSetup(repository, currentCreator);
    const service = new LtiService(repository, config, new FakeLtiJwtAdapter());

    await expect(
      service.upsertRegistration(currentCreator.workspaceId, {
        ...registrationInput(),
        jwksUrl: "https://reader:secret@lms.example.edu/.well-known/jwks.json",
      }),
    ).rejects.toMatchObject({ code: "LTI_LAUNCH_INVALID" });
    await expect(
      service.upsertRegistration(currentCreator.workspaceId, {
        ...registrationInput(),
        authorizationEndpoint: "https://lms.example.edu/oidc/auth#unexpected",
      }),
    ).rejects.toMatchObject({ code: "LTI_LAUNCH_INVALID" });
  });
});
