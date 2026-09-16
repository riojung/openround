import { PostgresRepository } from "@openround/db";

const connectionString = process.env.DATABASE_MIGRATION_URL;
if (!connectionString) {
  throw new Error("DATABASE_MIGRATION_URL is required for the one-shot migration command");
}

const repository = new PostgresRepository(connectionString);
try {
  await repository.migrate();
  process.stdout.write("Database migration complete\n");
} finally {
  await repository.close();
}
