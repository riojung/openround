import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const compose = ["compose", "-f", "compose.yaml", "-f", "compose.media.yaml"];
const databaseTables = [
  "users",
  "workspaces",
  "workspace_members",
  "auth_magic_tokens",
  "creator_sessions",
  "quizzes",
  "quiz_versions",
  "media_assets",
  "game_sessions",
  "participants",
  "question_rounds",
  "answers",
  "session_events",
  "reports",
  "subscriptions",
  "billing_events",
  "consent_records",
  "audit_events",
  "operational_settings",
] as const;

async function composeExec(service: string, args: string[]) {
  return runFile("docker", [...compose, "exec", "-T", service, ...args], {
    cwd: process.cwd(),
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function composeExecWithInput(service: string, args: string[], input: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("docker", [...compose, "exec", "-T", service, ...args], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const errors: Buffer[] = [];
    child.stdout.resume();
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(Buffer.concat(errors).toString("utf8") || `Command exited ${code}`));
    });
    child.stdin.end(input);
  });
}

async function databaseFingerprint(database: string) {
  const fingerprint: Record<string, string> = {};
  for (const table of databaseTables) {
    const sql = `SELECT count(*)::text || ':' || md5(COALESCE(string_agg(to_jsonb(row_data)::text, '' ORDER BY to_jsonb(row_data)::text), '')) FROM ${table} AS row_data`;
    const { stdout } = await composeExec("postgres", [
      "psql",
      "-U",
      "openround",
      "-d",
      database,
      "-Atc",
      sql,
    ]);
    fingerprint[table] = stdout.trim();
  }
  return fingerprint;
}

async function main() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const restoredDatabase = `openround_restore_${suffix}`;
  const dumpPath = `/tmp/${restoredDatabase}.dump`;
  const objectKey = `restore-drill/${suffix}.txt`;
  const backupObjectKey = `restore-drill-backup/${suffix}.txt`;
  const objectPayload = Buffer.from(`OpenRound restore drill ${suffix}\n`, "utf8");
  const startedAt = performance.now();
  let databaseCreated = false;
  let storageAliasCreated = false;

  try {
    const sourceFingerprint = await databaseFingerprint("openround");
    await composeExec("postgres", [
      "pg_dump",
      "-U",
      "openround",
      "-d",
      "openround",
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      "--file",
      dumpPath,
    ]);
    const dumpBytes = Number(
      (await composeExec("postgres", ["stat", "-c", "%s", dumpPath])).stdout.trim(),
    );
    assert.ok(dumpBytes > 0, "PostgreSQL produced an empty backup");

    await composeExec("postgres", ["createdb", "-U", "openround", restoredDatabase]);
    databaseCreated = true;
    await composeExec("postgres", [
      "pg_restore",
      "-U",
      "openround",
      "-d",
      restoredDatabase,
      "--no-owner",
      "--no-privileges",
      dumpPath,
    ]);
    const restoredFingerprint = await databaseFingerprint(restoredDatabase);
    assert.deepEqual(restoredFingerprint, sourceFingerprint);

    await composeExec("minio", [
      "mc",
      "alias",
      "set",
      "restore-drill",
      "http://127.0.0.1:9000",
      "openround",
      "change-this-local-secret",
    ]);
    storageAliasCreated = true;
    await composeExecWithInput(
      "minio",
      ["mc", "pipe", `restore-drill/openround-media/${objectKey}`],
      objectPayload,
    );
    await composeExec("minio", [
      "mc",
      "cp",
      `restore-drill/openround-media/${objectKey}`,
      `restore-drill/openround-media/${backupObjectKey}`,
    ]);
    await composeExec("minio", [
      "mc",
      "rm",
      "--force",
      `restore-drill/openround-media/${objectKey}`,
    ]);
    await assert.rejects(
      composeExec("minio", ["mc", "stat", `restore-drill/openround-media/${objectKey}`]),
    );
    await composeExec("minio", [
      "mc",
      "cp",
      `restore-drill/openround-media/${backupObjectKey}`,
      `restore-drill/openround-media/${objectKey}`,
    ]);
    const restoredObject = await composeExec("minio", [
      "mc",
      "cat",
      `restore-drill/openround-media/${objectKey}`,
    ]);
    assert.deepEqual(Buffer.from(restoredObject.stdout), objectPayload);

    process.stdout.write(
      `${JSON.stringify(
        {
          databaseTables: databaseTables.length,
          dumpBytes,
          databaseFingerprintMatch: true,
          objectBytes: objectPayload.byteLength,
          objectRoundTripMatch: true,
          elapsedMs: performance.now() - startedAt,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (storageAliasCreated) {
      await composeExec("minio", [
        "mc",
        "rm",
        "--force",
        `restore-drill/openround-media/${objectKey}`,
        `restore-drill/openround-media/${backupObjectKey}`,
      ]).catch(() => undefined);
      await composeExec("minio", ["mc", "alias", "remove", "restore-drill"]).catch(() => undefined);
    }
    if (databaseCreated) {
      await composeExec("postgres", [
        "dropdb",
        "-U",
        "openround",
        "--if-exists",
        "--force",
        restoredDatabase,
      ]).catch(() => undefined);
    }
    await composeExec("postgres", ["rm", "-f", dumpPath]).catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
