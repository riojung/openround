export function parseDatabaseTableNames(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("PostgreSQL returned an invalid durable-table list", { cause: error });
  }

  if (
    !Array.isArray(parsed) ||
    parsed.some((table) => typeof table !== "string" || table.length === 0)
  ) {
    throw new Error("PostgreSQL returned an invalid durable-table list");
  }

  const tables = parsed as string[];
  if (new Set(tables).size !== tables.length) {
    throw new Error("PostgreSQL returned duplicate durable-table names");
  }
  return tables;
}

export function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function createDatabaseTableFingerprints(): Record<string, string> {
  return Object.create(null) as Record<string, string>;
}
