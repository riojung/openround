import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryRepository } from "../src/memory.js";

async function createCreator(repository: MemoryRepository, email: string) {
  const tokenHash = randomUUID();
  await repository.createMagicToken({
    id: randomUUID(),
    email,
    segment: "workplace",
    tokenHash,
    policyVersion: "test-v1",
    expiresAt: new Date(Date.now() + 60_000),
    consumedAt: null,
  });
  const creator = await repository.consumeMagicToken(tokenHash, new Date());
  if (!creator) throw new Error("Expected creator");
  return creator;
}

describe("memory locale preference persistence", () => {
  it("updates only the requested user and remains idempotent", async () => {
    const repository = new MemoryRepository();
    const first = await createCreator(repository, "locale-first@example.com");
    const second = await createCreator(repository, "locale-second@example.com");

    expect(first.locale).toBe("en-CA");
    expect(first.localePreferenceSet).toBe(false);
    expect(second.locale).toBe("en-CA");
    expect(second.localePreferenceSet).toBe(false);
    await expect(repository.updateUserLocale(first.userId, "ja-JP")).resolves.toBe("ja-JP");
    await expect(repository.updateUserLocale(first.userId, "ja-JP")).resolves.toBe("ja-JP");

    await expect(
      repository.getCreatorByUserId(first.userId, first.workspaceId),
    ).resolves.toMatchObject({ locale: "ja-JP", localePreferenceSet: true });
    await expect(
      repository.getCreatorByUserId(second.userId, second.workspaceId),
    ).resolves.toMatchObject({ locale: "en-CA", localePreferenceSet: false });

    const returning = await createCreator(repository, "locale-first@example.com");
    expect(returning).toMatchObject({ locale: "ja-JP", localePreferenceSet: true });
    const sessionToken = randomUUID();
    await repository.createCreatorSession({
      id: randomUUID(),
      userId: first.userId,
      tokenHash: sessionToken,
      expiresAt: new Date(Date.now() + 60_000),
      activeWorkspaceId: first.workspaceId,
    });
    await expect(repository.getCreatorBySession(sessionToken, new Date())).resolves.toMatchObject({
      locale: "ja-JP",
      localePreferenceSet: true,
    });
    await expect(repository.exportAccount(first.userId)).resolves.toMatchObject({
      profile: { locale: "ja-JP", localePreferenceSet: true },
    });
    await repository.deleteAccount(first.userId);
    const retained = (
      repository as unknown as {
        users: Map<string, { locale: string; localePreferenceSet: boolean }>;
      }
    ).users.get(first.userId);
    expect(retained).toMatchObject({ locale: "en-CA", localePreferenceSet: false });
    await expect(repository.updateUserLocale(randomUUID(), "fr-FR")).resolves.toBeNull();
  });
});
