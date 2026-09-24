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
    const [session, interview, usability, decision, plan] = await Promise.all([
      repositoryFile("docs/evidence/session-observation.md"),
      repositoryFile("docs/evidence/design-partner-interview.md"),
      repositoryFile("docs/evidence/beta-usability.md"),
      repositoryFile("docs/evidence/phase0-stage-decision.md"),
      repositoryFile("docs/market-research-and-development-plan-2026-09.md"),
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

    for (const field of [
      "Partners completing at least two pilots",
      "Observed real sessions",
      "Evidence-complete recovery checkpoints",
      "Eligible recovery checkpoints",
      "Median time to unassisted first activation",
      "Willingness-to-pay yes/known denominator",
      "Partner workflows with timing/connectivity exclusion",
      "Timing/connectivity-affected attempts",
      "Repeat facilitators using an external deck",
      "Observed sessions with a material context-switch interruption",
      "Phase 0 independent reviewer decision",
      "Independent reviewer decision",
    ]) {
      expect(decision).toContain(field);
    }
    expect(decision).toMatch(/Access gate passes if any one/);
    expect(decision).toMatch(/at least three partner\s+workflows/);
    expect(decision).toMatch(/at least 10% of observed attempts/);
    expect(decision).toMatch(/serious accessibility finding/);
    expect(decision).toMatch(/at\s+least six eligible higher-education and six eligible workplace/);
    expect(decision).toMatch(/at\s+least eight of the twelve demonstrate/);
    expect(decision).toMatch(/at least three\s+partners per segment run twice/);
    expect(decision).toMatch(/at least ten real sessions are observed/);
    expect(decision).toMatch(/at least 50% of eligible\s+recovery checkpoints/);
    expect(decision).toMatch(
      /Companion gate passes only when at least four repeat facilitators[\s\S]*at\s+least two observed sessions/,
    );
    expect(decision).toMatch(/Companion mode\*\* only after the Access gate explicitly fails/);
    expect(decision).toMatch(/only after both gates\s+explicitly fail/);
    expect(decision).toMatch(/If either required gate result is pending[\s\S]*branch pending/);
    const accessDecision = decision.indexOf("**Access and resilience**");
    const companionDecision = decision.indexOf("**Companion mode**");
    expect(accessDecision).toBeGreaterThan(-1);
    expect(companionDecision).toBeGreaterThan(-1);
    expect(accessDecision).toBeLessThan(companionDecision);
    expect(plan).toMatch(/select exactly \*\*one\*\* implementation[\s\S]*Access path first/i);
    expect(plan).toMatch(/Keep Pro at 100[\s\S]*250-client target-host soak gate passes/);
  });
});
