import { createHmac } from "node:crypto";
import { QuizContentSchema, type CreateRecoveryPackPracticeAssignment } from "@openround/contracts";
import {
  RecoveryPackPracticeAssignmentConflictError,
  WorkspaceDeletionInProgressError,
  type CreatorContext,
  type FollowupAccessRecord,
  type FollowupRecord,
  type RecoveryPackRepository,
  type RecoveryPackPracticeCreationContext,
  type Repository,
} from "@openround/db";
import { FollowupError, followupView } from "./followup-service.js";
import { recoveryPackCopyId, recoveryPackHash } from "./recovery-pack-copies.js";
import { hashToken } from "./security.js";

type PackPracticeInput = CreateRecoveryPackPracticeAssignment;

/** The seed stays in the authenticated request/browser memory; only hashes are persisted. */
function credential(seed: string, workspaceId: string, followupId: string, role: string) {
  return createHmac("sha256", Buffer.from(seed, "base64url"))
    .update(`openround.pack-practice.v1\0${workspaceId}\0${followupId}\0${role}`)
    .digest("base64url");
}

function requestHash(creator: CreatorContext, packId: string, input: PackPracticeInput) {
  return recoveryPackHash({ actorId: creator.userId, packId, input });
}

export class RecoveryPackPracticeService {
  constructor(
    private readonly repository: Repository,
    private readonly packs: RecoveryPackRepository,
  ) {}

