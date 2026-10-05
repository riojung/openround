import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertStableEvidenceReference,
  validateIndependentGateAcceptance,
  validatePhase0ReadinessGateInventory,
  validateReviewedCandidateBuildConsistency,
} from "./ops/evidence-acceptance.mjs";
import { validateAcceptedReleaseLedger } from "./ops/release-acceptance.mjs";

const fileUrl = new URL("../docs/release-readiness.json", import.meta.url);
const ledger = JSON.parse(await readFile(fileUrl, "utf8"));
const allowedStatuses = new Set(["complete", "pending", "blocked", "not_applicable"]);
const requiredTarget = process.argv
  .find((argument) => argument.startsWith("--require="))
  ?.slice("--require=".length);

assert.equal(ledger.schemaVersion, 1, "release readiness schemaVersion must be 1");
assert.match(ledger.updatedAt, /^\d{4}-\d{2}-\d{2}$/, "updatedAt must use YYYY-MM-DD");
assert.ok(Array.isArray(ledger.gates) && ledger.gates.length > 0, "gates must not be empty");

const ids = new Set();
for (const gate of ledger.gates) {
  assert.match(gate.id, /^[a-z0-9-]+$/, `invalid gate id: ${String(gate.id)}`);
  assert.ok(!ids.has(gate.id), `duplicate gate id: ${gate.id}`);
  ids.add(gate.id);
  assert.ok(typeof gate.name === "string" && gate.name.length > 0, `${gate.id}: name is required`);
  assert.ok(
    typeof gate.owner === "string" && gate.owner.length > 0,
    `${gate.id}: owner is required`,
  );
  assert.ok(allowedStatuses.has(gate.status), `${gate.id}: unsupported status ${gate.status}`);
  assert.ok(
    Array.isArray(gate.requiredFor) && gate.requiredFor.length > 0,
    `${gate.id}: requiredFor is required`,
  );
  assert.ok(
    typeof gate.criterion === "string" && gate.criterion.length >= 20,
    `${gate.id}: criterion must be specific`,
  );
  assert.ok(Array.isArray(gate.evidence), `${gate.id}: evidence must be an array`);
  assert.equal(
    new Set(gate.evidence).size,
    gate.evidence.length,
    `${gate.id}: evidence references must be unique`,
  );
  for (const [index, reference] of gate.evidence.entries()) {
    assertStableEvidenceReference(reference, `${gate.id}: evidence[${index}]`);
  }
  if (gate.status === "complete") {
    assert.ok(gate.evidence.length > 0, `${gate.id}: completed gates require evidence`);
    assert.equal(
      gate.nextAction,
      undefined,
      `${gate.id}: completed gates must not retain a nextAction`,
    );
  }
  if (gate.status === "pending" || gate.status === "blocked") {
    assert.ok(
      typeof gate.nextAction === "string" && gate.nextAction.length > 0,
      `${gate.id}: incomplete gates require a nextAction`,
    );
  }
  if (gate.id === "signed-release") {
    if (gate.status !== "complete") {
      assert.equal(
        gate.releaseBinding,
        undefined,
        "signed-release: releaseBinding is valid only after acceptance",
      );
    }
  }
  validateIndependentGateAcceptance(gate);
}

validatePhase0ReadinessGateInventory(ledger.gates);

const signedRelease = ledger.gates.find((gate) => gate.id === "signed-release");
validateReviewedCandidateBuildConsistency(ledger.gates);
if (signedRelease?.status === "complete") {
  validateAcceptedReleaseLedger(ledger);
}

const statusCounts = Object.fromEntries(
  [...allowedStatuses].map((status) => [
    status,
    ledger.gates.filter((gate) => gate.status === status).length,
  ]),
);

process.stdout.write(`Release readiness ledger is valid: ${JSON.stringify(statusCounts)}\n`);

if (requiredTarget) {
  const required = ledger.gates.filter((gate) => gate.requiredFor.includes(requiredTarget));
  assert.ok(required.length > 0, `no gates are defined for target ${requiredTarget}`);
  const incomplete = required.filter((gate) => gate.status !== "complete");
  if (incomplete.length > 0) {
    process.stderr.write(
      `Release target ${requiredTarget} is not ready. Incomplete gates:\n${incomplete
        .map((gate) => `- ${gate.id}: ${gate.status} (${gate.owner})`)
        .join("\n")}\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(`Release target ${requiredTarget} is ready.\n`);
  }
}
