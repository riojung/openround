import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type {
  CreatorContext,
  LibraryMetadataRepository,
  PresentationRepository,
  Repository,
} from "@openround/db";
import type { AuthService } from "./auth.js";
import { professionalFeatureUnavailable } from "./workspace-rollout.js";

const FavoriteParamsSchema = z.object({
  artifactType: z.enum(["round", "presentation"]),
  artifactId: z.string().uuid(),
});
const FavoriteMutationSchema = z.object({ favorite: z.boolean() });
const PresentationParamsSchema = z.object({ id: z.string().uuid() });
const PresentationOrganizationSchema = z.object({ folderId: z.string().uuid().nullable() });
const PresentationArchiveSchema = z.object({ archived: z.boolean().default(true) });

function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  requestId: string,
) {
  return reply.code(status).send({ error: { code, message, requestId } });
}

function requireEditor(creator: CreatorContext, reply: FastifyReply, requestId: string) {
  return creator.role === "owner" || creator.role === "editor"
    ? true
    : apiError(
        reply,
        403,
        "UNAUTHORIZED",
        "Your workspace role does not allow this action",
        requestId,
      );
}

export async function registerLibraryRoutes(
  app: FastifyInstance,
  dependencies: {
    repository: Repository;
    presentations: PresentationRepository;
    libraryMetadata: LibraryMetadataRepository;
    auth: AuthService;
    workspaceEnabled: (workspaceId: string) => boolean;
    presentationsEnabled: (workspaceId: string) => boolean;
  },
) {
  const {
    repository,
    presentations,
    libraryMetadata,
    auth,
    workspaceEnabled,
    presentationsEnabled,
  } = dependencies;

  function requireLibraryWorkspace(
    creator: CreatorContext,
    reply: FastifyReply,
    requestId: string,
  ) {
    return workspaceEnabled(creator.workspaceId)
      ? true
      : professionalFeatureUnavailable(reply, requestId, "Library metadata not found");
  }

  app.get("/v1/library/favorites", async (request, reply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireLibraryWorkspace(creator, reply, request.id) !== true) return;
    const workspacePresentationsEnabled = presentationsEnabled(creator.workspaceId);
    const favorites = (
      await libraryMetadata.listFavorites(creator.workspaceId, creator.userId)
    ).filter(
      (favorite) => favorite.artifactType !== "presentation" || workspacePresentationsEnabled,
    );
    return { favorites };
  });

  app.put("/v1/library/favorites/:artifactType/:artifactId", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireLibraryWorkspace(creator, reply, request.id) !== true) return;
    const { artifactType, artifactId } = FavoriteParamsSchema.parse(request.params);
    if (artifactType === "presentation" && !presentationsEnabled(creator.workspaceId)) {
      return apiError(reply, 404, "NOT_FOUND", "Library item not found", request.id);
    }
    const { favorite } = FavoriteMutationSchema.parse(request.body);
    if (favorite) {
      const artifact =
        artifactType === "round"
          ? await repository.getQuiz(creator.workspaceId, artifactId)
          : await presentations.getPresentation(creator.workspaceId, artifactId);
      if (!artifact) {
        return apiError(reply, 404, "NOT_FOUND", "Library item not found", request.id);
      }
    }
    const record = await libraryMetadata.setFavorite({
      workspaceId: creator.workspaceId,
      userId: creator.userId,
      artifactType,
      artifactId,
      favorite,
      now: new Date(),
    });
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: favorite ? "library.favorite.add" : "library.favorite.remove",
      targetType: artifactType === "round" ? "quiz" : "presentation",
      targetId: artifactId,
      requestId: request.id,
    });
    return { favorite: record };
  });

  app.patch("/v1/presentations/:id/organization", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireLibraryWorkspace(creator, reply, request.id) !== true) return;
    if (!presentationsEnabled(creator.workspaceId)) {
      return professionalFeatureUnavailable(reply, request.id, "Presentation not found");
    }
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { id } = PresentationParamsSchema.parse(request.params);
    const { folderId } = PresentationOrganizationSchema.parse(request.body);
    const presentation = await presentations.organizePresentation(
      creator.workspaceId,
      id,
      folderId,
    );
    if (!presentation) {
      return apiError(
        reply,
        404,
        "NOT_FOUND",
        "Presentation or selected folder not found",
        request.id,
      );
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: "presentation.organize",
      targetType: "presentation",
      targetId: presentation.id,
      requestId: request.id,
      metadata: { folderId },
    });
    return { presentation };
  });

  app.post("/v1/presentations/:id/archive", async (request, reply) => {
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return;
    if (requireLibraryWorkspace(creator, reply, request.id) !== true) return;
    if (!presentationsEnabled(creator.workspaceId)) {
      return professionalFeatureUnavailable(reply, request.id, "Presentation not found");
    }
    if (requireEditor(creator, reply, request.id) !== true) return;
    const { id } = PresentationParamsSchema.parse(request.params);
    const { archived } = PresentationArchiveSchema.parse(request.body);
    const presentation = await presentations.archivePresentation(creator.workspaceId, id, archived);
    if (!presentation) {
      return apiError(reply, 404, "NOT_FOUND", "Presentation not found", request.id);
    }
    await repository.recordAudit({
      workspaceId: creator.workspaceId,
      actorId: creator.userId,
      action: archived ? "presentation.archive" : "presentation.restore",
      targetType: "presentation",
      targetId: presentation.id,
      requestId: request.id,
    });
    return { presentation };
  });
}
