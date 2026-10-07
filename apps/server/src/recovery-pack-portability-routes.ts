import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  RecoveryPackExportFormatSchema,
  type RecoveryPackExportReport,
} from "@openround/contracts";
import type { RecoveryPackRepository } from "@openround/db";
import type { AuthService } from "./auth.js";
import { checkpointSetCsv } from "./portability.js";
import { exportQtiPackage } from "./qti.js";
import {
  blockedRecoveryPackExportReport,
  recoveryPackExportProfile,
} from "./recovery-pack-portability.js";

const VersionParams = z.object({ versionId: z.string().uuid() }).strict();
const ReportQuery = z.object({ format: RecoveryPackExportFormatSchema }).strict();

function reportHeaders(reply: FastifyReply, report: RecoveryPackExportReport) {
  return reply
    .header(
      "x-openround-export-report",
      `/v1/recovery-packs/versions/${report.source.packVersionId}/export-report?format=${report.format}`,
    )
    .header(
      "x-openround-export-warnings",
      String(report.findings.filter((finding) => finding.severity === "warning").length),
    );
}

function blocked(reply: FastifyReply, request: FastifyRequest, report: RecoveryPackExportReport) {
  return reportHeaders(reply, report)
    .code(422)
    .send({
      error: {
        code: "VALIDATION_ERROR",
        message: "This Recovery Pack cannot be represented by the supported export profile.",
        requestId: request.id,
        details: { report },
      },
    });
}

/** Read-only exports share the legacy JSON authorization boundary, without authoring gates. */
export async function registerRecoveryPackPortabilityRoutes(
  app: FastifyInstance,
  dependencies: { packs: RecoveryPackRepository; auth: AuthService },
) {
  const { packs, auth } = dependencies;
  const load = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("cache-control", "private, no-store").header("pragma", "no-cache");
    reply.header(
      "access-control-expose-headers",
      "x-request-id, x-trace-id, content-disposition, x-openround-export-report, x-openround-export-warnings",
    );
    const creator = await auth.requireCreator(request, reply);
    if (!creator) return null;
    const { versionId } = VersionParams.parse(request.params);
    const version = await packs.getRecoveryPackVersion(creator.workspaceId, versionId);
    if (!version) {
      reply.code(404).send({
        error: { code: "NOT_FOUND", message: "Pack version not found", requestId: request.id },
      });
      return null;
    }
    return version;
  };
  app.get("/v1/recovery-packs/versions/:versionId/export-report", async (request, reply) => {
    const version = await load(request, reply);
    if (!version) return;
    const { format } = ReportQuery.parse(request.query);
    const { report } = recoveryPackExportProfile(version, format);
    reportHeaders(reply, report);
    return { report };
  });
  app.get("/v1/recovery-packs/versions/:versionId/export.csv", async (request, reply) => {
    const version = await load(request, reply);
    if (!version) return;
    const { report, draft } = recoveryPackExportProfile(version, "csv");
    if (!draft) return blocked(reply, request, report);
    return reportHeaders(reply, report)
      .header("content-type", "text/csv; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="openround-recovery-pack-${version.id}.csv"`,
      )
      .send(checkpointSetCsv(draft));
  });
  app.get("/v1/recovery-packs/versions/:versionId/export.qti.zip", async (request, reply) => {
    const version = await load(request, reply);
    if (!version) return;
    const { report, draft } = recoveryPackExportProfile(version, "qti3");
    if (!draft) return blocked(reply, request, report);
    const result = await exportQtiPackage(draft, { exportReport: report });
    if (!result.archive) return blocked(reply, request, blockedRecoveryPackExportReport(report));
    return reportHeaders(reply, report)
      .header("content-type", "application/zip")
      .header(
        "content-disposition",
        `attachment; filename="openround-recovery-pack-${version.id}.qti.zip"`,
      )
      .send(result.archive);
  });
}
