import { randomUUID } from "node:crypto";
import * as oidc from "openid-client";
import type { CreatorContext, Repository } from "@openround/db";
import type { AppConfig } from "./config.js";
import { hashToken } from "./security.js";

export type OidcErrorCode =
  | "FEDERATED_AUTH_DISABLED"
  | "FEDERATED_IDENTITY_NOT_LINKED"
  | "FEDERATED_AUTH_REPLAYED"
  | "INSTITUTION_NOT_ENABLED"
  | "UNAUTHORIZED"
  | "CONFLICT";

export class OidcError extends Error {
  constructor(
    public readonly code: OidcErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OidcError";
  }
}

export interface OidcClaims {
  issuer: string;
  subject: string;
  emailHint: string | null;
}

export interface OidcProvider {
  authorizationUrl(input: { state: string; nonce: string; codeVerifier: string }): Promise<string>;
  exchange(input: {
    currentUrl: URL;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<OidcClaims>;
}

export class GenericOidcProvider implements OidcProvider {
  private configurationPromise: Promise<oidc.Configuration> | null = null;
  private readonly callbackUrl: string;

  constructor(private readonly config: AppConfig) {
    this.callbackUrl = new URL("/v1/auth/oidc/callback", config.PUBLIC_API_URL).href;
  }

  private configuration() {
    if (!this.configurationPromise) {
      const clientAuthentication =
        this.config.OIDC_CLIENT_AUTH === "none"
          ? oidc.None()
          : this.config.OIDC_CLIENT_AUTH === "client_secret_basic"
            ? oidc.ClientSecretBasic(this.config.OIDC_CLIENT_SECRET)
            : oidc.ClientSecretPost(this.config.OIDC_CLIENT_SECRET);
      this.configurationPromise = oidc
        .discovery(
          new URL(this.config.OIDC_ISSUER!),
          this.config.OIDC_CLIENT_ID!,
          {
            client_secret: this.config.OIDC_CLIENT_SECRET,
            redirect_uris: [this.callbackUrl],
            response_types: ["code"],
          },
          clientAuthentication,
        )
        .then((configuration) => {
          configuration.timeout = 10;
          return configuration;
        });
    }
    return this.configurationPromise;
  }

  async authorizationUrl(input: { state: string; nonce: string; codeVerifier: string }) {
    const configuration = await this.configuration();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(input.codeVerifier);
    return oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.callbackUrl,
      response_type: "code",
      scope: "openid email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state: input.state,
      nonce: input.nonce,
    }).href;
  }

  async exchange(input: {
    currentUrl: URL;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<OidcClaims> {
    const configuration = await this.configuration();
    const tokens = await oidc.authorizationCodeGrant(configuration, input.currentUrl, {
      pkceCodeVerifier: input.codeVerifier,
      expectedState: input.state,
      expectedNonce: input.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.iss || !claims.sub) throw new Error("OIDC provider did not return an identity");
    const emailHint =
      typeof claims.email === "string" && claims.email_verified === true ? claims.email : null;
    return { issuer: claims.iss, subject: claims.sub, emailHint };
  }
}

export class OidcService {
  constructor(
    private readonly repository: Repository,
    private readonly config: AppConfig,
    private readonly provider: OidcProvider | null,
  ) {}

  async status(workspaceId: string) {
    const policy = await this.repository.getInstitutionPolicy(workspaceId);
    return {
      enabled:
        this.config.OIDC_MODE === "generic" &&
        Boolean(this.provider) &&
        policy.contractStatus !== "disabled" &&
        policy.capabilities.oidc,
      providerName: this.config.OIDC_MODE === "generic" ? this.config.OIDC_PROVIDER_NAME : null,
      workspaceId,
      identityRequirement: policy.identityRequirement,
    };
  }

  async start(workspaceId: string, mode: "login" | "link", creator: CreatorContext | null) {
    const status = await this.status(workspaceId);
    if (!status.enabled || !this.provider) {
      throw new OidcError(
        status.identityRequirement === "guest"
          ? "INSTITUTION_NOT_ENABLED"
          : "FEDERATED_AUTH_DISABLED",
        "Institution sign-in is not enabled for this workspace",
      );
    }
    if (mode === "link" && (!creator || creator.workspaceId !== workspaceId)) {
      throw new OidcError("UNAUTHORIZED", "Sign in to this workspace before linking an identity");
    }

    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const now = new Date();
    await this.repository.createFederatedAuthTransaction({
      id: randomUUID(),
      workspaceId,
      userId: mode === "link" ? creator!.userId : null,
      mode,
      stateHash: hashToken(state),
      codeVerifier,
      nonce,
      expiresAt: new Date(now.getTime() + this.config.OIDC_TRANSACTION_TTL_SECONDS * 1_000),
      createdAt: now,
    });
    return {
      authorizationUrl: await this.provider.authorizationUrl({ state, nonce, codeVerifier }),
    };
  }

  async callback(currentUrl: URL, state: string, creator: CreatorContext | null) {
    if (!this.provider || this.config.OIDC_MODE !== "generic") {
      throw new OidcError("FEDERATED_AUTH_DISABLED", "Institution sign-in is disabled");
    }
    const transaction = await this.repository.consumeFederatedAuthTransaction(
      hashToken(state),
      new Date(),
    );
    if (!transaction) {
      throw new OidcError(
        "FEDERATED_AUTH_REPLAYED",
        "This institution sign-in request is invalid, expired, or already used",
      );
    }
    const status = await this.status(transaction.workspaceId);
    if (!status.enabled) {
      throw new OidcError(
        "INSTITUTION_NOT_ENABLED",
        "Institution sign-in is no longer enabled for this workspace",
      );
    }
    if (
      transaction.mode === "link" &&
      (!creator ||
        creator.userId !== transaction.userId ||
        creator.workspaceId !== transaction.workspaceId)
    ) {
      throw new OidcError(
        "UNAUTHORIZED",
        "Return in the same signed-in browser to link this institution identity",
      );
    }

    let claims: OidcClaims;
    try {
      claims = await this.provider.exchange({
        currentUrl,
        state,
        nonce: transaction.nonce,
        codeVerifier: transaction.codeVerifier,
      });
    } catch (cause) {
      throw new OidcError(
        "UNAUTHORIZED",
        "The institution identity provider could not verify this sign-in",
        { cause },
      );
    }
    let identity = await this.repository.getExternalIdentity(
      transaction.workspaceId,
      "oidc",
      claims.issuer,
      claims.subject,
    );
    if (transaction.mode === "link") {
      identity = await this.repository.linkExternalIdentity({
        id: randomUUID(),
        workspaceId: transaction.workspaceId,
        userId: transaction.userId!,
        provider: "oidc",
        issuer: claims.issuer,
        subject: claims.subject,
        emailHint: claims.emailHint,
        linkedAt: new Date(),
        lastUsedAt: new Date(),
      });
      if (!identity) {
        throw new OidcError(
          "CONFLICT",
          "This institution identity is already linked to another account",
        );
      }
    } else if (!identity) {
      throw new OidcError(
        "FEDERATED_IDENTITY_NOT_LINKED",
        "This institution identity is not linked. Sign in by email first and link it in Account",
      );
    }

    const resolvedCreator = await this.repository.getCreatorByUserId(
      identity.userId,
      transaction.workspaceId,
    );
    if (!resolvedCreator) {
      throw new OidcError("UNAUTHORIZED", "Workspace membership is no longer active");
    }
    await this.repository.touchExternalIdentity(identity.id, new Date());
    return { creator: resolvedCreator, identity, mode: transaction.mode };
  }
}
