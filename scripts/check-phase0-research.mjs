import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const SEGMENTS = ["higher-education", "workplace"];
const FINAL_DISPOSITIONS = ["accepted", "rejected", "excluded"];
const REASON_CODES = [
  "eligibility-failure",
  "withdrawal",
  "unusable-protocol-record",
  "failed-instrumentation",
  "protocol-exclusion",
];
const SUBSTITUTION_REASON_CODES = ["eligibility-failure", "withdrawal", "unusable-protocol-record"];
const EVIDENCE_REFERENCE_PATTERN = /^(?:sha256:[a-f0-9]{64}|ref:[a-z0-9][a-z0-9._/-]{2,127})$/;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ID_PATTERNS = {
  facilitatorId: /^fac-[a-z0-9][a-z0-9-]{1,62}$/,
  partnerId: /^partner-[a-z0-9][a-z0-9-]{1,62}$/,
  sessionId: /^session-[a-z0-9][a-z0-9-]{1,62}$/,
  workflowId: /^workflow-[a-z0-9][a-z0-9-]{1,62}$/,
  studyId: /^study-[a-z0-9][a-z0-9-]{1,62}$/,
  failureId: /^failure-[a-z0-9][a-z0-9-]{1,62}$/,
  substitutionId: /^substitution-[a-z0-9][a-z0-9-]{1,62}$/,
};
const RAW_OR_PRIVATE_KEY_PARTS = new Set([
  "answer",
  "contact",
  "content",
  "consent",
  "credential",
  "email",
  "identity",
  "name",
  "note",
  "participant",
  "phone",
  "prompt",
  "quote",
  "recording",
  "response",
  "room",
  "secret",
  "token",
  "transcript",
]);
const USABILITY_RATE_METRICS = Object.freeze({
  starterSessionWithin5Minutes: { numeratorPercent: 80 },
  validNextActionWithin10Seconds: { numeratorPercent: 90 },
  firstSubmitWithoutHelp: { numeratorPercent: 95 },
  retainedResultWithin45Seconds: { numeratorPercent: 100 },
  mainUnresolvedConceptWithin45Seconds: { numeratorPercent: 100 },
  recoveryRehearsalWithoutHelp: { numeratorPercent: 80 },
});
const USABILITY_TIMING_METRICS = Object.freeze([
  "blankRoundPublishSeconds",
  "savedAcknowledgementMilliseconds",
]);
const MAX_USABILITY_SAMPLE_SIZE = 500;
const MAXIMUM_CLOCK_SKEW_MILLISECONDS = 5 * 60_000;
const USABILITY_METRIC_POPULATIONS = Object.freeze({
  starterSessionWithin5Minutes: "facilitator",
  blankRoundPublishSeconds: "facilitator",
  validNextActionWithin10Seconds: "facilitator",
  firstSubmitWithoutHelp: "participant",
  savedAcknowledgementMilliseconds: "participant",
  retainedResultWithin45Seconds: "facilitator",
  mainUnresolvedConceptWithin45Seconds: "facilitator",
  recoveryRehearsalWithoutHelp: "facilitator",
});

export class Phase0ResearchValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "Phase0ResearchValidationError";
  }
}

