import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository, type CreatorContext } from "@openround/db";
import { ConfigSchema } from "../src/config.js";
import { OidcError, OidcService, type OidcClaims, type OidcProvider } from "../src/oidc-service.js";

class FakeOidcProvider implements OidcProvider {
  claims: OidcClaims = {
    issuer: "https://identity.example.edu",
    subject: "institution-subject-42",
    emailHint: "facilitator@example.edu",
  };

  async authorizationUrl(input: { state: string; nonce: string; codeVerifier: string }) {
    expect(input.nonce).toHaveLength(43);
    expect(input.codeVerifier.length).toBeGreaterThanOrEqual(43);
    const url = new URL("https://identity.example.edu/authorize");
    url.searchParams.set("state", input.state);
    return url.href;
  }

  async exchange(input: { currentUrl: URL; state: string; nonce: string; codeVerifier: string }) {
    expect(input.currentUrl.searchParams.get("state")).toBe(input.state);
    expect(input.nonce).toHaveLength(43);
    expect(input.codeVerifier.length).toBeGreaterThanOrEqual(43);
    return this.claims;
  }
}

const config = ConfigSchema.parse({
  NODE_ENV: "test",
  ALLOW_IN_MEMORY: "true",
  WEB_ORIGIN: "http://localhost:3000",
  PUBLIC_API_URL: "http://localhost:4000",
  OIDC_MODE: "generic",
  OIDC_ISSUER: "https://identity.example.edu",
  OIDC_CLIENT_ID: "openround-test",
  OIDC_CLIENT_SECRET: "test-secret",
  OIDC_PROVIDER_NAME: "Example University",
});

async function createCreator(repository: MemoryRepository): Promise<CreatorContext> {
  const tokenHash = `magic-${randomUUID()}`;
  await repository.createMagicToken({
    id: randomUUID(),
    email: "facilitator@example.edu",
    segment: "education",
    tokenHash,
    policyVersion: "test-v1",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, new Date()))!;
}

async function enableOidc(repository: MemoryRepository, workspaceId: string) {
  await repository.updateInstitutionPolicy(
    {
      workspaceId,
      contractStatus: "pilot",
      identityRequirement: "optional",
      capabilities: {
        oidc: true,
        managedSso: false,
        scim: false,
        lti: false,
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

describe("generic OIDC identity binding", () => {
  it("is disabled by default even when a provider is configured", async () => {
    const repository = new MemoryRepository();
    const creator = await createCreator(repository);
    const service = new OidcService(repository, config, new FakeOidcProvider());

    await expect(service.start(creator.workspaceId, "link", creator)).rejects.toMatchObject({
      code: "INSTITUTION_NOT_ENABLED",
    });
  });

  it("requires an authenticated matching creator for account linking", async () => {
    const repository = new MemoryRepository();
    const creator = await createCreator(repository);
    await enableOidc(repository, creator.workspaceId);
    const service = new OidcService(repository, config, new FakeOidcProvider());

    await expect(service.start(creator.workspaceId, "link", null)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("links explicitly, logs in by issuer and subject, and rejects state replay", async () => {
    const repository = new MemoryRepository();
    const creator = await createCreator(repository);
    await enableOidc(repository, creator.workspaceId);
    const service = new OidcService(repository, config, new FakeOidcProvider());

    const linkStart = await service.start(creator.workspaceId, "link", creator);
    const linkState = new URL(linkStart.authorizationUrl).searchParams.get("state")!;
    const linked = await service.callback(
      new URL(`http://localhost:4000/v1/auth/oidc/callback?state=${linkState}&code=test`),
      linkState,
      creator,
    );
    expect(linked).toMatchObject({ mode: "link", creator: { userId: creator.userId } });
    expect(await repository.listExternalIdentities(creator.workspaceId, creator.userId)).toEqual([
      expect.objectContaining({
        issuer: "https://identity.example.edu",
        subject: "institution-subject-42",
      }),
    ]);
    await expect(
      service.callback(
        new URL(`http://localhost:4000/v1/auth/oidc/callback?state=${linkState}&code=test`),
        linkState,
        creator,
      ),
    ).rejects.toBeInstanceOf(OidcError);

    const loginStart = await service.start(creator.workspaceId, "login", null);
    const loginState = new URL(loginStart.authorizationUrl).searchParams.get("state")!;
    const loggedIn = await service.callback(
      new URL(`http://localhost:4000/v1/auth/oidc/callback?state=${loginState}&code=test`),
      loginState,
      null,
    );
    expect(loggedIn).toMatchObject({
      mode: "login",
      creator: { userId: creator.userId, workspaceId: creator.workspaceId },
    });
  });

  it("does not auto-link an unknown subject even when the verified email matches", async () => {
    const repository = new MemoryRepository();
    const creator = await createCreator(repository);
    await enableOidc(repository, creator.workspaceId);
    const provider = new FakeOidcProvider();
    provider.claims = {
      issuer: "https://identity.example.edu",
      subject: "never-linked",
      emailHint: creator.email,
    };
    const service = new OidcService(repository, config, provider);
    const started = await service.start(creator.workspaceId, "login", null);
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;

    await expect(
      service.callback(
        new URL(`http://localhost:4000/v1/auth/oidc/callback?state=${state}&code=test`),
        state,
        null,
      ),
    ).rejects.toMatchObject({ code: "FEDERATED_IDENTITY_NOT_LINKED" });
  });
});
