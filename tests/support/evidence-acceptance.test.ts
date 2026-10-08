import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertStableEvidenceReference,
  validateIndependentGateAcceptance,
  validatePhase0ReadinessGateInventory,
  validateReviewedCandidateBuildConsistency,
} from "../../scripts/ops/evidence-acceptance.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

async function readinessGates() {
  const source = await readFile(resolve(repositoryRoot, "docs/release-readiness.json"), "utf8");
  return JSON.parse(source).gates as Array<{ id: string; requiredFor: string[] }>;
}

function acceptedGate() {
  return {
    id: "security-review",
    owner: "security",
    status: "complete",
    evidence: [
      "https://evidence.openround.dev/manifests/security-review.json",
      `sha256:${"b".repeat(64)}`,
    ],
    acceptance: {
      recordVersion: 1,
      candidateBuildId: "a".repeat(40),
      environment: "single-vm-staging",
      startedAt: "2026-09-27T12:00:00Z",
      completedAt: "2026-09-27T13:00:00Z",
      acceptedAt: "2026-09-27T14:00:00Z",
      owner: { role: "security", decision: "accepted" },
      independentReviewer: {
        role: "independent-security-reviewer",
        independent: true,
        decision: "accepted",
      },
      manifest: {
        url: "https://evidence.openround.dev/manifests/security-review.json",
        sha256: `sha256:${"b".repeat(64)}`,
      },
    },
  };
}

