import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MemoryRepository, type CreatorContext } from "@openround/db";
import type { AuthoringAssistant } from "../src/authoring-assistant.js";
import { AuthoringService, type AuthoringError } from "../src/authoring-service.js";
import { AuthoringWorker } from "../src/authoring-worker.js";
import { extractSource } from "../src/source-extraction.js";

const creator: CreatorContext = {
  userId: randomUUID(),
  workspaceId: randomUUID(),
  email: "facilitator@example.com",
  segment: "education",
  role: "owner",
  plan: "pro",
};

const rawOutput = {
  title: "Isolation review",
  description: "A source-grounded draft.",
  conceptKey: "isolation",
  citations: [
    {
      locator: "paragraph 1",
      excerpt: "Isolation separates people from a hazardous energy source",
    },
  ],
  main: {
    type: "single_select",
    prompt: "What separates people from hazardous energy?",
    purpose: "diagnostic",
    confidence: "optional",
    explanation: "Isolation creates physical separation.",
    timeLimitSeconds: 30,
    citationIndexes: [0],
    choices: [
      {
        label: "Isolation",
        isCorrect: true,
        rationale: "It creates physical separation.",
        misconceptionLabel: null,
      },
      {
        label: "A reminder",
        isCorrect: false,
        rationale: "A reminder does not create separation.",
        misconceptionLabel: "communication-is-control",
      },
    ],
  },
  recheck: {
    type: "true_false",
    prompt: "True or false: physical isolation controls hazardous energy exposure.",
    purpose: "practice",
    confidence: "optional",
    explanation: "Physical isolation is the control described by the source.",
    timeLimitSeconds: 25,
    citationIndexes: [0],
    choices: [
      {
        label: "True",
        isCorrect: true,
        rationale: "This restates the source accurately.",
        misconceptionLabel: null,
      },
      {
        label: "False",
        isCorrect: false,
        rationale: "The source explicitly describes physical isolation.",
        misconceptionLabel: "isolation-not-needed",
      },
    ],
  },
};

function assistant(generate: AuthoringAssistant["generate"]): AuthoringAssistant {
  return { providerName: "test-provider", modelName: "test-model", generate };
}

const sourceText =
  "Isolation separates people from a hazardous energy source before maintenance begins. " +
  "A reminder alone does not provide physical separation.";

