import { MemoryRepository } from "./memory.js";
import { PostgresRepository } from "./postgres.js";
import type { Repository } from "./types.js";
import { MemoryPresentationSessionRepository } from "./presentation-session-memory.js";
import { PostgresPresentationSessionRepository } from "./presentation-session-postgres.js";
import type { PresentationSessionRepository } from "./presentation-session-types.js";

export { MemoryPresentationSessionRepository } from "./presentation-session-memory.js";
export { PostgresPresentationSessionRepository } from "./presentation-session-postgres.js";

export function createPresentationSessionRepository(
  repository: Repository,
  options: { concurrentResponseWrites?: boolean } = {},
): PresentationSessionRepository {
  if (repository instanceof PostgresRepository) {
    return new PostgresPresentationSessionRepository(repository, options);
  }
  if (repository instanceof MemoryRepository) {
    return repository.getOrCreateLifecycleExtension(
      "presentation-sessions",
      () => new MemoryPresentationSessionRepository(repository),
    );
  }
  return new MemoryPresentationSessionRepository(repository);
}