  async replay(creator: CreatorContext, packId: string, input: PackPracticeInput) {
    try {
      const record = await this.repository.getRecoveryPackPracticeAssignment(
        creator.workspaceId,
        packId,
        input.mutationId,
        requestHash(creator, packId, input),
      );
      return record
        ? { ...(await this.receipt(record, input)), created: false, productEvent: null }
        : null;
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async create(
    creator: CreatorContext,
    packId: string,
    input: PackPracticeInput,
    retentionDays: number,
    maximumPersonalLinks: number,
    context: RecoveryPackPracticeCreationContext,
    now = new Date(),
  ) {
    try {
      return await this.createNew(
        creator,
        packId,
        input,
        retentionDays,
        maximumPersonalLinks,
        context,
        now,
      );
    } catch (error) {
      // The initial route lookup can miss a concurrently committing request. Resolve its
      // receipt before any source/schedule rejection can make the browser discard its seed.
      const recovered = await this.replay(creator, packId, input);
      if (recovered) return recovered;
      this.rethrowConflict(error);
    }
  }

  private async createNew(
    creator: CreatorContext,
    packId: string,
    input: PackPracticeInput,
    retentionDays: number,
    maximumPersonalLinks: number,
    context: RecoveryPackPracticeCreationContext,
    now: Date,
  ) {
    const pack = await this.packs.getRecoveryPack(creator.workspaceId, packId);
    if (!pack) throw new FollowupError("NOT_FOUND", "Recovery Pack not found");
    if (!pack.currentVersionId || pack.currentVersionId !== input.sourcePackVersionId) {
      throw new FollowupError(
        "CONFLICT",
        "The published Pack changed. Refresh before assigning practice",
      );
    }
    const version = await this.packs.getRecoveryPackVersion(
      creator.workspaceId,
      input.sourcePackVersionId,
    );
    if (!version || version.packId !== packId) {
      throw new FollowupError("CONFLICT", "The published Pack version is unavailable");
    }
    const source = version.content.delayedProbe;
    if (!source) {
      throw new FollowupError(
        "CONFLICT",
        "This published Pack has no delayed probe. Add and publish one before assigning practice",
      );
    }
    if (input.personalLabels.length > maximumPersonalLinks) {
      throw new FollowupError(
        "ANSWER_INVALID",
        `This plan supports up to ${maximumPersonalLinks} personal practice links`,
      );
    }
    const opensAt = input.opensAt ? new Date(input.opensAt) : now;
    const closesAt = new Date(input.closesAt);
    const expiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60_000);
    if (closesAt <= now || closesAt <= opensAt) {
      throw new FollowupError("ANSWER_INVALID", "Choose a future close time after the open time");
    }
    if (closesAt > expiresAt) {
      throw new FollowupError(
        "ANSWER_INVALID",
        `The practice assignment must close within the ${retentionDays}-day retention window`,
      );
    }
    const id = recoveryPackCopyId(`${creator.workspaceId}:${packId}:${input.mutationId}:practice`);
    const title = (input.title ?? `Practice: ${version.content.title}`).slice(0, 160);
    const question = structuredClone(source);
    question.id = recoveryPackCopyId(`${id}:delayed-probe`);
    question.delivery = "main";
    question.linkedRecheckQuestionId = null;
    question.recoveryPackSource = {
      artifactType: "recovery_pack",
      packId,
      packVersionId: version.id,
      packVersion: version.version,
      sourceItemId: source.id,
      role: "delayed_probe",
      contentHash: recoveryPackHash(source),
    };
    if ("choices" in question) {
      question.choices = question.choices.map((choice) => ({
        ...choice,
        id: recoveryPackCopyId(`${id}:choice:${choice.id}`),
      }));
    }
    const genericToken = credential(input.accessSeed, creator.workspaceId, id, "generic");
    const followup: Extract<FollowupRecord, { purpose: "assignment" }> = {
      id,
      workspaceId: creator.workspaceId,
      purpose: "assignment",
      sourceQuizVersionId: null,
      recoveryPackSource: {
        artifactType: "recovery_pack",
        packId,
        packVersionId: version.id,
        packVersion: version.version,
        contentHash: version.contentHash,
        packTitle: version.content.title,
        publishedAt: version.publishedAt.toISOString(),
        sourceItemId: source.id,
        role: "delayed_probe",
      },
      creationMutation: {
        mutationId: input.mutationId,
        requestHash: requestHash(creator, packId, input),
      },
      sourceSessionId: null,
      sourceReportId: null,
      trustMode: "learning",
      title,
      content: QuizContentSchema.parse({
        title,
        description: "Standalone Recovery Pack delayed probe",
        questions: [question],
      }),
      conceptKeys: [],
      timeMode: input.timeMode,
      genericTokenHash: hashToken(genericToken),
      opensAt,
      closesAt,
      expiresAt,
      closedAt: null,
      createdBy: creator.userId,
      createdAt: now,
    };
    const access: FollowupAccessRecord[] = input.personalLabels.map((label, index) => ({
      id: recoveryPackCopyId(`${id}:personal:${index}`),
      workspaceId: creator.workspaceId,
      followupId: id,
      sourceParticipantId: null,
      kind: "assignment_personal",
      label,
      tokenHash: hashToken(
        credential(input.accessSeed, creator.workspaceId, id, `personal:${index}`),
      ),
      timeMultiplier: 1,
      expiresAt: closesAt,
      revokedAt: null,
      createdAt: now,
    }));
    try {
      const stored = await this.repository.createRecoveryPackPracticeAssignment(
        packId,
        followup,
        access,
        context,
      );
      if (!stored) {
        throw new FollowupError(
          "CONFLICT",
          "The published Pack changed. Refresh before assigning practice",
        );
      }
      return {
        ...(await this.receipt(stored.followup, input)),
        created: stored.created,
        productEvent: stored.productEvent,
      };
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  private async receipt(record: FollowupRecord, input: PackPracticeInput) {
    const access = await this.repository.listFollowupAccess(record.workspaceId, record.id);
    const original = new Map(
      input.personalLabels.map((_label, index) => [
        recoveryPackCopyId(`${record.id}:personal:${index}`),
        index,
      ]),
    );
    return {
      followup: followupView(record),
      genericToken: credential(input.accessSeed, record.workspaceId, record.id, "generic"),
      personalAccess: access.flatMap((item) => {
        const index = original.get(item.id);
        // Never resurrect revoked links or return credentials for subsequently created passes.
        if (index === undefined || item.revokedAt) return [];
        return [
          {
            id: item.id,
            kind: item.kind,
            participantId: null,
            nickname: null,
            label: item.label,
            timeMultiplier: item.timeMultiplier,
            expiresAt: item.expiresAt.toISOString(),
            revokedAt: null,
            token: credential(input.accessSeed, record.workspaceId, record.id, `personal:${index}`),
          },
        ];
      }),
    };
  }

  private rethrowConflict(error: unknown): never {
    if (error instanceof WorkspaceDeletionInProgressError) {
      throw new FollowupError(
        "CONFLICT",
        "Workspace deletion is in progress. New practice assignments are blocked",
      );
    }
    if (error instanceof RecoveryPackPracticeAssignmentConflictError) {
      throw new FollowupError(
        "CONFLICT",
        "This assignment creation ID was already used for a different request",
      );
    }
    throw error;
  }
}
