import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecoveryPackDraft } from "@openround/contracts";
import {
  MemoryRepository,
  type RecoveryPackRecord,
  type RecoveryPackVersionRecord,
} from "@openround/db";
import { buildApp } from "../src/app.js";
import { MemorySessionCache } from "../src/cache.js";
import { ConfigSchema } from "../src/config.js";
import { AuthService } from "../src/auth.js";
import { hashToken } from "../src/security.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

function draft(): RecoveryPackDraft {
  const question = (prompt: string) => ({
    id: randomUUID(),
    type: "single_select" as const,
    prompt,
    purpose: "diagnostic" as const,
    confidence: "off" as const,
    delivery: "main" as const,
    conceptKeys: ["ratio"],
    linkedRecheckQuestionId: null as string | null,
    timeLimitSeconds: 30,
    basePoints: 100,
    explanation: "Private probe rationale.",
    mediaId: null,
    mediaAlt: null,
    choices: [
      { id: randomUUID(), label: "Evidence", isCorrect: true },
      { id: randomUUID(), label: "Assumption", isCorrect: false },
    ],
  });
  const recheck = { ...question("Different immediate scenario?"), delivery: "recheck" as const };
  return {
    schemaVersion: 1,
    title: "Probe Pack",
    description: "",
    diagnostic: { ...question("Hidden diagnostic?"), linkedRecheckQuestionId: recheck.id },
    interventions: [
      { id: randomUUID(), title: "Private card", body: "Hidden intervention body.", citations: [] },
    ],
    recheck,
    delayedProbe: question("What evidence remains tomorrow?"),
    conceptKeys: ["ratio"],
    misconceptionKeys: [],
    citations: [],
  };
}

async function signIn(app: FastifyInstance, email = "pack-practice@example.com") {
  const magic = await app.inject({
    method: "POST",
    url: "/v1/auth/magic-link",
    payload: { email, segment: "workplace", acceptPolicies: true },
  });
  const token = new URL(magic.json<{ debugUrl: string }>().debugUrl).searchParams.get("token")!;
  const verified = await app.inject({ method: "GET", url: `/v1/auth/verify?token=${token}` });
  const cookies = verified.headers["set-cookie"]!;
  return (Array.isArray(cookies) ? cookies[0]! : cookies).split(";")[0]!;
}

async function application(
  repository: MemoryRepository,
  workspaceId: string,
  flags = true,
  allowlisted = true,
) {
  const { app } = await buildApp(
    ConfigSchema.parse({
      NODE_ENV: "test",
      ALLOW_IN_MEMORY: "true",
      COMMUNITY_MODE: "false",
      LOG_LEVEL: "silent",
      WEB_ORIGIN: "http://localhost:3000",
      PUBLIC_API_URL: "http://localhost:4000",
      FEATURE_UX_BETA: String(flags),
      FEATURE_RECOVERY_PACKS: String(flags),
      FEATURE_PRACTICE_ASSIGNMENTS: String(flags),
      UX_BETA_WORKSPACE_ALLOWLIST: allowlisted ? workspaceId : "",
      EVIDENCE_FEATURES_WORKSPACE_ALLOWLIST: allowlisted ? workspaceId : "",
    }),
    { repository, cache: new MemorySessionCache() },
  );
  apps.push(app);
  return app;
}

async function fixture(content = draft()) {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId, initialPlan: "pro" });
  const app = await application(repository, workspaceId);
  const cookie = await signIn(app);
  const created = await app.inject({
    method: "POST",
    url: "/v1/recovery-packs",
    headers: { cookie },
    payload: { draft: content },
  });
  expect(created.statusCode).toBe(201);
  const pack = created.json<{ pack: RecoveryPackRecord }>().pack;
  const published = await app.inject({
    method: "POST",
    url: `/v1/recovery-packs/${pack.id}/publish`,
    headers: { cookie },
    payload: { expectedDraftRevision: 0 },
  });
  expect(published.statusCode).toBe(200);
  const version = published.json<{ version: RecoveryPackVersionRecord }>().version;
  const input = {
    sourcePackVersionId: version.id,
    mutationId: randomUUID(),
    accessSeed: randomBytes(32).toString("base64url"),
    title: "Check tomorrow",
    timeMode: "flex",
    closesAt: new Date(Date.now() + 86_400_000).toISOString(),
    personalLabels: ["Second label", "First label"],
  };
  const url = `/v1/recovery-packs/${pack.id}/practice-assignments`;
  return { app, repository, workspaceId, cookie, pack, version, input, url };
}

