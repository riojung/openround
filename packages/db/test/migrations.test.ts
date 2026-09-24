import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { discoverMigrations } from "../src/migrations.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "openround-migrations-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("database migration discovery", () => {
  it("orders versioned migrations and computes stable checksums", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "010_later.sql"), "SELECT 10;\n");
    await writeFile(join(directory, "002_earlier.sql"), "SELECT 2;\n");
    await writeFile(join(directory, "README.md"), "ignored\n");

    const migrations = await discoverMigrations(directory);

    expect(migrations.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 2, name: "earlier" },
      { version: 10, name: "later" },
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(migrations[0]?.checksum).not.toBe(migrations[1]?.checksum);
  });

  it("rejects duplicate versions and an empty directory", async () => {
    const duplicateDirectory = await temporaryDirectory();
    await writeFile(join(duplicateDirectory, "002_first.sql"), "SELECT 1;\n");
    await writeFile(join(duplicateDirectory, "002_second.sql"), "SELECT 2;\n");
    await expect(discoverMigrations(duplicateDirectory)).rejects.toThrow(
      "Duplicate database migration version 2",
    );

    const emptyDirectory = await temporaryDirectory();
    await expect(discoverMigrations(emptyDirectory)).rejects.toThrow("No database migrations");
  });

  it("locks legacy room writers before validating and backfilling the shared registry", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const registryMigration = migrations.find(({ version }) => version === 34);
    expect(registryMigration).toBeDefined();

    const sql = registryMigration!.sql;
    const writerLock = sql.indexOf(
      "LOCK TABLE game_sessions, presentation_live_sessions IN SHARE ROW EXCLUSIVE MODE",
    );
    const overlapValidation = sql.indexOf(
      "JOIN presentation_live_sessions AS presentation_session",
    );
    const roundBackfill = sql.indexOf("INSERT INTO live_room_codes");
    const triggerInstallation = sql.indexOf("CREATE TRIGGER game_sessions_register_room_code");

    expect(writerLock).toBeGreaterThan(-1);
    expect(writerLock).toBeLessThan(overlapValidation);
    expect(writerLock).toBeLessThan(roundBackfill);
    expect(roundBackfill).toBeLessThan(triggerInstallation);
  });

  it("commits Presentation report enqueueing before the idempotent backfill", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const triggerMigration = migrations.find(({ version }) => version === 36);
    const backfillMigration = migrations.find(({ version }) => version === 37);
    expect(triggerMigration?.sql).toContain("CREATE TRIGGER presentation_session_enqueue_report");
    expect(triggerMigration?.sql).toContain("lease_token uuid");
    expect(triggerMigration?.sql).not.toContain(
      "LOCK TABLE presentation_live_sessions IN SHARE ROW EXCLUSIVE MODE",
    );
    expect(backfillMigration?.sql).toContain("INSERT INTO presentation_session_reports");
    expect(backfillMigration?.sql).toContain("ON CONFLICT (session_id) DO NOTHING");
  });

  it("adds a commit-visible Presentation fence without breaking prior-image writes", async () => {
    const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
    const migrations = await discoverMigrations(migrationsDirectory);
    const migration = migrations.find(({ version }) => version === 38);

    expect(migration?.sql).toContain("presentation_live_participants_session_fence_idx");
    expect(migration?.sql).toContain("app.presentation_concurrent_response_writes");
    expect(migration?.sql).toContain("CREATE TRIGGER presentation_participant_bump_event_seq");
    expect(migration?.sql).toContain("CREATE TRIGGER presentation_response_bump_event_seq");
    expect(migration?.sql).not.toContain("CREATE SEQUENCE");
  });
});