describe("release evidence acceptance", () => {
  it("requires the exact canonical Phase 0 gate inventory", async () => {
    const gates = await readinessGates();
    expect(() => validatePhase0ReadinessGateInventory(gates)).not.toThrow();

    const omitted = structuredClone(gates).filter(({ id }) => id !== "security-review");
    expect(() => validatePhase0ReadinessGateInventory(omitted)).toThrow(
      /canonical Phase 0 inventory/,
    );

    const replaced = structuredClone(gates);
    replaced.find(({ id }) => id === "security-review")!.id = "replacement-review";
    expect(() => validatePhase0ReadinessGateInventory(replaced)).toThrow(
      /canonical Phase 0 inventory/,
    );
  });

  it("requires canonical target membership for every Phase 0 gate", async () => {
    const missingPreflight = structuredClone(await readinessGates());
    const security = missingPreflight.find(({ id }) => id === "security-review")!;
    security.requiredFor = security.requiredFor.filter(
      (target) => target !== "single-vm-beta-preflight",
    );
    expect(() => validatePhase0ReadinessGateInventory(missingPreflight)).toThrow(
      /security-review: requiredFor must match/,
    );

    const signedPreflight = structuredClone(await readinessGates());
    signedPreflight
      .find(({ id }) => id === "signed-release")!
      .requiredFor.push("single-vm-beta-preflight");
    expect(() => validatePhase0ReadinessGateInventory(signedPreflight)).toThrow(
      /signed-release: requiredFor must match/,
    );
  });

  it("accepts stable HTTPS and checksum references", () => {
    expect(
      assertStableEvidenceReference("https://github.com/riojung/pollingpops/actions/runs/123"),
    ).toContain("github.com");
    expect(assertStableEvidenceReference(`sha256:${"a".repeat(64)}`)).toHaveLength(71);
  });

  it("rejects placeholder, local, credential-bearing, and untyped references", () => {
    for (const reference of [
      "pending",
      "http://evidence.openround.dev/run",
      "https://staging.pollingpops.example/run",
      "https://localhost/run",
      "https://10.0.0.2/run",
      "https://172.20.0.2/run",
      "https://192.168.1.2/run",
      "https://100.64.0.1/run",
      "https://192.0.2.1/run",
      "https://198.18.0.1/run",
      "https://198.51.100.1/run",
      "https://203.0.113.1/run",
      "https://[2001:db8::1]/run",
      "https://[ff02::1]/run",
      "https://[::ffff:127.0.0.1]/run",
      "https://evidence.internal/run",
      "https://token@example.org/run",
      "https://evidence.openround.dev/run?token=secret",
      "https://evidence.openround.dev/run#private-location",
      null,
    ]) {
      expect(() => assertStableEvidenceReference(reference)).toThrow();
    }
  });

  it("requires a build-bound, independently accepted manifest", () => {
    expect(() => validateIndependentGateAcceptance(acceptedGate())).not.toThrow();

    const missing = acceptedGate();
    delete (missing as { acceptance?: unknown }).acceptance;
    expect(() => validateIndependentGateAcceptance(missing)).toThrow(/acceptance object/);

    const pendingReviewer = acceptedGate();
    pendingReviewer.acceptance.independentReviewer.decision = "pending";
    expect(() => validateIndependentGateAcceptance(pendingReviewer)).toThrow(
      /reviewer decision must be accepted/,
    );

    const wrongBuild = acceptedGate();
    wrongBuild.acceptance.candidateBuildId = `sha256:${"c".repeat(64)}`;
    expect(() => validateIndependentGateAcceptance(wrongBuild)).toThrow(/full Git commit/);

    const reordered = acceptedGate();
    reordered.acceptance.acceptedAt = "2026-09-27T12:30:00Z";
    expect(() => validateIndependentGateAcceptance(reordered)).toThrow(/predates/);

    const impossibleCalendarDate = acceptedGate();
    impossibleCalendarDate.acceptance.startedAt = "2026-02-30T12:00:00Z";
    expect(() => validateIndependentGateAcceptance(impossibleCalendarDate)).toThrow(
      /real UTC calendar timestamp/,
    );

    const extraField = acceptedGate() as ReturnType<typeof acceptedGate> & {
      acceptance: ReturnType<typeof acceptedGate>["acceptance"] & { note?: string };
    };
    extraField.acceptance.note = "unreviewed field";
    expect(() => validateIndependentGateAcceptance(extraField)).toThrow(/documented fields/);

    const identifyingReviewer = acceptedGate();
    identifyingReviewer.acceptance.independentReviewer.role = "Alice <alice@example.com>";
    expect(() => validateIndependentGateAcceptance(identifyingReviewer)).toThrow(
      /redaction-safe role token/,
    );

    const futureDated = acceptedGate();
    futureDated.acceptance.startedAt = "2099-09-27T12:00:00Z";
    futureDated.acceptance.completedAt = "2099-09-27T13:00:00Z";
    futureDated.acceptance.acceptedAt = "2099-09-27T14:00:00Z";
    expect(() =>
      validateIndependentGateAcceptance(futureDated, {
        now: new Date("2026-09-27T15:00:00Z"),
      }),
    ).toThrow(/cannot be in the future/);
  });

  it("does not impose human acceptance metadata on automated engineering gates", () => {
    expect(() =>
      validateIndependentGateAcceptance({
        id: "source-ci",
        owner: "engineering",
        status: "complete",
      }),
    ).not.toThrow();
  });

  it("requires distinct owner and reviewer acceptance for the signed release", () => {
    const release = acceptedGate();
    release.id = "signed-release";
    release.owner = "maintainer";
    release.acceptance.owner.role = "maintainer";
    release.acceptance.independentReviewer.role = "independent-release-reviewer";
    expect(() => validateIndependentGateAcceptance(release)).not.toThrow();

    release.acceptance.independentReviewer.role = "maintainer";
    expect(() => validateIndependentGateAcceptance(release)).toThrow(/must differ/);
  });

  it("rejects premature acceptance and evidence that is not bound to the manifest", () => {
    const pending = acceptedGate();
    pending.status = "pending";
    expect(() => validateIndependentGateAcceptance(pending)).toThrow(/only after completion/);

    const unbound = acceptedGate();
    unbound.evidence = ["https://evidence.openround.dev/another-record.json"];
    expect(() => validateIndependentGateAcceptance(unbound)).toThrow(/manifest URL/);

    const ownerAsReviewer = acceptedGate();
    ownerAsReviewer.acceptance.independentReviewer.role = "security";
    expect(() => validateIndependentGateAcceptance(ownerAsReviewer)).toThrow(/must differ/);
  });

  it("rejects mixed candidate builds", () => {
    const first = acceptedGate();
    const second = acceptedGate();
    second.id = "accessibility-review";
    second.owner = "accessibility";
    second.acceptance.owner.role = "accessibility";
    second.acceptance.candidateBuildId = "c".repeat(40);

    expect(() => validateReviewedCandidateBuildConsistency([first, second])).toThrow(
      /must bind one candidate build/,
    );
    expect(validateReviewedCandidateBuildConsistency([first])).toBe("a".repeat(40));
  });
});