describe("Recovery Pack delayed-probe practice", () => {
  it("copies only the published probe, keeps provenance, and uses the private accountless runner", async () => {
    const { app, repository, workspaceId, cookie, version, input, url } = await fixture();
    const response = await app.inject({ method: "POST", url, headers: { cookie }, payload: input });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const receipt = response.json();
    expect(Object.keys(receipt).sort()).toEqual(["followup", "genericUrl", "personalAccess"]);
    expect(receipt.followup).toMatchObject({
      purpose: "assignment",
      trustMode: "learning",
      sourceQuizVersionId: null,
      checkpointCount: 1,
      recoveryPackSource: {
        packVersionId: version.id,
        role: "delayed_probe",
        sourceItemId: version.content.delayedProbe!.id,
        contentHash: version.contentHash,
      },
    });
    expect(receipt.genericUrl).toContain("#token=");
    expect(receipt.personalAccess).toHaveLength(2);
    const record = repository.followups.get(receipt.followup.id)!;
    expect(record.content.questions).toHaveLength(1);
    expect(record.content.questions[0]!.prompt).toBe(version.content.delayedProbe!.prompt);
    expect(record.content.questions[0]!.id).not.toBe(version.content.delayedProbe!.id);
    expect(record.content.questions[0]!.recoveryPackSource).toMatchObject({
      role: "delayed_probe",
      sourceItemId: version.content.delayedProbe!.id,
    });
    expect(JSON.stringify(record)).not.toContain(input.accessSeed);
    expect(JSON.stringify(record)).not.toContain(new URL(receipt.genericUrl).hash.slice(7));
    expect(await repository.listQuizzes(workspaceId)).toHaveLength(0);

    const token = new URLSearchParams(new URL(receipt.personalAccess[0].url).hash.slice(1)).get(
      "token",
    )!;
    const start = await app.inject({
      method: "POST",
      url: `/v1/followups/${record.id}/start`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(start.statusCode).toBe(201);
    const initial = start.json();
    expect(initial.snapshot.phase).toBe("question_open");
    expect(initial.snapshot.deadline).toBeNull();
    for (const hidden of [
      "isCorrect",
      "Private probe rationale",
      "Hidden diagnostic",
      "Hidden intervention body",
      "recoveryPackSource",
      "packVersionId",
    ]) {
      expect(start.body).not.toContain(hidden);
    }
    const question = record.content.questions[0]!;
    if (question.type !== "single_select") throw new Error("Expected choice probe");
    const payload = {
      idempotencyKey: randomUUID(),
      response: {
        kind: "choice",
        choiceIds: [question.choices.find((choice) => choice.isCorrect)!.id],
      },
    };
    const answer = () =>
      app.inject({
        method: "POST",
        url: `/v1/followups/${record.id}/answers`,
        headers: { authorization: `Bearer ${initial.attemptToken}` },
        payload,
      });
    const accepted = await answer();
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().snapshot).toMatchObject({
      phase: "answer_reveal",
      correct: true,
      explanation: "Private probe rationale.",
    });
    expect((await answer()).json()).toEqual(accepted.json());
    expect(repository.followupAnswers.size).toBe(1);
    const resume = await app.inject({
      method: "GET",
      url: `/v1/followups/${record.id}/snapshot`,
      headers: { authorization: `Bearer ${initial.attemptToken}` },
    });
    expect(resume.json()).toEqual(accepted.json());
    const completed = await app.inject({
      method: "POST",
      url: `/v1/followups/${record.id}/advance`,
      headers: { authorization: `Bearer ${initial.attemptToken}` },
    });
    expect(completed.json().snapshot).toMatchObject({ phase: "completed", status: "completed" });
    const detail = await app.inject({
      method: "GET",
      url: `/v1/followups/${record.id}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().context).toMatchObject({
      sourceType: "recovery_pack",
      packTitle: "Probe Pack",
      version: 1,
    });
    expect(detail.json()).toMatchObject({ attemptCount: 1, completedAttemptCount: 1 });
    expect(JSON.stringify(repository.audits)).not.toContain(input.accessSeed);
  });

  it("replays concurrent creation without duplicate assignments or mismatched recipient credentials", async () => {
    const { app, repository, cookie, input, url } = await fixture();
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        app.inject({ method: "POST", url, headers: { cookie }, payload: input }),
      ),
    );
    expect(results.map((item) => item.statusCode)).toEqual([201, 201, 201]);
    for (const response of results) expect(response.json()).toEqual(results[0]!.json());
    expect(repository.followups.size).toBe(1);
    expect(repository.followupAccess.size).toBe(2);
    expect(
      repository.audits.filter(
        (event) => event.action === "recovery_pack.practice_assignment.create",
      ),
    ).toHaveLength(1);
    await expect
      .poll(
        () =>
          repository.productEvents.filter((event) => event.name === "practice_assignment_created")
            .length,
      )
      .toBe(1);
    const receipt = results[0]!.json();
    for (const item of receipt.personalAccess) {
      const token = new URLSearchParams(new URL(item.url).hash.slice(1)).get("token")!;
      const stored = await repository.getFollowupAccessByToken(
        receipt.followup.id,
        hashToken(token),
        new Date(),
      );
      expect(stored).toMatchObject({ id: item.id, label: item.label });
    }
    const conflict = await app.inject({
      method: "POST",
      url,
      headers: { cookie },
      payload: { ...input, title: "Different request" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(repository.followups.size).toBe(1);
  });

  it.each(["republished", "deleted"] as const)(
    "recovers an overlapping commit when the source is %s after the initial receipt miss",
    async (change) => {
      const { app, repository, cookie, input, url, pack } = await fixture();
      const getReceipt = repository.getRecoveryPackPracticeAssignment.bind(repository);
      let lookupMissed!: () => void;
      let releaseLookup!: () => void;
      const missed = new Promise<void>((resolve) => {
        lookupMissed = resolve;
      });
      const released = new Promise<void>((resolve) => {
        releaseLookup = resolve;
      });
      vi.spyOn(repository, "getRecoveryPackPracticeAssignment").mockImplementationOnce(
        async (...args) => {
          const empty = await getReceipt(...args);
          expect(empty).toBeNull();
          lookupMissed();
          await released;
          return empty;
        },
      );
      const pending = app.inject({ method: "POST", url, headers: { cookie }, payload: input });
      // Start the lazy injection before waiting for its paused lookup.
      const retry = pending.then((response) => response);
      await missed;
      const committed = await app.inject({
        method: "POST",
        url,
        headers: { cookie },
        payload: input,
      });
      try {
        expect(committed.statusCode).toBe(201);
        if (change === "deleted") {
          expect(
            (
              await app.inject({
                method: "DELETE",
                url: `/v1/recovery-packs/${pack.id}`,
                headers: { cookie },
              })
            ).statusCode,
          ).toBe(204);
        } else {
          expect(
            (
              await app.inject({
                method: "PUT",
                url: `/v1/recovery-packs/${pack.id}/draft`,
                headers: { cookie },
                payload: {
                  draft: { ...pack.draft, title: "Republished probe Pack" },
                  expectedRevision: 0,
                  mutationId: randomUUID(),
                },
              })
            ).statusCode,
          ).toBe(200);
          expect(
            (
              await app.inject({
                method: "POST",
                url: `/v1/recovery-packs/${pack.id}/publish`,
                headers: { cookie },
                payload: { expectedDraftRevision: 1 },
              })
            ).statusCode,
          ).toBe(200);
        }
      } finally {
        releaseLookup();
      }
      const recovered = await retry;
      expect(recovered.statusCode).toBe(201);
      expect(recovered.json()).toEqual(committed.json());
      expect(repository.followups.size).toBe(1);
      expect(
        repository.audits.filter(
          (event) => event.action === "recovery_pack.practice_assignment.create",
        ),
      ).toHaveLength(1);
      await expect
        .poll(
          () =>
            repository.productEvents.filter((event) => event.name === "practice_assignment_created")
              .length,
        )
        .toBe(1);
    },
  );

  it.each(["recordAudit", "recordProductEvents"] as const)(
    "rolls back assignment and evidence on %s failure, then retries exactly once",
    async (method) => {
      const { app, repository, workspaceId, cookie, input, url } = await fixture();
      vi.spyOn(repository, method).mockRejectedValueOnce(
        new Error("creation evidence unavailable"),
      );
      const failed = await app.inject({ method: "POST", url, headers: { cookie }, payload: input });
      expect(failed.statusCode).toBe(500);
      expect(repository.followups.size).toBe(0);
      expect(repository.followupAccess.size).toBe(0);
      expect(
        [...repository.mediaReferences.values()].filter(
          (reference) => reference.ownerType === "followup",
        ),
      ).toHaveLength(0);
      expect(
        repository.audits.filter(
          (event) => event.action === "recovery_pack.practice_assignment.create",
        ),
      ).toHaveLength(0);
      expect(
        repository.productEvents.filter((event) => event.name === "practice_assignment_created"),
      ).toHaveLength(0);

      const accepted = await app.inject({
        method: "POST",
        url,
        headers: { cookie },
        payload: input,
      });
      expect(accepted.statusCode).toBe(201);
      expect(repository.followups.size).toBe(1);
      expect(repository.followupAccess.size).toBe(2);
      expect(
        repository.audits.filter(
          (event) => event.action === "recovery_pack.practice_assignment.create",
        ),
      ).toHaveLength(1);
      expect(
        repository.productEvents.filter((event) => event.name === "practice_assignment_created"),
      ).toHaveLength(1);
      const restarted = await application(repository, workspaceId, false, false);
      const replay = await restarted.inject({
        method: "POST",
        url,
        headers: { cookie },
        payload: input,
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.json()).toEqual(accepted.json());
      expect(
        repository.audits.filter(
          (event) => event.action === "recovery_pack.practice_assignment.create",
        ),
      ).toHaveLength(1);
      expect(
        repository.productEvents.filter((event) => event.name === "practice_assignment_created"),
      ).toHaveLength(1);
    },
  );

  it("recovers a receipt after source deletion, feature pause and plan downgrade, retaining history/context", async () => {
    const { app, repository, workspaceId, cookie, input, url, pack } = await fixture();
    const first = await app.inject({ method: "POST", url, headers: { cookie }, payload: input });
    expect(first.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/v1/recovery-packs/${pack.id}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(204);
    await repository.setPlan(workspaceId, "free");
    const paused = await application(repository, workspaceId, false, false);
    const replay = await paused.inject({
      method: "POST",
      url,
      headers: { cookie },
      payload: input,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const rejected = await paused.inject({
      method: "POST",
      url,
      headers: { cookie },
      payload: { ...input, mutationId: randomUUID() },
    });
    expect(rejected.statusCode).toBe(404);
    const id = first.json().followup.id;
    const detail = await paused.inject({
      method: "GET",
      url: `/v1/followups/${id}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().context).toMatchObject({
      sourceType: "recovery_pack",
      packId: pack.id,
      packTitle: "Probe Pack",
    });
    const history = await paused.inject({
      method: "GET",
      url: "/v1/followups?purpose=assignment",
      headers: { cookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items).toContainEqual(
      expect.objectContaining({
        id,
        quizId: null,
        sourceQuizVersionId: null,
        recoveryPackSource: expect.objectContaining({ packId: pack.id }),
      }),
    );
    const token = new URLSearchParams(new URL(replay.json().genericUrl).hash.slice(1)).get(
      "token",
    )!;
    expect(
      (
        await paused.inject({
          method: "POST",
          url: `/v1/followups/${id}/start`,
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(201);
  });

  it("does not revive revoked personal passes or expose later passes during receipt recovery", async () => {
    const { app, repository, workspaceId, cookie, input, url } = await fixture();
    const response = await app.inject({ method: "POST", url, headers: { cookie }, payload: input });
    const original = response.json();
    const revoked = original.personalAccess[0];
    const revokedToken = new URLSearchParams(new URL(revoked.url).hash.slice(1)).get("token")!;
    await repository.revokeFollowupAccess(
      workspaceId,
      original.followup.id,
      revoked.id,
      new Date(),
    );
    const later = await app.inject({
      method: "POST",
      url: `/v1/followups/${original.followup.id}/personal-passes`,
      headers: { cookie },
      payload: { label: "Added later" },
    });
    expect(later.statusCode).toBe(201);
    const replay = await app.inject({ method: "POST", url, headers: { cookie }, payload: input });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().personalAccess).toEqual(
      original.personalAccess.filter((item: { id: string }) => item.id !== revoked.id),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/followups/${original.followup.id}/start`,
          headers: { authorization: `Bearer ${revokedToken}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("rejects missing probes, stale Pack versions and invalid personal-link/window requests without a write", async () => {
    const content = draft();
    content.delayedProbe = null;
    const { app, repository, cookie, input, url, pack } = await fixture(content);
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie }, payload: input })).statusCode,
    ).toBe(409);
    expect(repository.followups.size).toBe(0);
    const updated = { ...content, delayedProbe: draft().delayedProbe };
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/v1/recovery-packs/${pack.id}/draft`,
          headers: { cookie },
          payload: { draft: updated, expectedRevision: 0, mutationId: randomUUID() },
        })
      ).statusCode,
    ).toBe(200);
    const published = await app.inject({
      method: "POST",
      url: `/v1/recovery-packs/${pack.id}/publish`,
      headers: { cookie },
      payload: { expectedDraftRevision: 1 },
    });
    expect(published.statusCode).toBe(200);
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie }, payload: input })).statusCode,
    ).toBe(409);
    const current = { ...input, sourcePackVersionId: published.json().version.id };
    for (const payload of [
      { ...current, closesAt: new Date(Date.now() - 1_000).toISOString() },
      { ...current, closesAt: new Date(Date.now() + 366 * 86_400_000).toISOString() },
      { ...current, accessSeed: "predictable" },
      { ...current, personalLabels: ["Same", "same"] },
    ]) {
      expect(
        (await app.inject({ method: "POST", url, headers: { cookie }, payload })).statusCode,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(repository.followups.size).toBe(0);
  });

  it("enforces editor role, tenant boundaries, both allowlists and entitlement for new assignments", async () => {
    const { app, repository, workspaceId, cookie, input, url } = await fixture();
    const auth = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    const viewer = vi
      .spyOn(AuthService.prototype, "requireCreator")
      .mockResolvedValue({ ...auth.json().creator, role: "viewer" });
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie }, payload: input })).statusCode,
    ).toBe(403);
    viewer.mockRestore();
    const otherCookie = await signIn(app, "another-pack-workspace@example.com");
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie: otherCookie }, payload: input }))
        .statusCode,
    ).toBe(404);
    const unlisted = await application(repository, workspaceId, true, false);
    expect(
      (await unlisted.inject({ method: "POST", url, headers: { cookie }, payload: input }))
        .statusCode,
    ).toBe(404);
    await repository.setPlan(workspaceId, "free");
    expect(
      (await app.inject({ method: "POST", url, headers: { cookie }, payload: input })).statusCode,
    ).toBe(402);
    expect(repository.followups.size).toBe(0);
  });
});
