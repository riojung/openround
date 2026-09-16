import { PostgresRepository } from "./postgres.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const repository = new PostgresRepository(connectionString);
await repository.migrate();
await repository.close();
process.stdout.write("Database migration complete\n");
