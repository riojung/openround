import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
