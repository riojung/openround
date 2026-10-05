import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function repositoryFile(path: string) {
  return readFile(join(repositoryRoot, path), "utf8");
}

describe("Phase 0 independent-assurance records", () => {
  it("defines a complete WCAG 2.2 AA manual review boundary", async () => {
    const record = await repositoryFile("docs/evidence/accessibility-review.md");

    expect(record).toContain("WCAG 2.2 AA");
    expect(record).toMatch(/blocker.*major.*minor/i);
    expect(record).toMatch(/no blocker or major finding remains open/i);
    expect(record).toMatch(/Automated axe results.*do not\s+replace/i);
    for (const coverage of [
      "Keyboard-only sign-in",
      "VoiceOver join",
      "NVDA sign-in",
      "200% and 400% zoom",
      "Touch targets",
      "Projector legibility",
      "Extended-time/deadline",
    ]) {
      expect(record).toContain(coverage);
    }
    for (const preset of ["Focus", "Campus", "Studio", "Blueprint", "Signal", "Spark"]) {
      expect(record).toContain(`| ${preset}`);
    }
  });

  it("binds security acceptance to an independent threat-model review", async () => {
    const [record, threatModel] = await Promise.all([
      repositoryFile("docs/evidence/security-review.md"),
      repositoryFile("docs/threat-model.md"),
    ]);

    expect(record).toContain("Threat-model version and checksum");
    expect(record).toContain("Assets and trust boundaries");
    expect(record).toContain("independence from implementation");
    expect(record).toMatch(/zero critical or high findings remain open or risk-accepted/i);
    expect(record).toMatch(/repository scan alone is not an independent security review/i);
    for (const boundary of [
      "Public browser ↔ Caddy",
      "API ↔ PostgreSQL/Valkey",
      "API ↔ object storage/scanner",
      "Source/tag/workflow ↔ registry/deployer",
    ]) {
      expect(threatModel).toContain(boundary);
    }
    expect(threatModel).toMatch(/No critical or high finding may remain open/i);
    expect(threatModel).toMatch(/does not claim high\s+availability or an SLA/i);
  });

  it("requires reproducible physical Round and Presentation coverage", async () => {
    const [record, runbook] = await Promise.all([
      repositoryFile("docs/evidence/device-matrix.md"),
      repositoryFile("docs/runbooks/device-matrix.md"),
    ]);

    expect(record).toMatch(/exact\s+hardware model, OS build, browser version/);
    expect(record).toContain("both a Round and a Presentation");
    expect(record).toContain("Independent reviewer decision");
    expect(record).toMatch(/Every required row and the thirty-device lobby must pass/);
    expect(runbook).toMatch(/browser emulation.*stand in for real hardware/i);
    expect(runbook).toContain("30/30 successful joins");
    expect(runbook).toMatch(/zero lost or duplicate accepted answers/i);
  });

  it("keeps the counsel packet factual and blocks placeholder launch documents", async () => {
    const [packet, approval] = await Promise.all([
      repositoryFile("docs/evidence/privacy-legal-source-packet.md"),
      repositoryFile("docs/evidence/privacy-legal-approval.md"),
    ]);

    expect(packet).toMatch(/not legal advice/i);
    expect(packet).toContain("exact product and documentation commits");
    expect(packet).toMatch(/Counsel-authored or counsel-approved artifacts/i);
    expect(packet).toMatch(/checked-in `\/privacy` and `\/terms` pages are explicit drafts/i);
    expect(packet).toMatch(
      /Any\s+pending row or incomplete condition keeps the readiness gate pending/i,
    );
    expect(approval).toContain("privacy and legal source packet");
  });
});
