import { rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const webDirectory = resolve(repositoryRoot, "apps/web");
const nextOutputDirectory = resolve(webDirectory, ".next");

if (basename(nextOutputDirectory) !== ".next" || dirname(nextOutputDirectory) !== webDirectory) {
  throw new Error("Refusing to clean an unexpected Next.js output directory");
}

await rm(nextOutputDirectory, {
  force: true,
  maxRetries: 3,
  recursive: true,
  retryDelay: 100,
});