function invalid(path, message) {
  throw new Phase0ResearchValidationError(`${path}: ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertObject(value, path) {
  if (!isPlainObject(value)) invalid(path, "must be an object");
  return value;
}

function assertAllowedKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      invalid(path, `unsupported field ${JSON.stringify(key)}; raw/private fields are forbidden`);
    }
  }
  for (const key of allowed) {
    if (!(key in value)) invalid(path, `missing required field ${JSON.stringify(key)}`);
  }
}

function normalizedKeyParts(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function assertNoRawPrivateKeys(value, path = "aggregate") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRawPrivateKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (normalizedKeyParts(key).some((part) => RAW_OR_PRIVATE_KEY_PARTS.has(part))) {
      invalid(`${path}.${key}`, "raw/private field names are forbidden");
    }
    assertNoRawPrivateKeys(child, `${path}.${key}`);
  }
}

function assertEnum(value, allowed, path) {
  if (!allowed.includes(value)) {
    if (value === "pending" && allowed === FINAL_DISPOSITIONS) {
      invalid(path, "pending in-scope records are forbidden");
    }
    invalid(path, `must be one of ${allowed.join(", ")}`);
  }
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") invalid(path, "must be a boolean");
}

function assertInteger(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    invalid(path, `must be a safe integer greater than or equal to ${minimum}`);
  }
}

function assertBoundedInteger(value, path, minimum, maximum) {
  assertInteger(value, path, minimum);
  if (value > maximum) invalid(path, `must be less than or equal to ${maximum}`);
}

function assertNullableNumber(value, path) {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    invalid(path, "must be null or a finite non-negative number");
  }
}

function assertPattern(value, pattern, path, description) {
  if (typeof value !== "string" || !pattern.test(value)) invalid(path, description);
}

function assertEvidenceReferences(value, path, { required = true } = {}) {
  if (!Array.isArray(value)) invalid(path, "must be an array");
  if (required && value.length === 0) invalid(path, "must contain reviewed evidence");
  const unique = new Set();
  for (const [index, reference] of value.entries()) {
    assertPattern(
      reference,
      EVIDENCE_REFERENCE_PATTERN,
      `${path}[${index}]`,
      "must be a sha256:<64 lowercase hex> checksum or redaction-safe ref:<opaque-id>",
    );
    if (unique.has(reference)) invalid(`${path}[${index}]`, "duplicate evidence reference");
    unique.add(reference);
  }
}

function assertStableId(value, kind, path) {
  assertPattern(value, ID_PATTERNS[kind], path, `must be a redaction-safe ${kind}`);
}

function registerUniqueId(seen, value, path) {
  if (seen.has(value)) invalid(path, `duplicate stable ID ${JSON.stringify(value)}`);
  seen.add(value);
}

function assertFinalReviewMetadata(record, path) {
  assertEnum(record.independentReview, ["accepted"], `${path}.independentReview`);
  if (record.reasonCode !== null) {
    assertEnum(record.reasonCode, REASON_CODES, `${path}.reasonCode`);
  }
  if (record.disposition === "accepted" && record.reasonCode !== null) {
    invalid(`${path}.reasonCode`, "must be null for an accepted record");
  }
  if (record.disposition !== "accepted" && record.reasonCode === null) {
    invalid(
      `${path}.reasonCode`,
      "a rejected or excluded record requires a predeclared reason code",
    );
  }
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function belongsToReviewedAttemptPopulation(session) {
  // A timing/connectivity exclusion must not select its affected attempts out of
  // the Access rate merely because it also makes the enclosing session excluded.
  // Other rejected/excluded session records remain outside this population.
  return (
    session.independentReview === "accepted" &&
    session.eligibleAttempts > 0 &&
    ((session.disposition === "accepted" && session.eligible) || session.timingConnectivityExcluded)
  );
}

function percentileNearestRank(values, percentile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
}

function validateRateMetric(value, path) {
  const metric = assertObject(value, path);
  assertAllowedKeys(metric, ["numerator", "denominator"], path);
  assertInteger(metric.numerator, `${path}.numerator`);
  assertInteger(metric.denominator, `${path}.denominator`, 1);
  if (metric.numerator > metric.denominator) {
    invalid(path, "numerator cannot exceed denominator");
  }
  return metric;
}

function validateTimingMetric(value, path) {
  const metric = assertObject(value, path);
  assertAllowedKeys(metric, ["samples"], path);
  if (!Array.isArray(metric.samples) || metric.samples.length === 0) {
    invalid(`${path}.samples`, "must contain the complete non-empty timing sample");
  }
  if (metric.samples.length > 500) invalid(`${path}.samples`, "must contain at most 500 samples");
  metric.samples.forEach((sample, index) => assertInteger(sample, `${path}.samples[${index}]`));
  return metric;
}

function computeUsabilityMetricPasses(metrics) {
  const passes = Object.fromEntries(
    Object.entries(USABILITY_RATE_METRICS).map(([key, { numeratorPercent }]) => {
      const metric = metrics[key];
      return [
        key,
        BigInt(metric.numerator) * 100n >= BigInt(metric.denominator) * BigInt(numeratorPercent),
      ];
    }),
  );
  passes.blankRoundPublishSeconds = median(metrics.blankRoundPublishSeconds.samples) < 300;
  passes.savedAcknowledgementMilliseconds =
    percentileNearestRank(metrics.savedAcknowledgementMilliseconds.samples, 0.95) < 1_000;
  return passes;
}

function compareRatio(left, right) {
  const leftProduct = BigInt(left.numerator) * BigInt(right.denominator);
  const rightProduct = BigInt(right.numerator) * BigInt(left.denominator);
  return leftProduct > rightProduct ? 1 : leftProduct < rightProduct ? -1 : 0;
}

function validateCampaign(value, now) {
  const campaign = assertObject(value, "aggregate.campaign");
  assertAllowedKeys(
    campaign,
    [
      "protocolVersion",
      "cohortVersion",
      "cohortFrozen",
      "primaryCohortFrozen",
      "cutoffUtc",
      "evidenceReferences",
    ],
    "aggregate.campaign",
  );
  assertPattern(
    campaign.protocolVersion,
    VERSION_PATTERN,
    "aggregate.campaign.protocolVersion",
    "must be a redaction-safe version token",
  );
  assertPattern(
    campaign.cohortVersion,
    VERSION_PATTERN,
    "aggregate.campaign.cohortVersion",
    "must be a redaction-safe version token",
  );
  assertBoolean(campaign.cohortFrozen, "aggregate.campaign.cohortFrozen");
  assertBoolean(campaign.primaryCohortFrozen, "aggregate.campaign.primaryCohortFrozen");
  if (campaign.cutoffUtc !== null) {
    assertPattern(
      campaign.cutoffUtc,
      UTC_PATTERN,
      "aggregate.campaign.cutoffUtc",
      "must be null or an ISO 8601 UTC timestamp",
    );
    const cutoffMilliseconds = Date.parse(campaign.cutoffUtc);
    if (Number.isNaN(cutoffMilliseconds)) {
      invalid("aggregate.campaign.cutoffUtc", "must be a real UTC timestamp");
    }
    const normalizedInput = campaign.cutoffUtc.includes(".")
      ? campaign.cutoffUtc
      : campaign.cutoffUtc.replace("Z", ".000Z");
    if (new Date(campaign.cutoffUtc).toISOString() !== normalizedInput) {
      invalid("aggregate.campaign.cutoffUtc", "must be a real UTC calendar timestamp");
    }
    if (cutoffMilliseconds > now.getTime() + MAXIMUM_CLOCK_SKEW_MILLISECONDS) {
      invalid("aggregate.campaign.cutoffUtc", "cannot be in the future");
    }
  }
  assertEvidenceReferences(campaign.evidenceReferences, "aggregate.campaign.evidenceReferences", {
    required: campaign.cohortFrozen,
  });
  if (campaign.cohortFrozen !== (campaign.cutoffUtc !== null)) {
    invalid(
      "aggregate.campaign",
      "cohortFrozen and cutoffUtc must become final together before aggregation",
    );
  }
  if (campaign.primaryCohortFrozen && !campaign.cohortFrozen) {
    invalid("aggregate.campaign.primaryCohortFrozen", "requires a frozen cohort and cutoff");
  }
  return campaign;
}

function validateFacilitators(values, campaign, globalIds) {
  if (!Array.isArray(values)) invalid("aggregate.facilitators", "must be an array");
  const enrollmentOrders = new Set();
  const facilitatorsById = new Map();
  const partnerSegments = new Map();

  for (const [index, raw] of values.entries()) {
    const path = `aggregate.facilitators[${index}]`;
    const facilitator = assertObject(raw, path);
    assertAllowedKeys(
      facilitator,
      [
        "facilitatorId",
        "partnerId",
        "segment",
        "enrollmentOrder",
        "eligibleAtFreeze",
        "initialPrimary",
        "primary",
        "disposition",
        "eligible",
        "recurringProblem",
        "activationSeconds",
        "willingnessToPay",
        "reasonCode",
        "independentReview",
        "evidenceReferences",
      ],
      path,
    );
    assertStableId(facilitator.facilitatorId, "facilitatorId", `${path}.facilitatorId`);
    assertStableId(facilitator.partnerId, "partnerId", `${path}.partnerId`);
    registerUniqueId(globalIds, facilitator.facilitatorId, `${path}.facilitatorId`);
    assertEnum(facilitator.segment, SEGMENTS, `${path}.segment`);
    assertInteger(facilitator.enrollmentOrder, `${path}.enrollmentOrder`, 1);
    assertBoolean(facilitator.eligibleAtFreeze, `${path}.eligibleAtFreeze`);
    assertBoolean(facilitator.initialPrimary, `${path}.initialPrimary`);
    assertBoolean(facilitator.primary, `${path}.primary`);
    assertEnum(facilitator.disposition, FINAL_DISPOSITIONS, `${path}.disposition`);
    assertBoolean(facilitator.eligible, `${path}.eligible`);
    assertBoolean(facilitator.recurringProblem, `${path}.recurringProblem`);
    assertNullableNumber(facilitator.activationSeconds, `${path}.activationSeconds`);
    assertEnum(facilitator.willingnessToPay, ["yes", "no", "unknown"], `${path}.willingnessToPay`);
    assertFinalReviewMetadata(facilitator, path);
    assertEvidenceReferences(facilitator.evidenceReferences, `${path}.evidenceReferences`);

    const orderKey = `${facilitator.segment}:${facilitator.enrollmentOrder}`;
    if (enrollmentOrders.has(orderKey)) {
      invalid(`${path}.enrollmentOrder`, "duplicate enrollment order within segment");
    }
    enrollmentOrders.add(orderKey);
    const priorPartnerSegment = partnerSegments.get(facilitator.partnerId);
    if (priorPartnerSegment && priorPartnerSegment !== facilitator.segment) {
      invalid(`${path}.partnerId`, "a stable partner ID cannot appear in both segments");
    }
    partnerSegments.set(facilitator.partnerId, facilitator.segment);
    if (facilitator.disposition === "accepted" && !facilitator.eligible) {
      invalid(path, "an accepted facilitator must be eligible");
    }
    if (facilitator.initialPrimary && !facilitator.eligibleAtFreeze) {
      invalid(path, "an initial primary facilitator must have been eligible at freeze");
    }
    if (facilitator.primary && facilitator.disposition !== "accepted") {
      invalid(path, "a primary facilitator must have an accepted disposition");
    }
    if (facilitator.primary && !facilitator.eligible) {
      invalid(path, "a primary facilitator must be eligible");
    }
    if ((facilitator.initialPrimary || facilitator.primary) && !campaign.primaryCohortFrozen) {
      invalid(path, "primary membership cannot be set before the primary cohort is frozen");
    }
    facilitatorsById.set(facilitator.facilitatorId, facilitator);
  }

  if (campaign.primaryCohortFrozen) {
    for (const segment of SEGMENTS) {
      const orderedEligibleAtFreeze = values
        .filter((facilitator) => facilitator.segment === segment && facilitator.eligibleAtFreeze)
        .sort((left, right) => left.enrollmentOrder - right.enrollmentOrder);
      if (orderedEligibleAtFreeze.length < 6) {
        invalid(
          "aggregate.campaign.primaryCohortFrozen",
          `cannot freeze a six-person ${segment} primary cohort with ${orderedEligibleAtFreeze.length} eligible-at-freeze facilitators`,
        );
      }
      const expected = new Set(
        orderedEligibleAtFreeze.slice(0, 6).map(({ facilitatorId }) => facilitatorId),
      );
      const actual = values.filter(
        (facilitator) => facilitator.segment === segment && facilitator.initialPrimary,
      );
      if (actual.length !== 6 || actual.some(({ facilitatorId }) => !expected.has(facilitatorId))) {
        invalid(
          "aggregate.facilitators",
          `${segment} initial primary cohort must be the first six eligible-at-freeze facilitators by enrollmentOrder`,
        );
      }
    }
  }

  return facilitatorsById;
}

function validateCohortSubstitutions(values, facilitatorsById, campaign, globalIds) {
  if (!Array.isArray(values)) invalid("aggregate.cohortSubstitutions", "must be an array");
  if (!campaign.primaryCohortFrozen && values.length > 0) {
    invalid(
      "aggregate.cohortSubstitutions",
      "cannot substitute before the primary cohort is frozen",
    );
  }
  const sequenceKeys = new Set();
  for (const [index, raw] of values.entries()) {
    const path = `aggregate.cohortSubstitutions[${index}]`;
    const substitution = assertObject(raw, path);
    assertAllowedKeys(
      substitution,
      [
        "substitutionId",
        "segment",
        "sequence",
        "removedFacilitatorId",
        "reserveFacilitatorId",
        "reasonCode",
        "independentReview",
        "evidenceReferences",
      ],
      path,
    );
    assertStableId(substitution.substitutionId, "substitutionId", `${path}.substitutionId`);
    registerUniqueId(globalIds, substitution.substitutionId, `${path}.substitutionId`);
    assertEnum(substitution.segment, SEGMENTS, `${path}.segment`);
    assertInteger(substitution.sequence, `${path}.sequence`, 1);
    assertStableId(
      substitution.removedFacilitatorId,
      "facilitatorId",
      `${path}.removedFacilitatorId`,
    );
    assertStableId(
      substitution.reserveFacilitatorId,
      "facilitatorId",
      `${path}.reserveFacilitatorId`,
    );
    assertEnum(substitution.reasonCode, SUBSTITUTION_REASON_CODES, `${path}.reasonCode`);
    assertEnum(substitution.independentReview, ["accepted"], `${path}.independentReview`);
    assertEvidenceReferences(substitution.evidenceReferences, `${path}.evidenceReferences`);
    const sequenceKey = `${substitution.segment}:${substitution.sequence}`;
    if (sequenceKeys.has(sequenceKey)) {
      invalid(`${path}.sequence`, "duplicate substitution sequence within segment");
    }
    sequenceKeys.add(sequenceKey);
  }

  if (!campaign.primaryCohortFrozen) return;
  for (const segment of SEGMENTS) {
    const segmentFacilitators = [...facilitatorsById.values()]
      .filter((facilitator) => facilitator.segment === segment)
      .sort((left, right) => left.enrollmentOrder - right.enrollmentOrder);
    const initialPrimary = segmentFacilitators.filter(({ initialPrimary }) => initialPrimary);
    const active = new Set(initialPrimary.map(({ facilitatorId }) => facilitatorId));
    const usedReserves = new Set();
    const substitutions = values
      .filter((substitution) => substitution.segment === segment)
      .sort((left, right) => left.sequence - right.sequence);
    substitutions.forEach((substitution, index) => {
      const path = `aggregate.cohortSubstitutions[${values.indexOf(substitution)}]`;
      if (substitution.sequence !== index + 1) {
        invalid(`${path}.sequence`, `must be contiguous from 1 within ${segment}`);
      }
      const removed = facilitatorsById.get(substitution.removedFacilitatorId);
      const reserve = facilitatorsById.get(substitution.reserveFacilitatorId);
      if (!removed || removed.segment !== segment) {
        invalid(`${path}.removedFacilitatorId`, `must reference a ${segment} facilitator`);
      }
      if (!reserve || reserve.segment !== segment) {
        invalid(`${path}.reserveFacilitatorId`, `must reference a ${segment} facilitator`);
      }
      if (!active.has(removed.facilitatorId)) {
        invalid(`${path}.removedFacilitatorId`, "must be active when it is substituted");
      }
      if (removed.disposition === "accepted") {
        invalid(`${path}.removedFacilitatorId`, "a substituted facilitator cannot remain accepted");
      }
      if (removed.reasonCode !== substitution.reasonCode) {
        invalid(`${path}.reasonCode`, "must match the removed facilitator's reviewed reason code");
      }
      if (
        reserve.initialPrimary ||
        !reserve.eligibleAtFreeze ||
        active.has(reserve.facilitatorId) ||
        usedReserves.has(reserve.facilitatorId)
      ) {
        invalid(
          `${path}.reserveFacilitatorId`,
          "must reference an unused reserve that was eligible at freeze",
        );
      }
      const removedLater = substitutions
        .slice(index + 1)
        .some(({ removedFacilitatorId }) => removedFacilitatorId === reserve.facilitatorId);
      if ((reserve.disposition !== "accepted" || !reserve.eligible) && !removedLater) {
        invalid(
          `${path}.reserveFacilitatorId`,
          "must finish accepted and eligible or be removed by a later reviewed substitution",
        );
      }
      const nextReserve = segmentFacilitators.find(
        (facilitator) =>
          !facilitator.initialPrimary &&
          facilitator.eligibleAtFreeze &&
          !usedReserves.has(facilitator.facilitatorId),
      );
      if (!nextReserve || nextReserve.facilitatorId !== reserve.facilitatorId) {
        invalid(
          `${path}.reserveFacilitatorId`,
          "must be the next eligible reserve by enrollmentOrder",
        );
      }
      active.delete(removed.facilitatorId);
      active.add(reserve.facilitatorId);
      usedReserves.add(reserve.facilitatorId);
    });

    for (const facilitatorId of active) {
      const facilitator = facilitatorsById.get(facilitatorId);
      if (facilitator.disposition !== "accepted" || !facilitator.eligible) {
        invalid(
          "aggregate.cohortSubstitutions",
          `${facilitatorId} needs an allowed reviewed substitution before campaign closure`,
        );
      }
    }
    const actualPrimary = new Set(
      segmentFacilitators
        .filter(({ primary }) => primary)
        .map(({ facilitatorId }) => facilitatorId),
    );
    if (
      actualPrimary.size !== active.size ||
      [...active].some((facilitatorId) => !actualPrimary.has(facilitatorId))
    ) {
      invalid(
        "aggregate.facilitators",
        `${segment} final primary cohort does not match the reviewed substitution chain`,
      );
    }
  }
}

function validateSessions(values, facilitatorsById, globalIds) {
  if (!Array.isArray(values)) invalid("aggregate.sessions", "must be an array");
  const workflowBindings = new Map();

  for (const [index, raw] of values.entries()) {
    const path = `aggregate.sessions[${index}]`;
    const session = assertObject(raw, path);
    assertAllowedKeys(
      session,
      [
        "sessionId",
        "facilitatorId",
        "partnerId",
        "workflowId",
        "segment",
        "disposition",
        "eligible",
        "recoveryEligibleCheckpoints",
        "recoveryCompleteCheckpoints",
        "eligibleAttempts",
        "timingConnectivityAffectedAttempts",
        "timingConnectivityExcluded",
        "seriousAccessibilityFinding",
        "externalDeckUsed",
        "materialContextSwitch",
        "reasonCode",
        "independentReview",
        "evidenceReferences",
      ],
      path,
    );
    assertStableId(session.sessionId, "sessionId", `${path}.sessionId`);
    assertStableId(session.facilitatorId, "facilitatorId", `${path}.facilitatorId`);
    assertStableId(session.partnerId, "partnerId", `${path}.partnerId`);
    assertStableId(session.workflowId, "workflowId", `${path}.workflowId`);
    registerUniqueId(globalIds, session.sessionId, `${path}.sessionId`);
    assertEnum(session.segment, SEGMENTS, `${path}.segment`);
    assertEnum(session.disposition, FINAL_DISPOSITIONS, `${path}.disposition`);
    assertBoolean(session.eligible, `${path}.eligible`);
    for (const field of [
      "recoveryEligibleCheckpoints",
      "recoveryCompleteCheckpoints",
      "eligibleAttempts",
      "timingConnectivityAffectedAttempts",
    ]) {
      assertInteger(session[field], `${path}.${field}`);
    }
    for (const field of [
      "timingConnectivityExcluded",
      "seriousAccessibilityFinding",
      "externalDeckUsed",
      "materialContextSwitch",
    ]) {
      assertBoolean(session[field], `${path}.${field}`);
    }
    assertFinalReviewMetadata(session, path);
    assertEvidenceReferences(session.evidenceReferences, `${path}.evidenceReferences`);
    if (session.recoveryCompleteCheckpoints > session.recoveryEligibleCheckpoints) {
      invalid(path, "recoveryCompleteCheckpoints cannot exceed recoveryEligibleCheckpoints");
    }
    if (session.timingConnectivityAffectedAttempts > session.eligibleAttempts) {
      invalid(path, "timingConnectivityAffectedAttempts cannot exceed eligibleAttempts");
    }
    if (session.timingConnectivityExcluded && session.timingConnectivityAffectedAttempts === 0) {
      invalid(path, "timingConnectivityExcluded requires at least one affected eligible attempt");
    }
    if (session.disposition === "accepted" && !session.eligible) {
      invalid(path, "an accepted session must be eligible");
    }
    if (session.disposition === "accepted" && session.eligibleAttempts === 0) {
      invalid(
        `${path}.eligibleAttempts`,
        "accepted sessions require a positive attempt denominator",
      );
    }

    const facilitator = facilitatorsById.get(session.facilitatorId);
    if (!facilitator) invalid(`${path}.facilitatorId`, "must reference a facilitator record");
    if (facilitator.partnerId !== session.partnerId || facilitator.segment !== session.segment) {
      invalid(path, "session partner and segment must match its facilitator record");
    }
    if (session.disposition === "accepted" && facilitator.disposition !== "accepted") {
      invalid(path, "an accepted session must reference an accepted facilitator");
    }

    const binding = `${session.partnerId}:${session.segment}`;
    const priorBinding = workflowBindings.get(session.workflowId);
    if (priorBinding && priorBinding !== binding) {
      invalid(`${path}.workflowId`, "a stable workflow ID cannot change partner or segment");
    }
    workflowBindings.set(session.workflowId, binding);
  }
}

function validateUsability(values, globalIds) {
  if (!Array.isArray(values)) invalid("aggregate.usability", "must be an array");
  const recordsBySegment = new Map(SEGMENTS.map((segment) => [segment, []]));

  for (const [index, raw] of values.entries()) {
    const path = `aggregate.usability[${index}]`;
    const usability = assertObject(raw, path);
    assertAllowedKeys(
      usability,
      [
        "studyId",
        "segment",
        "attemptOrder",
        "supersedesStudyId",
        "disposition",
        "result",
        "eligibleFirstTimeFacilitators",
        "eligibleParticipants",
        "metrics",
        "reasonCode",
        "independentReview",
        "evidenceReferences",
      ],
      path,
    );
    assertStableId(usability.studyId, "studyId", `${path}.studyId`);
    registerUniqueId(globalIds, usability.studyId, `${path}.studyId`);
    assertEnum(usability.segment, SEGMENTS, `${path}.segment`);
    assertInteger(usability.attemptOrder, `${path}.attemptOrder`, 1);
    if (usability.supersedesStudyId !== null) {
      assertStableId(usability.supersedesStudyId, "studyId", `${path}.supersedesStudyId`);
      if (usability.supersedesStudyId === usability.studyId) {
        invalid(`${path}.supersedesStudyId`, "cannot reference the same study");
      }
    }
    assertEnum(usability.disposition, FINAL_DISPOSITIONS, `${path}.disposition`);
    assertEnum(usability.result, ["accepted", "rejected", "not-evaluated"], `${path}.result`);
    assertBoundedInteger(
      usability.eligibleFirstTimeFacilitators,
      `${path}.eligibleFirstTimeFacilitators`,
      0,
      MAX_USABILITY_SAMPLE_SIZE,
    );
    assertBoundedInteger(
      usability.eligibleParticipants,
      `${path}.eligibleParticipants`,
      0,
      MAX_USABILITY_SAMPLE_SIZE,
    );
    let metrics = null;
    if (usability.metrics !== null) {
      metrics = assertObject(usability.metrics, `${path}.metrics`);
      assertAllowedKeys(
        metrics,
        [...Object.keys(USABILITY_RATE_METRICS), ...USABILITY_TIMING_METRICS],
        `${path}.metrics`,
      );
      for (const key of Object.keys(USABILITY_RATE_METRICS)) {
        validateRateMetric(metrics[key], `${path}.metrics.${key}`);
      }
      for (const key of USABILITY_TIMING_METRICS) {
        validateTimingMetric(metrics[key], `${path}.metrics.${key}`);
      }
    }
    assertFinalReviewMetadata(usability, path);
    assertEvidenceReferences(usability.evidenceReferences, `${path}.evidenceReferences`);
    recordsBySegment.get(usability.segment).push({ record: usability, path });
    if (usability.disposition === "accepted") {
      if (!metrics) invalid(`${path}.metrics`, "an accepted usability record requires metrics");
      if (usability.result === "not-evaluated") {
        invalid(path, "an accepted usability record requires an accepted or rejected result");
      }
      if (usability.eligibleParticipants === 0) {
        invalid(`${path}.eligibleParticipants`, "an accepted usability result needs a denominator");
      }
      if (usability.eligibleFirstTimeFacilitators === 0) {
        invalid(
          `${path}.eligibleFirstTimeFacilitators`,
          "an accepted usability result needs a facilitator denominator",
        );
      }
      if (usability.eligibleFirstTimeFacilitators < 6 || usability.eligibleParticipants < 20) {
        invalid(
          path,
          "an accepted usability record requires at least 6 eligible first-time facilitators and 20 eligible participants",
        );
      }
      for (const [key, population] of Object.entries(USABILITY_METRIC_POPULATIONS)) {
        const expected =
          population === "facilitator"
            ? usability.eligibleFirstTimeFacilitators
            : usability.eligibleParticipants;
        const metric = metrics[key];
        const actual = "denominator" in metric ? metric.denominator : metric.samples.length;
        if (actual !== expected) {
          invalid(
            `${path}.metrics.${key}`,
            `must cover all ${expected} eligible ${population}s; exclusions and failed instrumentation belong in a final rejected/excluded study record`,
          );
        }
      }
      const metricPasses = computeUsabilityMetricPasses(metrics);
      const computedResult = Object.values(metricPasses).every(Boolean) ? "accepted" : "rejected";
      if (usability.result !== computedResult) {
        invalid(
          `${path}.result`,
          `declares ${JSON.stringify(usability.result)}, but the eight journey metrics recompute to ${JSON.stringify(computedResult)}`,
        );
      }
    } else {
      if (usability.result !== "not-evaluated") {
        invalid(path, "a rejected or excluded usability record must be not-evaluated");
      }
      if (metrics !== null) {
        invalid(`${path}.metrics`, "a rejected or excluded usability record must use null metrics");
      }
    }
  }

  const decisionRecords = new Map();
  for (const segment of SEGMENTS) {
    const attempts = recordsBySegment
      .get(segment)
      .toSorted((left, right) => left.record.attemptOrder - right.record.attemptOrder);
    for (const [index, attempt] of attempts.entries()) {
      const expectedOrder = index + 1;
      if (attempt.record.attemptOrder !== expectedOrder) {
        invalid(
          `${attempt.path}.attemptOrder`,
          `must form a contiguous per-segment sequence beginning at 1; expected ${expectedOrder}`,
        );
      }
      const expectedSupersededId = index === 0 ? null : attempts[index - 1].record.studyId;
      if (attempt.record.supersedesStudyId !== expectedSupersededId) {
        invalid(
          `${attempt.path}.supersedesStudyId`,
          index === 0
            ? "must be null for the first segment attempt"
            : `must reference the immediately preceding study ${expectedSupersededId}`,
        );
      }
    }
    const accepted = attempts.filter(({ record }) => record.disposition === "accepted");
    if (accepted.length > 1) {
      invalid(
        `aggregate.usability.${segment}`,
        "must contain at most one eligible accepted decision record",
      );
    }
    if (accepted.length === 1) {
      const acceptedAttempt = accepted[0];
      if (acceptedAttempt !== attempts.at(-1)) {
        invalid(
          `${acceptedAttempt.path}.disposition`,
          "the accepted decision record must be the final attempt in its segment chain",
        );
      }
      decisionRecords.set(segment, acceptedAttempt.record);
    }
  }
  return decisionRecords;
}

function validateMeasuredFailures(values, globalIds) {
  if (!Array.isArray(values)) invalid("aggregate.measuredFailures", "must be an array");
  for (const [index, raw] of values.entries()) {
    const path = `aggregate.measuredFailures[${index}]`;
    const failure = assertObject(raw, path);
    assertAllowedKeys(
      failure,
      [
        "failureId",
        "kind",
        "disposition",
        "affected",
        "eligibleDenominator",
        "severity",
        "reasonCode",
        "independentReview",
        "evidenceReferences",
      ],
      path,
    );
    assertStableId(failure.failureId, "failureId", `${path}.failureId`);
    registerUniqueId(globalIds, failure.failureId, `${path}.failureId`);
    assertEnum(failure.kind, ["activation", "correctness"], `${path}.kind`);
    assertEnum(failure.disposition, FINAL_DISPOSITIONS, `${path}.disposition`);
    assertInteger(failure.affected, `${path}.affected`);
    assertInteger(failure.eligibleDenominator, `${path}.eligibleDenominator`, 1);
    assertEnum(failure.severity, ["low", "moderate", "serious", "critical"], `${path}.severity`);
    assertFinalReviewMetadata(failure, path);
    assertEvidenceReferences(failure.evidenceReferences, `${path}.evidenceReferences`);
    if (failure.affected > failure.eligibleDenominator) {
      invalid(path, "affected cannot exceed eligibleDenominator");
    }
    if (failure.disposition === "accepted" && failure.affected === 0) {
      invalid(`${path}.affected`, "an accepted failure must affect at least one eligible unit");
    }
  }
}

function validateAggregateReview(value) {
  const review = assertObject(value, "aggregate.aggregateReview");
  assertAllowedKeys(
    review,
    ["researchOwnerDecision", "independentReviewerDecision", "evidenceReferences"],
    "aggregate.aggregateReview",
  );
  assertEnum(
    review.researchOwnerDecision,
    ["accepted", "rejected", "pending"],
    "aggregate.aggregateReview.researchOwnerDecision",
  );
  assertEnum(
    review.independentReviewerDecision,
    ["accepted", "rejected", "pending"],
    "aggregate.aggregateReview.independentReviewerDecision",
  );
  const hasFinalDecision =
    review.researchOwnerDecision !== "pending" || review.independentReviewerDecision !== "pending";
  assertEvidenceReferences(
    review.evidenceReferences,
    "aggregate.aggregateReview.evidenceReferences",
    {
      required: hasFinalDecision,
    },
  );
  return review;
}

function validateDeclaredDecisions(value) {
  const decisions = assertObject(value, "aggregate.declaredDecisions");
  assertAllowedKeys(
    decisions,
    [
      "phase0Gate",
      "acquisitionSegment",
      "accessGate",
      "companionGate",
      "phase1Branch",
      "measuredFailureId",
    ],
    "aggregate.declaredDecisions",
  );
  assertEnum(
    decisions.phase0Gate,
    ["accepted", "rejected", "pending"],
    "aggregate.declaredDecisions.phase0Gate",
  );
  assertEnum(
    decisions.acquisitionSegment,
    [...SEGMENTS, "pending"],
    "aggregate.declaredDecisions.acquisitionSegment",
  );
  assertEnum(
    decisions.accessGate,
    ["pass", "fail", "pending"],
    "aggregate.declaredDecisions.accessGate",
  );
  assertEnum(
    decisions.companionGate,
    ["pass", "fail", "not-evaluated", "pending"],
    "aggregate.declaredDecisions.companionGate",
  );
  assertEnum(
    decisions.phase1Branch,
    ["access", "companion", "measured-failure", "pending"],
    "aggregate.declaredDecisions.phase1Branch",
  );
  if (decisions.measuredFailureId !== null) {
    assertStableId(
      decisions.measuredFailureId,
      "failureId",
      "aggregate.declaredDecisions.measuredFailureId",
    );
  }
  return decisions;
}

function segmentMetrics(segment, facilitators, sessions) {
  const eligibleFacilitators = facilitators.filter(
    (facilitator) =>
      facilitator.segment === segment &&
      facilitator.disposition === "accepted" &&
      facilitator.eligible,
  );
  const acceptedSessions = sessions.filter(
    (session) =>
      session.segment === segment && session.disposition === "accepted" && session.eligible,
  );
  const sessionsByPartner = new Map();
  for (const session of acceptedSessions) {
    const ids = sessionsByPartner.get(session.partnerId) ?? new Set();
    ids.add(session.sessionId);
    sessionsByPartner.set(session.partnerId, ids);
  }
  const repeatPartners = [...sessionsByPartner.values()].filter((ids) => ids.size >= 2).length;
  const recoveryCompleteCheckpoints = acceptedSessions.reduce(
    (total, session) => total + session.recoveryCompleteCheckpoints,
    0,
  );
  const recoveryEligibleCheckpoints = acceptedSessions.reduce(
    (total, session) => total + session.recoveryEligibleCheckpoints,
    0,
  );
  const willingnessKnown = eligibleFacilitators.filter(
    ({ willingnessToPay }) => willingnessToPay !== "unknown",
  );
  const willingnessYes = willingnessKnown.filter(
    ({ willingnessToPay }) => willingnessToPay === "yes",
  ).length;
  const activationValues = eligibleFacilitators.map(({ activationSeconds }) => activationSeconds);
  const activationCoverageComplete = activationValues.every((value) => value !== null);

  return {
    eligibleFacilitators: eligibleFacilitators.length,
    primaryFacilitators: eligibleFacilitators.filter(({ primary }) => primary).length,
    repeatPartners,
    observedSessions: acceptedSessions.length,
    recoveryCompleteCheckpoints,
    recoveryEligibleCheckpoints,
    medianActivationSeconds: activationCoverageComplete ? median(activationValues) : null,
    activationCoverageComplete,
    willingnessToPay: {
      yes: willingnessYes,
      known: willingnessKnown.length,
      rate: ratio(willingnessYes, willingnessKnown.length),
    },
  };
}

function chooseAcquisitionSegment(metricsBySegment) {
  const education = metricsBySegment["higher-education"];
  const workplace = metricsBySegment.workplace;
  const educationDominates =
    education.repeatPartners >= workplace.repeatPartners &&
    education.recoveryCompleteCheckpoints >= workplace.recoveryCompleteCheckpoints &&
    (education.repeatPartners > workplace.repeatPartners ||
      education.recoveryCompleteCheckpoints > workplace.recoveryCompleteCheckpoints);
  const workplaceDominates =
    workplace.repeatPartners >= education.repeatPartners &&
    workplace.recoveryCompleteCheckpoints >= education.recoveryCompleteCheckpoints &&
    (workplace.repeatPartners > education.repeatPartners ||
      workplace.recoveryCompleteCheckpoints > education.recoveryCompleteCheckpoints);

  if (educationDominates) return "higher-education";
  if (workplaceDominates) return "workplace";
  const leadingMeasuresTied =
    education.repeatPartners === workplace.repeatPartners &&
    education.recoveryCompleteCheckpoints === workplace.recoveryCompleteCheckpoints;
  if (!leadingMeasuresTied) return "pending";

  if (education.medianActivationSeconds === null || workplace.medianActivationSeconds === null) {
    return "pending";
  }
  if (education.medianActivationSeconds < workplace.medianActivationSeconds) {
    return "higher-education";
  }
  if (workplace.medianActivationSeconds < education.medianActivationSeconds) return "workplace";

  const educationWtp = education.willingnessToPay;
  const workplaceWtp = workplace.willingnessToPay;
  if (
    educationWtp.known !== education.eligibleFacilitators ||
    workplaceWtp.known !== workplace.eligibleFacilitators
  ) {
    return "pending";
  }
  const comparison = compareRatio(
    { numerator: educationWtp.yes, denominator: educationWtp.known },
    { numerator: workplaceWtp.yes, denominator: workplaceWtp.known },
  );
  if (comparison > 0) return "higher-education";
  if (comparison < 0) return "workplace";
  return "pending";
}

function selectLargestFailure(failures) {
  const accepted = failures.filter(({ disposition }) => disposition === "accepted");
  if (accepted.length === 0) return null;
  let leaders = [accepted[0]];
  for (const failure of accepted.slice(1)) {
    const comparison = compareRatio(
      { numerator: failure.affected, denominator: failure.eligibleDenominator },
      { numerator: leaders[0].affected, denominator: leaders[0].eligibleDenominator },
    );
    if (comparison > 0) leaders = [failure];
    else if (comparison === 0) leaders.push(failure);
  }
  return leaders.length === 1 ? leaders[0] : null;
}

function assertDeclaredDecisions(declared, computed) {
  for (const field of [
    "phase0Gate",
    "acquisitionSegment",
    "accessGate",
    "companionGate",
    "phase1Branch",
    "measuredFailureId",
  ]) {
    if (declared[field] !== computed[field]) {
      invalid(
        `aggregate.declaredDecisions.${field}`,
        `declares ${JSON.stringify(declared[field])}, but reviewed inputs recompute to ${JSON.stringify(computed[field])}`,
      );
    }
  }
}

/**
 * Validate and recompute a redaction-safe Phase 0 research aggregate.
 *
 * @param {unknown} input
 * @returns {{schemaVersion: 1, metrics: object, thresholds: object, decisions: object}}
 */
export function evaluatePhase0ResearchAggregate(input, { now = new Date() } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    invalid("validator.now", "must be a valid Date");
  }
  assertNoRawPrivateKeys(input);
  const aggregate = assertObject(input, "aggregate");
  assertAllowedKeys(
    aggregate,
    [
      "$schema",
      "schemaVersion",
      "campaign",
      "facilitators",
      "cohortSubstitutions",
      "sessions",
      "usability",
      "measuredFailures",
      "aggregateReview",
      "declaredDecisions",
    ],
    "aggregate",
  );
  if (aggregate.$schema !== "./phase0-research-aggregate.schema.json") {
    invalid("aggregate.$schema", "must reference ./phase0-research-aggregate.schema.json");
  }
  if (aggregate.schemaVersion !== 1) invalid("aggregate.schemaVersion", "must be 1");

  const campaign = validateCampaign(aggregate.campaign, now);
  const globalIds = new Set();
  const facilitatorsById = validateFacilitators(aggregate.facilitators, campaign, globalIds);
  validateCohortSubstitutions(aggregate.cohortSubstitutions, facilitatorsById, campaign, globalIds);
  validateSessions(aggregate.sessions, facilitatorsById, globalIds);
  const usabilityDecisionRecords = validateUsability(aggregate.usability, globalIds);
  validateMeasuredFailures(aggregate.measuredFailures, globalIds);
  const aggregateReview = validateAggregateReview(aggregate.aggregateReview);
  const declared = validateDeclaredDecisions(aggregate.declaredDecisions);

  const facilitators = aggregate.facilitators;
  const acceptedSessions = aggregate.sessions.filter(
    ({ disposition, eligible }) => disposition === "accepted" && eligible,
  );
  const reviewedAttemptSessions = aggregate.sessions.filter(belongsToReviewedAttemptPopulation);
  const metricsBySegment = Object.fromEntries(
    SEGMENTS.map((segment) => [segment, segmentMetrics(segment, facilitators, aggregate.sessions)]),
  );
  const primaryFacilitators = facilitators.filter(
    ({ disposition, eligible, primary }) => disposition === "accepted" && eligible && primary,
  );
  const recurringProblemDemonstrations = primaryFacilitators.filter(
    ({ recurringProblem }) => recurringProblem,
  ).length;
  const recoveryCompleteCheckpoints = acceptedSessions.reduce(
    (total, session) => total + session.recoveryCompleteCheckpoints,
    0,
  );
  const recoveryEligibleCheckpoints = acceptedSessions.reduce(
    (total, session) => total + session.recoveryEligibleCheckpoints,
    0,
  );
  if (campaign.cohortFrozen && recoveryEligibleCheckpoints === 0) {
    invalid(
      "aggregate.sessions",
      "a closed campaign requires a positive eligible recovery-checkpoint denominator",
    );
  }

  const usabilityBySegment = Object.fromEntries(
    SEGMENTS.map((segment) => {
      const record = usabilityDecisionRecords.get(segment);
      const metricPasses = record?.metrics ? computeUsabilityMetricPasses(record.metrics) : null;
      return [
        segment,
        {
          accepted: Boolean(
            record &&
            record.disposition === "accepted" &&
            record.result === "accepted" &&
            record.eligibleFirstTimeFacilitators >= 6 &&
            record.eligibleParticipants >= 20 &&
            metricPasses &&
            Object.values(metricPasses).every(Boolean),
          ),
          eligibleFirstTimeFacilitators: record?.eligibleFirstTimeFacilitators ?? 0,
          eligibleParticipants: record?.eligibleParticipants ?? 0,
          metricPasses,
        },
      ];
    }),
  );
  const thresholds = {
    frozenCampaign:
      campaign.cohortFrozen && campaign.primaryCohortFrozen && campaign.cutoffUtc !== null,
    sixEligibleFacilitatorsPerSegment: SEGMENTS.every(
      (segment) => metricsBySegment[segment].eligibleFacilitators >= 6,
    ),
    frozenPrimaryTwelve:
      campaign.primaryCohortFrozen &&
      SEGMENTS.every((segment) => metricsBySegment[segment].primaryFacilitators === 6),
    eightRecurringProblemDemonstrations: recurringProblemDemonstrations >= 8,
    threeRepeatPartnersPerSegment: SEGMENTS.every(
      (segment) => metricsBySegment[segment].repeatPartners >= 3,
    ),
    tenObservedSessions: acceptedSessions.length >= 10,
    halfEvidenceCompleteCheckpoints:
      recoveryEligibleCheckpoints > 0 &&
      BigInt(recoveryCompleteCheckpoints) * 2n >= BigInt(recoveryEligibleCheckpoints),
    acceptedSegmentUsability: SEGMENTS.every((segment) => usabilityBySegment[segment].accepted),
  };
  const allThresholdsPass = Object.values(thresholds).every(Boolean);
  const campaignClosed = campaign.cohortFrozen && campaign.cutoffUtc !== null;
  const aggregateReviewFinal =
    aggregateReview.researchOwnerDecision !== "pending" &&
    aggregateReview.independentReviewerDecision !== "pending";
  if (aggregateReviewFinal && SEGMENTS.some((segment) => !usabilityDecisionRecords.has(segment))) {
    invalid(
      "aggregate.usability",
      "a final aggregate requires exactly one eligible accepted decision record per segment",
    );
  }
  if (
    !campaignClosed &&
    (aggregateReview.researchOwnerDecision !== "pending" ||
      aggregateReview.independentReviewerDecision !== "pending")
  ) {
    invalid("aggregate.aggregateReview", "final decisions require a frozen campaign and cutoff");
  }
  if (
    campaignClosed &&
    !allThresholdsPass &&
    aggregateReview.researchOwnerDecision === "accepted" &&
    aggregateReview.independentReviewerDecision === "accepted"
  ) {
    invalid(
      "aggregate.aggregateReview",
      "cannot accept an aggregate with failed Phase 0 thresholds",
    );
  }
  let phase0Gate = "pending";
  if (campaignClosed) {
    if (
      aggregateReview.researchOwnerDecision === "rejected" ||
      aggregateReview.independentReviewerDecision === "rejected"
    ) {
      phase0Gate = "rejected";
    } else if (
      aggregateReview.researchOwnerDecision === "accepted" &&
      aggregateReview.independentReviewerDecision === "accepted"
    ) {
      phase0Gate = allThresholdsPass ? "accepted" : "rejected";
    }
  }

  const excludedWorkflowIds = new Set(
    aggregate.sessions
      .filter(({ timingConnectivityExcluded }) => timingConnectivityExcluded)
      .map(({ workflowId }) => workflowId),
  );
  const timingConnectivityAffectedAttempts = reviewedAttemptSessions.reduce(
    (total, session) => total + session.timingConnectivityAffectedAttempts,
    0,
  );
  const eligibleAttempts = reviewedAttemptSessions.reduce(
    (total, session) => total + session.eligibleAttempts,
    0,
  );
  const seriousAccessibilityFinding = aggregate.sessions.some(
    ({ seriousAccessibilityFinding: serious }) => serious,
  );
  const acceptedSessionsByFacilitator = new Map();
  for (const session of acceptedSessions) {
    const facilitatorSessions = acceptedSessionsByFacilitator.get(session.facilitatorId) ?? [];
    facilitatorSessions.push(session);
    acceptedSessionsByFacilitator.set(session.facilitatorId, facilitatorSessions);
  }
  const repeatExternalDeckFacilitators = [...acceptedSessionsByFacilitator.values()].filter(
    (sessions) => sessions.length >= 2 && sessions.some(({ externalDeckUsed }) => externalDeckUsed),
  ).length;
  const materialContextSwitchSessions = acceptedSessions.filter(
    ({ materialContextSwitch }) => materialContextSwitch,
  ).length;
  const largestFailure = selectLargestFailure(aggregate.measuredFailures);

  let decisions;
  if (phase0Gate !== "accepted") {
    decisions = {
      phase0Gate,
      acquisitionSegment: "pending",
      accessGate: "pending",
      companionGate: "pending",
      phase1Branch: "pending",
      measuredFailureId: null,
    };
  } else {
    const acquisitionSegment = chooseAcquisitionSegment(metricsBySegment);
    if (acquisitionSegment === "pending") {
      decisions = {
        phase0Gate,
        acquisitionSegment,
        accessGate: "pending",
        companionGate: "pending",
        phase1Branch: "pending",
        measuredFailureId: null,
      };
    } else {
      const accessPasses =
        excludedWorkflowIds.size >= 3 ||
        BigInt(timingConnectivityAffectedAttempts) * 10n >= BigInt(eligibleAttempts) ||
        seriousAccessibilityFinding;
      const accessGate = accessPasses ? "pass" : "fail";
      if (accessGate === "pass") {
        decisions = {
          phase0Gate,
          acquisitionSegment,
          accessGate,
          companionGate: "not-evaluated",
          phase1Branch: "access",
          measuredFailureId: null,
        };
      } else {
        const companionPasses =
          repeatExternalDeckFacilitators >= 4 && materialContextSwitchSessions >= 2;
        const companionGate = companionPasses ? "pass" : "fail";
        if (companionGate === "pass") {
          decisions = {
            phase0Gate,
            acquisitionSegment,
            accessGate,
            companionGate,
            phase1Branch: "companion",
            measuredFailureId: null,
          };
        } else {
          decisions = {
            phase0Gate,
            acquisitionSegment,
            accessGate,
            companionGate,
            phase1Branch: largestFailure ? "measured-failure" : "pending",
            measuredFailureId: largestFailure?.failureId ?? null,
          };
        }
      }
    }
  }

  assertDeclaredDecisions(declared, decisions);
  return {
    schemaVersion: 1,
    metrics: {
      segments: metricsBySegment,
      recurringProblemDemonstrations,
      observedSessions: acceptedSessions.length,
      recoveryCompleteCheckpoints,
      recoveryEligibleCheckpoints,
      recoveryCompletionRate: ratio(recoveryCompleteCheckpoints, recoveryEligibleCheckpoints),
      usability: usabilityBySegment,
      aggregateReview,
      access: {
        reviewedAttemptRecords: reviewedAttemptSessions.length,
        timingConnectivityExcludedWorkflows: excludedWorkflowIds.size,
        timingConnectivityAffectedAttempts,
        eligibleAttempts,
        affectedAttemptRate: ratio(timingConnectivityAffectedAttempts, eligibleAttempts),
        seriousAccessibilityFinding,
      },
      companion: {
        repeatExternalDeckFacilitators,
        materialContextSwitchSessions,
      },
      largestMeasuredFailure: largestFailure
        ? {
            failureId: largestFailure.failureId,
            affected: largestFailure.affected,
            eligibleDenominator: largestFailure.eligibleDenominator,
            rate: ratio(largestFailure.affected, largestFailure.eligibleDenominator),
          }
        : null,
    },
    thresholds,
    decisions,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) {
  const cliArguments = process.argv.slice(2);
  const inputArgument = cliArguments[0] === "--" ? cliArguments[1] : cliArguments[0];
  const expectedArgumentCount = cliArguments[0] === "--" ? 2 : 1;
  const inputUrl = inputArgument
    ? resolve(process.cwd(), inputArgument)
    : new URL("../docs/evidence/phase0-research-aggregate.example.json", import.meta.url);
  try {
    if (
      cliArguments.length > expectedArgumentCount ||
      (cliArguments[0] === "--" && !inputArgument)
    ) {
      invalid("command", "usage: pnpm research:check -- [path/to/redacted-aggregate.json]");
    }
    const aggregate = JSON.parse(await readFile(inputUrl, "utf8"));
    const result = evaluatePhase0ResearchAggregate(aggregate);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Phase 0 research aggregate is invalid: ${message}\n`);
    process.exitCode = 1;
  }
}
