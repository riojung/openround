import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository, type RuntimeDatabasePrincipalSecurity } from "@openround/db";
import {
  provisionStagingCapacity,
  stagingCapacityConfirmation,
  validateRestrictedDatabasePrincipal,
  validateStagingCapacityRuntime,
} from "../src/staging-capacity-provision.js";

function stagingRuntime() {
  return {
    NODE_ENV: "production" as const,
    OPENROUND_DEPLOYMENT_ENVIRONMENT: "staging" as const,
    COMMUNITY_MODE: false,
    BILLING_MODE: "disabled" as const,
    MAX_SESSION_PARTICIPANTS: 250,
    ALLOW_IN_MEMORY: false,
    DATABASE_URL: "postgresql://runtime:secret@postgres/openround",
    DATABASE_MIGRATION_URL: undefined,
    OPENROUND_BUILD_ID: "a".repeat(40),
  };
}

function restrictedPrincipal(
  overrides: Partial<RuntimeDatabasePrincipalSecurity> = {},
): RuntimeDatabasePrincipalSecurity {
  return {
    principal: "openround_app",
    sessionPrincipal: "openround_app",
    sessionMatchesCurrent: true,
    runtimeRoleMember: true,
    superuser: false,
    bypassRls: false,
    createRole: false,
    createDatabase: false,
    replication: false,
    privilegedRoleMember: false,
    unexpectedRoleMember: false,
    ownerRoleMember: false,
    ...overrides,
  };
}

function provisioningRepository(repository: MemoryRepository, principal = restrictedPrincipal()) {
  return {
    inspectRuntimeDatabasePrincipal: async () => principal,
    provisionCapacityTestWorkspace: (workspaceId: string, requestId: string) =>
      repository.provisionCapacityTestWorkspace(workspaceId, requestId),
  };
}

