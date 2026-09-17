import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";

const MIGRATION_FILE = /^(\d{3,})_([a-z0-9][a-z0-9_-]*)\.sql$/;
const MIGRATION_LOCK_NAMESPACE = 1_329_744_718;
const MIGRATION_LOCK_KEY = 1;

export interface Migration {
  version: number;
  name: string;
  fileName: string;
  checksum: string;
  sql: string;
}

export async function discoverMigrations(directory: string): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const migrations = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && MIGRATION_FILE.test(entry.name))
      .map(async (entry) => {
        const match = MIGRATION_FILE.exec(entry.name)!;
        const sql = await readFile(join(directory, entry.name), "utf8");
        return {
          version: Number.parseInt(match[1]!, 10),
          name: match[2]!,
          fileName: entry.name,
          checksum: createHash("sha256").update(sql).digest("hex"),
          sql,
        };
      }),
  );

  migrations.sort((left, right) => left.version - right.version);
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1]!.version === migrations[index]!.version) {
      throw new Error(`Duplicate database migration version ${migrations[index]!.version}`);
    }
  }
  if (migrations.length === 0) {
    throw new Error(`No database migrations found in ${directory}`);
  }
  return migrations;
}

export async function runMigrations(pool: Pool, directory: string): Promise<void> {
  const migrations = await discoverMigrations(directory);
  const client = await pool.connect();
  let priorStatementTimeout: string | null = null;
  try {
    const timeoutResult = await client.query<{ statement_timeout: string }>(
      "SELECT current_setting('statement_timeout') AS statement_timeout",
    );
    priorStatementTimeout = timeoutResult.rows[0]?.statement_timeout ?? null;
    await client.query("SELECT set_config('statement_timeout', '0', false)");
    await client.query("SELECT pg_advisory_lock($1::integer, $2::integer)", [
      MIGRATION_LOCK_NAMESPACE,
      MIGRATION_LOCK_KEY,
    ]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS _openround_migrations (
        version integer PRIMARY KEY CHECK (version > 0),
        name text NOT NULL,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query<{
      version: number;
      name: string;
      checksum: string;
    }>("SELECT version, name, checksum FROM _openround_migrations ORDER BY version");
    const availableByVersion = new Map(
      migrations.map((migration) => [migration.version, migration]),
    );
    for (const applied of appliedResult.rows) {
      const available = availableByVersion.get(applied.version);
      if (!available) {
        throw new Error(
          `Applied database migration ${applied.version}_${applied.name} is missing from the release`,
        );
      }
      if (available.name !== applied.name || available.checksum !== applied.checksum.trim()) {
        throw new Error(
          `Checksum mismatch for applied database migration ${available.fileName}; ` +
            "restore the original migration and add a forward-repair migration",
        );
      }
    }

    const appliedVersions = new Set(appliedResult.rows.map(({ version }) => version));
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO _openround_migrations (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1::integer, $2::integer)", [
        MIGRATION_LOCK_NAMESPACE,
        MIGRATION_LOCK_KEY,
      ]);
    } finally {
      if (priorStatementTimeout !== null) {
        await client.query("SELECT set_config('statement_timeout', $1, false)", [
          priorStatementTimeout,
        ]);
      }
      client.release();
    }
  }
}
