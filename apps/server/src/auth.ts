import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreatorContext, Repository, Segment } from "@openround/db";
import type { AppConfig } from "./config.js";
import type { Mailer } from "./mailer.js";
import { hashToken, opaqueToken } from "./security.js";

export class AuthService {
  constructor(
    private readonly repository: Repository,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
  ) {}

  private effectiveCreator(creator: CreatorContext): CreatorContext {
    return this.config.COMMUNITY_MODE ? { ...creator, plan: "team" } : creator;
  }

  async requestMagicLink(email: string, segment: Segment) {
    const token = opaqueToken();
    await this.repository.createMagicToken({
      id: randomUUID(),
      email,
      segment,
      tokenHash: hashToken(token),
      policyVersion: this.config.POLICY_VERSION,
      expiresAt: new Date(Date.now() + 15 * 60_000),
      consumedAt: null,
    });
    const verifyUrl = `${this.config.PUBLIC_API_URL}/v1/auth/verify?token=${encodeURIComponent(token)}`;
    await this.mailer.sendMagicLink(email, verifyUrl);
    return this.config.NODE_ENV === "production" ? undefined : verifyUrl;
  }

  async verifyMagicLink(token: string) {
    const creator = await this.repository.consumeMagicToken(hashToken(token), new Date());
    if (!creator) return null;
    const sessionToken = opaqueToken();
    await this.repository.createCreatorSession({
      id: randomUUID(),
      userId: creator.userId,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
    });
    return { creator: this.effectiveCreator(creator), sessionToken };
  }

  setSessionCookie(reply: FastifyReply, token: string) {
    reply.setCookie(this.config.COOKIE_NAME, token, {
      path: "/",
      domain: this.config.COOKIE_DOMAIN,
      httpOnly: true,
      secure:
        this.config.COOKIE_SECURE === "true" ||
        (this.config.COOKIE_SECURE === "auto" && this.config.NODE_ENV === "production"),
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60,
    });
  }

  clearSessionCookie(reply: FastifyReply) {
    reply.clearCookie(this.config.COOKIE_NAME, {
      path: "/",
      domain: this.config.COOKIE_DOMAIN,
    });
  }

  async creatorFromRequest(request: FastifyRequest): Promise<CreatorContext | null> {
    const token = request.cookies[this.config.COOKIE_NAME];
    const creator = token
      ? await this.repository.getCreatorBySession(hashToken(token), new Date())
      : null;
    return creator ? this.effectiveCreator(creator) : null;
  }

  async requireCreator(request: FastifyRequest, reply: FastifyReply) {
    const creator = await this.creatorFromRequest(request);
    if (!creator) {
      await reply.code(401).send({
        error: { code: "UNAUTHORIZED", message: "Sign in required", requestId: request.id },
      });
      return null;
    }
    return creator;
  }

  async logout(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies[this.config.COOKIE_NAME];
    if (token) await this.repository.revokeCreatorSession(hashToken(token));
    this.clearSessionCookie(reply);
  }
}