async function syntheticWorkspace() {
  const workspaceId = randomUUID();
  const repository = new MemoryRepository({ initialWorkspaceId: workspaceId });
  const tokenHash = `staging-capacity-${randomUUID()}`;
  await repository.createMagicToken({
    id: randomUUID(),
    email: `capacity-${randomUUID()}@example.com`,
    segment: "workplace",
    tokenHash,
    policyVersion: "test-v1",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  await repository.consumeMagicToken(tokenHash, new Date());
  return { repository, workspaceId };
}

describe("staging capacity provisioning", () => {
  it("provisions one exact workspace idempotently and writes one durable audit event", async () => {
    const { repository, workspaceId } = await syntheticWorkspace();
    const operationRepository = provisioningRepository(repository);
    const firstRequestId = `capacity-exercise-${randomUUID()}`;
    const first = await provisionStagingCapacity({
      config: stagingRuntime(),
      enablement: "enabled",
      workspaceId,
      requestId: firstRequestId,
      confirmation: stagingCapacityConfirmation(workspaceId),
      repository: operationRepository,
    });
    const second = await provisionStagingCapacity({
      config: stagingRuntime(),
      enablement: "enabled",
      workspaceId,
      requestId: `capacity-retry-${randomUUID()}`,
      confirmation: stagingCapacityConfirmation(workspaceId),
      repository: operationRepository,
    });

    expect(first).toMatchObject({ workspaceId, previousPlan: "free", plan: "team", changed: true });
    expect(second).toMatchObject({ workspaceId, plan: "team", changed: false });
    expect(await repository.getBillingProfile(workspaceId)).toEqual({
      plan: "team",
      status: "active",
      customerId: null,
      subscriptionId: null,
    });
    expect(await repository.listAuditEvents(workspaceId, null, 10)).toEqual([
      expect.objectContaining({
        workspaceId,
        actorId: null,
        action: "operations.staging_capacity.provision",
        targetType: "workspace",
        targetId: workspaceId,
        requestId: firstRequestId,
        metadata: expect.objectContaining({
          purpose: "target-region-load",
          previousPlan: "free",
          plan: "team",
          maxParticipants: 250,
        }),
      }),
    ]);
  });

  it("refuses unknown or provider-linked workspaces", async () => {
    const { repository, workspaceId } = await syntheticWorkspace();
    await repository.setPlan(workspaceId, "pro", {
      customerId: "cus_real",
      subscriptionId: "sub_real",
      status: "active",
    });

    await expect(
      repository.provisionCapacityTestWorkspace(workspaceId, "capacity-provider-linked"),
    ).rejects.toThrow("provider-linked workspace");
    await expect(
      repository.provisionCapacityTestWorkspace(randomUUID(), "capacity-missing-workspace"),
    ).rejects.toThrow("workspace does not exist");
    expect(await repository.listAuditEvents(workspaceId, null, 10)).toEqual([]);
  });

  it("refuses a non-free workspace even when it has no provider identifiers", async () => {
    const { repository, workspaceId } = await syntheticWorkspace();
    await repository.setPlan(workspaceId, "pro", { status: "active" });

    await expect(
      repository.provisionCapacityTestWorkspace(workspaceId, "capacity-non-free"),
    ).rejects.toThrow("requires an untouched free workspace");
    expect(await repository.getBillingProfile(workspaceId)).toEqual({
      plan: "pro",
      status: "active",
      customerId: null,
      subscriptionId: null,
    });
    expect(await repository.listAuditEvents(workspaceId, null, 10)).toEqual([]);
  });

  it("refuses a pre-existing Team workspace that lacks the provisioning audit marker", async () => {
    const { repository, workspaceId } = await syntheticWorkspace();
    await repository.setPlan(workspaceId, "team", { status: "active" });

    await expect(
      repository.provisionCapacityTestWorkspace(workspaceId, "capacity-unmarked-team"),
    ).rejects.toThrow("without its prior audit marker");
    expect(await repository.listAuditEvents(workspaceId, null, 10)).toEqual([]);
  });

  it("requires a restricted runtime database principal before mutation", async () => {
    const unsafePrincipals: RuntimeDatabasePrincipalSecurity[] = [
      restrictedPrincipal({ sessionPrincipal: "openround_owner", sessionMatchesCurrent: false }),
      restrictedPrincipal({ runtimeRoleMember: false }),
      restrictedPrincipal({ superuser: true }),
      restrictedPrincipal({ bypassRls: true }),
      restrictedPrincipal({ createRole: true }),
      restrictedPrincipal({ createDatabase: true }),
      restrictedPrincipal({ replication: true }),
      restrictedPrincipal({ privilegedRoleMember: true }),
      restrictedPrincipal({ unexpectedRoleMember: true }),
      restrictedPrincipal({ ownerRoleMember: true }),
    ];
    expect(validateRestrictedDatabasePrincipal(restrictedPrincipal())).toEqual(
      restrictedPrincipal(),
    );
    for (const principal of unsafePrincipals) {
      expect(() => validateRestrictedDatabasePrincipal(principal)).toThrow(
        "restricted, non-owner openround_runtime database principal",
      );
    }

    const { repository, workspaceId } = await syntheticWorkspace();
    await expect(
      provisionStagingCapacity({
        config: stagingRuntime(),
        enablement: "enabled",
        workspaceId,
        requestId: "capacity-unsafe-principal",
        confirmation: stagingCapacityConfirmation(workspaceId),
        repository: provisioningRepository(repository, restrictedPrincipal({ superuser: true })),
      }),
    ).rejects.toThrow("restricted, non-owner openround_runtime database principal");
    expect(await repository.getPlan(workspaceId)).toBe("free");
    expect(await repository.listAuditEvents(workspaceId, null, 10)).toEqual([]);
  });

  it("fails closed unless every staging-only runtime guard is present", () => {
    expect(validateStagingCapacityRuntime(stagingRuntime(), "enabled")).toBe(true);
    expect(() => validateStagingCapacityRuntime(stagingRuntime(), undefined)).toThrow(
      "OPENROUND_STAGING_CAPACITY_PROVISIONING",
    );
    expect(() =>
      validateStagingCapacityRuntime(
        { ...stagingRuntime(), OPENROUND_DEPLOYMENT_ENVIRONMENT: "production" },
        "enabled",
      ),
    ).toThrow("restricted to the hosted staging environment");
    expect(() =>
      validateStagingCapacityRuntime({ ...stagingRuntime(), NODE_ENV: "development" }, "enabled"),
    ).toThrow("restricted to the hosted staging environment");
    expect(() =>
      validateStagingCapacityRuntime({ ...stagingRuntime(), COMMUNITY_MODE: true }, "enabled"),
    ).toThrow("COMMUNITY_MODE=false");
    expect(() =>
      validateStagingCapacityRuntime({ ...stagingRuntime(), BILLING_MODE: "stripe" }, "enabled"),
    ).toThrow("BILLING_MODE=disabled");
    expect(() =>
      validateStagingCapacityRuntime(
        { ...stagingRuntime(), MAX_SESSION_PARTICIPANTS: 100 },
        "enabled",
      ),
    ).toThrow("MAX_SESSION_PARTICIPANTS=250");
    expect(() =>
      validateStagingCapacityRuntime(
        { ...stagingRuntime(), DATABASE_MIGRATION_URL: "postgresql://owner@postgres/openround" },
        "enabled",
      ),
    ).toThrow("must not receive the owner migration credential");
    expect(() =>
      validateStagingCapacityRuntime({ ...stagingRuntime(), ALLOW_IN_MEMORY: true }, "enabled"),
    ).toThrow("durable PostgreSQL runtime repository");
    expect(() =>
      validateStagingCapacityRuntime({ ...stagingRuntime(), DATABASE_URL: undefined }, "enabled"),
    ).toThrow("durable PostgreSQL runtime repository");
    expect(() =>
      validateStagingCapacityRuntime(
        { ...stagingRuntime(), OPENROUND_BUILD_ID: "unversioned" },
        "enabled",
      ),
    ).toThrow("immutable Git build ID");
  });

  it("requires the exact workspace and typed confirmation before mutation", async () => {
    const { repository, workspaceId } = await syntheticWorkspace();
    const operationRepository = provisioningRepository(repository);
    await expect(
      provisionStagingCapacity({
        config: stagingRuntime(),
        enablement: "enabled",
        workspaceId,
        requestId: "capacity-exercise-123",
        confirmation: "wrong",
        repository: operationRepository,
      }),
    ).rejects.toThrow("--confirm must exactly match");
    await expect(
      provisionStagingCapacity({
        config: stagingRuntime(),
        enablement: "enabled",
        workspaceId: "not-a-workspace-id",
        requestId: "capacity-exercise-123",
        confirmation: "wrong",
        repository: operationRepository,
      }),
    ).rejects.toThrow();
    expect(await repository.getPlan(workspaceId)).toBe("free");
  });
});
