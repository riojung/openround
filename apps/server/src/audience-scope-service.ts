import {
  AudienceScopeSnapshotSchema,
  audienceRolePermissions,
  type AudienceScopeSnapshot,
} from "@openround/contracts";
import type {
  AudienceScopeRepository,
  PresentationSessionRepository,
  Repository,
} from "@openround/db";
import {
  AudienceAccessError,
  PresentationAudienceAccess,
  RoundAudienceAccess,
  roundAudienceRole,
  type PresentationAudienceActor,
} from "./audience-access.js";
import type { AppConfig } from "./config.js";
import { coreParityCreationEnabled } from "./core-parity-rollout.js";
import type { InteractionService } from "./interaction-service.js";
import type { QnaService } from "./qna-service.js";

const ALIAS_DISCLOSURE =
  "The facilitator and moderators can see your session alias. Anonymous public display hides it from the room, not from moderators.";

export class AudienceScopeService {
  constructor(
    private readonly dependencies: {
      repository: Repository;
      presentations: PresentationSessionRepository;
      scopes: AudienceScopeRepository;
      config: AppConfig;
      interactions: InteractionService;
      qna: QnaService;
    },
  ) {}

  async activatePresentation(sessionId: string, token: string, idempotencyKey: string) {
    const actor = await new PresentationAudienceAccess(
      this.dependencies.presentations,
    ).authenticate(sessionId, token);
    if (actor.role !== "host")
      throw new AudienceAccessError(
        "UNAUTHORIZED",
        "Only a Presentation host pass can activate audience services",
      );
    // Preserve accepted resources and exact activation retries when new creation is paused.
    const existing = await this.dependencies.scopes.get(actor.session.workspaceId, sessionId);
    if (
      !existing &&
      !coreParityCreationEnabled(
        this.dependencies.config,
        actor.session.workspaceId,
        "audienceScopes",
      )
    ) {
      throw new AudienceAccessError(
        "NOT_FOUND",
        "Audience scope activation is not enabled for this workspace",
      );
    }
    const result = await this.dependencies.scopes.activatePresentation({
      workspaceId: actor.session.workspaceId,
      sessionId,
      idempotencyKey,
      now: new Date(),
    });
    return {
      scope: await this.snapshot("presentation", result.scope.id, token),
      created: result.created,
    };
  }

  async snapshot(
    kind: "round" | "presentation",
    scopeId: string,
    token: string,
  ): Promise<AudienceScopeSnapshot> {
    if (kind === "round") {
      const actor = await new RoundAudienceAccess(this.dependencies.repository).authenticate(
        scopeId,
        token,
      );
      // This is an additive alias of retained legacy resources, not a new Round writer gate.
      const [interactions, qnaSettings] = await Promise.all([
        this.dependencies.interactions.getSettingsSnapshot(scopeId, token),
        this.dependencies.repository.getQnaSettings(actor.session.workspaceId, scopeId),
      ]);
      const open = actor.session.state.phase !== "finished" && !interactions.record.closedAt;
      return AudienceScopeSnapshotSchema.parse({
        schemaVersion: 1,
        scopeId,
        kind,
        lifecycle: open ? "open" : "closed",
        identityPolicy: "facilitator_visible_alias",
        identityDisclosure: ALIAS_DISCLOSURE,
        audienceSeq: interactions.record.audienceSeq,
        permissions: audienceRolePermissions(roundAudienceRole(actor), open),
        features: {
          qna: qnaSettings?.enabled ?? true,
          chat: interactions.settings.chatEnabled,
          pulse: interactions.settings.signalsEnabled,
        },
      });
    }
    const actor = await new PresentationAudienceAccess(
      this.dependencies.presentations,
    ).authenticate(scopeId, token);
    return this.presentationSnapshot(actor);
  }

  /** Revalidate distributed socket bindings without passing reusable credentials through Redis. */
  async snapshotPresentationByTokenHash(scopeId: string, tokenHash: string) {
    const actor = await new PresentationAudienceAccess(
      this.dependencies.presentations,
    ).authenticateHash(scopeId, tokenHash);
    return this.presentationSnapshot(actor);
  }

  private async presentationSnapshot(actor: PresentationAudienceActor) {
    const scopeId = actor.session.id;
    const scope = await this.dependencies.scopes.get(actor.session.workspaceId, scopeId);
    if (!scope || scope.expiresAt <= new Date())
      throw new AudienceAccessError("NOT_FOUND", "Audience scope not found");
    return AudienceScopeSnapshotSchema.parse({
      schemaVersion: 1,
      scopeId,
      kind: "presentation",
      lifecycle: actor.session.status === "active" ? "open" : "closed",
      identityPolicy: scope.identityPolicy,
      identityDisclosure: ALIAS_DISCLOSURE,
      audienceSeq: scope.audienceSeq,
      // No Presentation interaction writers ship in this foundation increment.
      permissions: { ...audienceRolePermissions(actor.role, false), read: true },
      features: { qna: false, chat: false, pulse: false },
    });
  }

  async sync(kind: "round" | "presentation", scopeId: string, token: string, limit: number) {
    const scope = await this.snapshot(kind, scopeId, token);
    if (kind === "presentation") return { scope };
    const [interactions, qna] = await Promise.all([
      this.dependencies.interactions.sync(scopeId, token, limit),
      scope.features.qna
        ? this.dependencies.qna.list(scopeId, token, { limit })
        : Promise.resolve(null),
    ]);
    return { scope, round: { interactions, qna } };
  }
}
