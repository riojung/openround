import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";
import { main, validateStagingEnvironment } from "../../scripts/check-staging-environment.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const protectedEnvironment = {
  name: "single-vm-staging",
  can_admins_bypass: false,
  protection_rules: [
    {
      type: "required_reviewers",
      prevent_self_review: true,
      reviewers: [{ type: "User", reviewer: { id: 123 } }],
    },
  ],
};

describe("staging environment protection", () => {
  it("requires an exact environment and a real independent reviewer", () => {
    expect(validateStagingEnvironment(protectedEnvironment)).toBe(protectedEnvironment);
    expect(
      validateStagingEnvironment({
        ...protectedEnvironment,
        protection_rules: [
          {
            type: "required_reviewers",
            prevent_self_review: true,
            reviewers: [{ type: "Team", reviewer: { id: 456 } }],
          },
        ],
      }),
    ).toBeTruthy();

    for (const invalid of [
      null,
      {},
      { ...protectedEnvironment, name: "production" },
      { ...protectedEnvironment, can_admins_bypass: true },
      { ...protectedEnvironment, can_admins_bypass: undefined },
      { ...protectedEnvironment, protection_rules: undefined },
      { ...protectedEnvironment, protection_rules: [] },
      {
        ...protectedEnvironment,
        protection_rules: [{ type: "wait_timer", wait_timer: 30 }],
      },
      {
        ...protectedEnvironment,
        protection_rules: [
          { ...protectedEnvironment.protection_rules[0], prevent_self_review: false },
        ],
      },
      {
        ...protectedEnvironment,
        protection_rules: [{ ...protectedEnvironment.protection_rules[0], reviewers: [] }],
      },
      {
        ...protectedEnvironment,
        protection_rules: [
          {
            ...protectedEnvironment.protection_rules[0],
            reviewers: [{ type: "User", reviewer: {} }],
          },
        ],
      },
    ]) {
      expect(() => validateStagingEnvironment(invalid)).toThrow();
    }
  });

  it("uses only a GET and fails closed on missing or malformed API responses", async () => {
    const token = "test-token";
    const githubRepository = "riojung/openround";
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(protectedEnvironment), { status: 200 }),
    );
    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await main({ token, githubRepository, fetchImpl });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(fetchImpl.mock.calls[0]?.[0]).toBe(
        "https://api.github.com/repos/riojung/openround/environments/single-vm-staging",
      );
      expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
        method: "GET",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      });
    } finally {
      output.mockRestore();
    }

    for (const status of [403, 404, 500]) {
      await expect(
        main({
          token,
          githubRepository,
          fetchImpl: async () => new Response("", { status }),
        }),
      ).rejects.toThrow(`HTTP ${status}`);
    }
    await expect(
      main({
        token,
        githubRepository,
        fetchImpl: async () => new Response("not JSON", { status: 200 }),
      }),
    ).rejects.toThrow();
    await expect(
      main({
        token,
        githubRepository,
        fetchImpl: async () => new Response("{}", { status: 200 }),
      }),
    ).rejects.toThrow();
    await expect(main({ token, githubRepository: "someone/else", fetchImpl })).rejects.toThrow(
      "reviewed repository",
    );
    await expect(main({ token: "", githubRepository, fetchImpl })).rejects.toThrow(
      "GitHub token is required",
    );
  });

  it("places the guard before every protected staging job with read-only scope", async () => {
    for (const filename of ["staging-images.yml", "staging-readiness.yml"]) {
      const workflow = parse(
        await readFile(resolve(repositoryRoot, ".github/workflows", filename), "utf8"),
      ) as {
        jobs: Record<
          string,
          {
            environment?: string;
            needs?: string | string[];
            permissions?: Record<string, string>;
            steps?: Array<{ env?: Record<string, string>; run?: string }>;
          }
        >;
      };
      const preflight = workflow.jobs["main-candidate"];
      expect(preflight.environment).toBeUndefined();
      expect(preflight.permissions).toEqual({ contents: "read", actions: "read" });
      const guard = preflight.steps?.find(
        (step) => step.run === "node scripts/check-staging-environment.mjs",
      );
      expect(guard?.env?.GITHUB_TOKEN).toBe("${{ github.token }}");

      for (const [name, job] of Object.entries(workflow.jobs)) {
        if (job.environment !== "single-vm-staging") continue;
        expect([job.needs].flat(), `${filename}:${name} must depend on main-candidate`).toContain(
          "main-candidate",
        );
      }
    }
  });
});
