import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function repositoryFile(path: string) {
  return readFile(join(repositoryRoot, path), "utf8");
}

describe("Phase 0 evidence contract", () => {
  it("requires all four target-region profiles without claiming the pending gate passed", async () => {
    const [template, runbook, workflow, ledgerText] = await Promise.all([
      repositoryFile("docs/evidence/target-region-load.md"),
      repositoryFile("docs/runbooks/staging-readiness.md"),
      repositoryFile(".github/workflows/staging-readiness.yml"),
      repositoryFile("docs/release-readiness.json"),
    ]);
    const ledger = JSON.parse(ledgerText) as {
      gates: Array<{ id: string; status: string; criterion: string; evidence: unknown[] }>;
    };
    const gate = ledger.gates.find(({ id }) => id === "target-region-load");

    for (const [artifact, clients] of [
      ["round", 50],
      ["presentation", 50],
      ["round", 250],
      ["presentation", 250],
    ] as const) {
      const filename = `target-region-${artifact}-${clients}.json`;
      expect(workflow).toContain(filename);
      expect(runbook).toContain(filename);
      expect(template).toMatch(
        new RegExp(
          `\\| ${artifact === "round" ? "Round" : "Presentation"}\\s+\\|\\s+${clients} \\|`,
        ),
      );
    }
    expect(gate).toMatchObject({ status: "pending", evidence: [] });
    expect(gate?.criterion).toMatch(/50- and 250-client Round and Presentation/);
  });

  it("captures reviewed repeat-use, recovery-loop, and Phase 1 selection denominators", async () => {
    const [session, interview, usability] = await Promise.all([
      repositoryFile("docs/evidence/session-observation.md"),
      repositoryFile("docs/evidence/design-partner-interview.md"),
      repositoryFile("docs/evidence/beta-usability.md"),
    ]);

    for (const field of [
      "Partner session ordinal",
      "Artifact type",
      "Eligible recovery checkpoints",
      "Evidence-complete recovery checkpoints",
      "Timing/connectivity-affected attempts",
      "Facilitator used an external deck",
      "Material context-switch interruptions",
      "Independent reviewer decision",
    ]) {
      expect(session).toContain(field);
    }
    expect(session).toMatch(/aggregate\s+telemetry alone cannot establish it/i);
    expect(interview).toContain("Willingness to pay (yes/no/unknown)");
    expect(interview).toContain("higher education/workplace");
    expect(interview).toContain("Next pilot date or repeat-use status");
    expect(interview).toContain("Eligible for facilitator denominator (yes/no/excluded)");
    expect(interview).toContain("Recurring post-result decision problem demonstrated (yes/no)");
    expect(interview).toContain("Independent reviewer and decision");
    expect(usability).toContain("Education result/sample");
    expect(usability).toContain("Workplace result/sample");
    expect(usability).toMatch(/overall result does not replace either\s+segment\s+result/i);
  });
});
