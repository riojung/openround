import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCollaborationGroupRepository, MemoryRepository } from "../src/index.js";

async function createOwner(repository: MemoryRepository, label: string, now: Date) {
  const tokenHash = `${label}-${randomUUID()}`;
  await repository.createMagicToken({
    id: randomUUID(),
    email: `${label}-${randomUUID()}@example.com`,
    segment: "workplace",
    tokenHash,
    policyVersion: "test-v1",
    expiresAt: new Date(now.getTime() + 60_000),
    consumedAt: null,
  });
  return (await repository.consumeMagicToken(tokenHash, now))!;
}

describe("collaboration Group account lifecycle", () => {
  it("promotes a deterministic successor and deletes groups with no members", async () => {
    const repository = new MemoryRepository();
    const groups = createCollaborationGroupRepository(repository);
    const now = new Date("2026-09-20T12:00:00.000Z");
    const workspaceOwner = await createOwner(repository, "workspace-owner", now);
    const departingOwner = await createOwner(repository, "departing-owner", now);
    const retainedGroupId = randomUUID();
    await groups.createGroup(
      {
        id: retainedGroupId,
        workspaceId: workspaceOwner.workspaceId,
        name: "Retained facilitators",
        description: "Has a successor",
        createdBy: departingOwner.userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        workspaceId: workspaceOwner.workspaceId,
        groupId: retainedGroupId,
        userId: departingOwner.userId,
        role: "owner",
        joinedAt: now,
      },
    );
    await groups.addMember({
      workspaceId: workspaceOwner.workspaceId,
      groupId: retainedGroupId,
      userId: workspaceOwner.userId,
      role: "member",
      joinedAt: new Date(now.getTime() + 1),
    });

    const emptyGroupId = randomUUID();
    await groups.createGroup(
      {
        id: emptyGroupId,
        workspaceId: workspaceOwner.workspaceId,
        name: "Deleted facilitators",
        description: "No successor",
        createdBy: departingOwner.userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        workspaceId: workspaceOwner.workspaceId,
        groupId: emptyGroupId,
        userId: departingOwner.userId,
        role: "owner",
        joinedAt: now,
      },
    );

    await repository.deleteAccount(departingOwner.userId);

    await expect(groups.listMembers(retainedGroupId)).resolves.toEqual([
      expect.objectContaining({ userId: workspaceOwner.userId, role: "owner" }),
    ]);
    await expect(
      groups.listGroups(workspaceOwner.workspaceId, workspaceOwner.userId),
    ).resolves.toEqual([expect.objectContaining({ id: retainedGroupId })]);
    await expect(groups.getGroup(workspaceOwner.workspaceId, emptyGroupId)).resolves.toBeNull();
  });
});