describe("authoring jobs", () => {
  it("extracts a private source, creates a validated proposal, clears source data, and applies a draft", async () => {
    const repository = new MemoryRepository();
    const service = new AuthoringService(repository, true);
    const created = await service.create(
      creator,
      { sourceType: "pasted_text", sourceName: "Safety source", text: sourceText },
      100,
      365,
      new Date("2026-09-17T12:00:00.000Z"),
    );
    const provider = assistant(vi.fn().mockResolvedValue(rawOutput));
    const worker = new AuthoringWorker(repository, provider, 60_000, 20_000, undefined, (input) =>
      extractSource(input),
    );

    await expect(worker.runOnce(new Date("2026-09-17T12:00:01.000Z"))).resolves.toBe("completed");
    const ready = await repository.getAuthoringJob(creator.workspaceId, created.id);
    expect(ready).toMatchObject({
      status: "ready",
      attempts: 1,
      sourceText: null,
      sourceBlob: null,
    });
    expect(ready?.output?.citations).toHaveLength(2);

    const quiz = await service.apply(creator, created.id, undefined, new Date());
    expect(quiz).toMatchObject({ status: "draft", currentVersionId: null, tags: ["ai-assisted"] });
    expect(quiz.draft.questions).toHaveLength(2);
    expect(quiz.draft.questions[0]?.id).not.toBe(ready?.output?.checkpointSet.questions[0]?.id);
    expect(quiz.draft.questions[0]?.sourceCitations?.[0]).toMatchObject({
      sourceName: "Safety source",
      locator: "paragraph 1",
    });
    const retried = await service.apply(creator, created.id, "Ignored retry title", new Date());
    expect(retried.id).toBe(quiz.id);
    expect(repository.quizzes.size).toBe(1);
  });

  it("enforces the monthly allowance before storing another source", async () => {
    const repository = new MemoryRepository();
    const service = new AuthoringService(repository, true);
    const now = new Date("2026-09-17T12:00:00.000Z");
    await service.create(
      creator,
      { sourceType: "pasted_text", sourceName: "First", text: sourceText },
      1,
      30,
      now,
    );
    await expect(
      service.create(
        creator,
        { sourceType: "pasted_text", sourceName: "Second", text: sourceText },
        1,
        30,
        now,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AuthoringError>>({ code: "AUTHORING_LIMIT" }),
    );
  });

  it("enforces the monthly allowance atomically across concurrent requests", async () => {
    const repository = new MemoryRepository();
    const service = new AuthoringService(repository, true);
    const now = new Date("2026-09-17T12:00:00.000Z");
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        service.create(
          creator,
          { sourceType: "pasted_text", sourceName: `Concurrent ${index}`, text: sourceText },
          3,
          30,
          now,
        ),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(5);
    expect(repository.authoringJobs.size).toBe(3);
  });

  it("prevents an expired worker lease from overwriting a newer claim", async () => {
    const repository = new MemoryRepository();
    const service = new AuthoringService(repository, true);
    const initial = new Date("2026-09-17T12:00:00.000Z");
    const created = await service.create(
      creator,
      { sourceType: "pasted_text", sourceName: "Lease source", text: sourceText },
      null,
      30,
      initial,
    );
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseStale!: () => void;
    const staleRelease = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    const staleWorker = new AuthoringWorker(
      repository,
      assistant(async () => {
        signalStarted();
        await staleRelease;
        return { ...rawOutput, title: "Stale output" };
      }),
      1_000,
      20_000,
      undefined,
      (input) => extractSource(input),
    );
    const staleRun = staleWorker.runOnce(new Date(initial.getTime() + 1));
    await started;

    const currentWorker = new AuthoringWorker(
      repository,
      assistant(vi.fn().mockResolvedValue({ ...rawOutput, title: "Current output" })),
      1_000,
      20_000,
      undefined,
      (input) => extractSource(input),
    );
    await expect(currentWorker.runOnce(new Date(initial.getTime() + 1_002))).resolves.toBe(
      "completed",
    );
    releaseStale();
    await expect(staleRun).resolves.toBe("superseded");
    await expect(
      repository.getAuthoringJob(creator.workspaceId, created.id),
    ).resolves.toMatchObject({
      status: "ready",
      attempts: 2,
      output: { checkpointSet: { title: "Current output" } },
    });
  });

  it("retries provider failures three times but fails extraction immediately", async () => {
    const repository = new MemoryRepository();
    const service = new AuthoringService(repository, true);
    const initial = new Date("2026-09-17T12:00:00.000Z");
    const generated = await service.create(
      creator,
      { sourceType: "pasted_text", sourceName: "Retry source", text: sourceText },
      null,
      30,
      initial,
    );
    const worker = new AuthoringWorker(
      repository,
      assistant(vi.fn().mockRejectedValue(new Error("Provider unavailable"))),
      60_000,
      20_000,
      undefined,
      (input) => extractSource(input),
    );
    await expect(worker.runOnce(initial)).resolves.toBe("retry_scheduled");
    await expect(worker.runOnce(new Date(initial.getTime() + 3_000))).resolves.toBe(
      "retry_scheduled",
    );
    await expect(worker.runOnce(new Date(initial.getTime() + 8_000))).resolves.toBe("failed");
    await expect(
      repository.getAuthoringJob(creator.workspaceId, generated.id),
    ).resolves.toMatchObject({ status: "failed", attempts: 3, sourceText: null });

    const extractionJob = await service.create(
      creator,
      { sourceType: "pasted_text", sourceName: "Unreadable", text: sourceText },
      null,
      30,
      new Date(initial.getTime() + 10_000),
    );
    const generate = vi.fn().mockResolvedValue(rawOutput);
    const extractionWorker = new AuthoringWorker(
      repository,
      assistant(generate),
      60_000,
      20_000,
      undefined,
      async () => {
        throw new Error("No readable source text was found");
      },
    );
    await expect(extractionWorker.runOnce(new Date(initial.getTime() + 10_000))).resolves.toBe(
      "failed",
    );
    expect(generate).not.toHaveBeenCalled();
    await expect(
      repository.getAuthoringJob(creator.workspaceId, extractionJob.id),
    ).resolves.toMatchObject({ status: "failed", attempts: 1, sourceText: null });
  });
});
