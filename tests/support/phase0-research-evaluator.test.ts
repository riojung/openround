import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluatePhase0ResearchAggregate } from "../../scripts/check-phase0-research.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const segments = ["higher-education", "workplace"] as const;

function evidence(id: string) {
  return [`ref:test/${id}`];
}

function validAggregate() {
  const facilitators = segments.flatMap((segment) => {
    const short = segment === "higher-education" ? "he" : "wp";
    return Array.from({ length: 6 }, (_, index) => ({
      facilitatorId: `fac-${short}-${index + 1}`,
      partnerId: `partner-${short}-${Math.floor(index / 2) + 1}`,
      segment,
      enrollmentOrder: index + 1,
      eligibleAtFreeze: true,
      initialPrimary: true,
      primary: true,
      disposition: "accepted",
      eligible: true,
      recurringProblem: index < 4,
      activationSeconds: (segment === "higher-education" ? 100 : 120) + index,
      willingnessToPay: index < (segment === "higher-education" ? 5 : 3) ? "yes" : "no",
      reasonCode: null,
      independentReview: "accepted",
      evidenceReferences: evidence(`fac-${short}-${index + 1}`),
    }));
  });
  const sessions = facilitators.map((facilitator, index) => {
    const short = facilitator.segment === "higher-education" ? "he" : "wp";
    const segmentIndex = index % 6;
    return {
      sessionId: `session-${short}-${segmentIndex + 1}`,
      facilitatorId: facilitator.facilitatorId,
      partnerId: facilitator.partnerId,
      workflowId: `workflow-${short}-${Math.floor(segmentIndex / 2) + 1}`,
      segment: facilitator.segment,
      disposition: "accepted",
      eligible: true,
      recoveryEligibleCheckpoints: 2,
      recoveryCompleteCheckpoints: 1,
      eligibleAttempts: 10,
      timingConnectivityAffectedAttempts: 0,
      timingConnectivityExcluded: false,
      seriousAccessibilityFinding: false,
      externalDeckUsed: false,
      materialContextSwitch: false,
      reasonCode: null,
      independentReview: "accepted",
      evidenceReferences: evidence(`session-${short}-${segmentIndex + 1}`),
    };
  });

  return {
    $schema: "./phase0-research-aggregate.schema.json",
    schemaVersion: 1,
    campaign: {
      protocolVersion: "protocol-v1",
      cohortVersion: "cohort-v1",
      cohortFrozen: true,
      primaryCohortFrozen: true,
      cutoffUtc: "2026-09-27T12:00:00Z",
      evidenceReferences: evidence("campaign-v1"),
    },
    facilitators,
    cohortSubstitutions: [],
    sessions,
    usability: segments.map((segment) => {
      const short = segment === "higher-education" ? "he" : "wp";
      return {
        studyId: `study-${short}-1`,
        segment,
        attemptOrder: 1,
        supersedesStudyId: null,
        disposition: "accepted",
        result: "accepted",
        eligibleFirstTimeFacilitators: 6,
        eligibleParticipants: 20,
        metrics: {
          starterSessionWithin5Minutes: { numerator: 5, denominator: 6 },
          blankRoundPublishSeconds: { samples: [210, 220, 230, 240, 250, 260] },
          validNextActionWithin10Seconds: { numerator: 6, denominator: 6 },
          firstSubmitWithoutHelp: { numerator: 19, denominator: 20 },
          savedAcknowledgementMilliseconds: {
            samples: [
              300, 320, 340, 360, 380, 400, 420, 440, 460, 480, 500, 520, 540, 560, 580, 600, 620,
              640, 660, 680,
            ],
          },
          retainedResultWithin45Seconds: { numerator: 6, denominator: 6 },
          mainUnresolvedConceptWithin45Seconds: { numerator: 6, denominator: 6 },
          recoveryRehearsalWithoutHelp: { numerator: 5, denominator: 6 },
        },
        reasonCode: null,
        independentReview: "accepted",
        evidenceReferences: evidence(`study-${short}-1`),
      };
    }),
    measuredFailures: [
      {
        failureId: "failure-activation-1",
        kind: "activation",
        disposition: "accepted",
        affected: 2,
        eligibleDenominator: 20,
        severity: "moderate",
        reasonCode: null,
        independentReview: "accepted",
        evidenceReferences: evidence("failure-activation-1"),
      },
    ],
    aggregateReview: {
      researchOwnerDecision: "accepted",
      independentReviewerDecision: "accepted",
      evidenceReferences: evidence("aggregate-review-v1"),
    },
    declaredDecisions: {
      phase0Gate: "accepted",
      acquisitionSegment: "higher-education",
      accessGate: "fail",
      companionGate: "fail",
      phase1Branch: "measured-failure",
      measuredFailureId: "failure-activation-1",
    },
  };
}

function addRepeatExternalDeckSessions(aggregate: ReturnType<typeof validAggregate>) {
  for (const [index, facilitator] of aggregate.facilitators.slice(0, 4).entries()) {
    const first = aggregate.sessions.find(
      ({ facilitatorId }) => facilitatorId === facilitator.facilitatorId,
    )!;
    aggregate.sessions.push({
      ...first,
      sessionId: `session-deck-${index + 1}`,
      recoveryCompleteCheckpoints: 1,
      externalDeckUsed: true,
      materialContextSwitch: index < 2,
      evidenceReferences: evidence(`session-deck-${index + 1}`),
    });
  }
}

function applyHigherEducationSubstitution(aggregate: ReturnType<typeof validAggregate>) {
  const removed = aggregate.facilitators.find(({ facilitatorId }) => facilitatorId === "fac-he-1")!;
  removed.primary = false;
  removed.disposition = "excluded";
  removed.reasonCode = "withdrawal";
  const removedSession = aggregate.sessions.find(({ sessionId }) => sessionId === "session-he-1")!;
  removedSession.disposition = "excluded";
  removedSession.reasonCode = "withdrawal";

  aggregate.facilitators.push({
    facilitatorId: "fac-he-7",
    partnerId: "partner-he-1",
    segment: "higher-education",
    enrollmentOrder: 7,
    eligibleAtFreeze: true,
    initialPrimary: false,
    primary: true,
    disposition: "accepted",
    eligible: true,
    recurringProblem: true,
    activationSeconds: 106,
    willingnessToPay: "yes",
    reasonCode: null,
    independentReview: "accepted",
    evidenceReferences: evidence("fac-he-7"),
  });
  aggregate.sessions.push({
    sessionId: "session-he-7",
    facilitatorId: "fac-he-7",
    partnerId: "partner-he-1",
    workflowId: "workflow-he-1",
    segment: "higher-education",
    disposition: "accepted",
    eligible: true,
    recoveryEligibleCheckpoints: 2,
    recoveryCompleteCheckpoints: 1,
    eligibleAttempts: 10,
    timingConnectivityAffectedAttempts: 0,
    timingConnectivityExcluded: false,
    seriousAccessibilityFinding: false,
    externalDeckUsed: false,
    materialContextSwitch: false,
    reasonCode: null,
    independentReview: "accepted",
    evidenceReferences: evidence("session-he-7"),
  });
  aggregate.cohortSubstitutions.push({
    substitutionId: "substitution-he-1",
    segment: "higher-education",
    sequence: 1,
    removedFacilitatorId: "fac-he-1",
    reserveFacilitatorId: "fac-he-7",
    reasonCode: "withdrawal",
    independentReview: "accepted",
    evidenceReferences: evidence("substitution-he-1"),
  });
}

describe("Phase 0 research aggregate evaluator", () => {
  it("recomputes every Phase 0 threshold and the measured-failure fallback", () => {
    const result = evaluatePhase0ResearchAggregate(validAggregate());

    expect(Object.values(result.thresholds).every(Boolean)).toBe(true);
    expect(result.metrics.recurringProblemDemonstrations).toBe(8);
    expect(result.metrics.observedSessions).toBe(12);
    expect(result.metrics.recoveryCompletionRate).toBe(0.5);
    expect(result.metrics.segments["higher-education"].repeatPartners).toBe(3);
    expect(result.metrics.segments.workplace.repeatPartners).toBe(3);
    expect(result.decisions).toEqual({
      phase0Gate: "accepted",
      acquisitionSegment: "higher-education",
      accessGate: "fail",
      companionGate: "fail",
      phase1Branch: "measured-failure",
      measuredFailureId: "failure-activation-1",
    });
  });

  it("rejects a campaign cutoff that has not happened yet", () => {
    const aggregate = validAggregate();
    aggregate.campaign.cutoffUtc = "2099-09-27T12:00:00Z";

    expect(() =>
      evaluatePhase0ResearchAggregate(aggregate, {
        now: new Date("2026-09-27T15:00:00Z"),
      }),
    ).toThrow(/cutoffUtc: cannot be in the future/);
  });

  it("selects Access first and does not evaluate Companion", () => {
    const aggregate = validAggregate();
    for (const sessionId of ["session-he-1", "session-he-3", "session-he-5"]) {
      const session = aggregate.sessions.find((candidate) => candidate.sessionId === sessionId)!;
      session.timingConnectivityExcluded = true;
      session.timingConnectivityAffectedAttempts = 1;
    }
    addRepeatExternalDeckSessions(aggregate);
    aggregate.declaredDecisions = {
      ...aggregate.declaredDecisions,
      accessGate: "pass",
      companionGate: "not-evaluated",
      phase1Branch: "access",
      measuredFailureId: null,
    };

    const result = evaluatePhase0ResearchAggregate(aggregate);
    expect(result.metrics.access.timingConnectivityExcludedWorkflows).toBe(3);
    expect(result.metrics.companion.repeatExternalDeckFacilitators).toBe(4);
    expect(result.decisions.phase1Branch).toBe("access");
    expect(result.decisions.companionGate).toBe("not-evaluated");
  });

  it("counts independently reviewed connectivity exclusions in both Access populations", () => {
    const aggregate = validAggregate();
    for (const [index, sessionId] of ["session-he-1", "session-he-3", "session-he-5"].entries()) {
      const session = aggregate.sessions.find((candidate) => candidate.sessionId === sessionId)!;
      aggregate.sessions.push({
        ...session,
        sessionId: `session-he-connectivity-replacement-${index + 1}`,
        evidenceReferences: evidence(`session-he-connectivity-replacement-${index + 1}`),
      });
      session.disposition = "excluded";
      session.eligible = false;
      session.reasonCode = "failed-instrumentation";
      session.timingConnectivityExcluded = true;
      session.timingConnectivityAffectedAttempts = 1;
    }
    aggregate.declaredDecisions = {
      phase0Gate: "accepted",
      acquisitionSegment: "higher-education",
      accessGate: "pass",
      companionGate: "not-evaluated",
      phase1Branch: "access",
      measuredFailureId: null,
    };

    const result = evaluatePhase0ResearchAggregate(aggregate);
    expect(result.metrics.access.timingConnectivityExcludedWorkflows).toBe(3);
    expect(result.metrics.access.reviewedAttemptRecords).toBe(15);
    expect(result.metrics.access.timingConnectivityAffectedAttempts).toBe(3);
    expect(result.metrics.access.eligibleAttempts).toBe(150);
    expect(result.metrics.access.affectedAttemptRate).toBe(0.02);
    expect(result.decisions.phase1Branch).toBe("access");
  });

  it("rejects zero-impact connectivity exclusion flags", () => {
    const aggregate = validAggregate();
    aggregate.sessions[0].timingConnectivityExcluded = true;
    expect(() => evaluatePhase0ResearchAggregate(aggregate)).toThrow(
      /timingConnectivityExcluded requires at least one affected eligible attempt/,
    );
  });

  it("selects Companion only after Access fails", () => {
    const aggregate = validAggregate();
    addRepeatExternalDeckSessions(aggregate);
    aggregate.declaredDecisions = {
      ...aggregate.declaredDecisions,
      companionGate: "pass",
      phase1Branch: "companion",
      measuredFailureId: null,
    };

    const result = evaluatePhase0ResearchAggregate(aggregate);
    expect(result.decisions.accessGate).toBe("fail");
    expect(result.decisions.companionGate).toBe("pass");
    expect(result.decisions.phase1Branch).toBe("companion");
  });

  it("passes Access at the exact ten-percent affected-attempt boundary", () => {
    const aggregate = validAggregate();
    for (const session of aggregate.sessions) session.timingConnectivityAffectedAttempts = 1;
    aggregate.declaredDecisions = {
      ...aggregate.declaredDecisions,
      accessGate: "pass",
      companionGate: "not-evaluated",
      phase1Branch: "access",
      measuredFailureId: null,
    };

    const result = evaluatePhase0ResearchAggregate(aggregate);
    expect(result.metrics.access.affectedAttemptRate).toBe(0.1);
    expect(result.decisions.phase1Branch).toBe("access");
  });

  it("uses timing/connectivity-excluded records, but not unrelated exclusions, at the boundary", () => {
    const aggregate = validAggregate();
    for (const session of aggregate.sessions.slice(0, 11)) {
      session.timingConnectivityAffectedAttempts = 1;
    }
    const excludedSource = aggregate.sessions[11];
    aggregate.sessions.push(
      {
        ...excludedSource,
        sessionId: "session-reviewed-connectivity-exclusion",
        disposition: "excluded",
        eligible: false,
        eligibleAttempts: 10,
        timingConnectivityAffectedAttempts: 2,
        timingConnectivityExcluded: true,
        reasonCode: "failed-instrumentation",
        evidenceReferences: evidence("session-reviewed-connectivity-exclusion"),
      },
      {
        ...excludedSource,
        sessionId: "session-unrelated-protocol-exclusion",
        disposition: "excluded",
        eligible: false,
        eligibleAttempts: 1_000,
        timingConnectivityAffectedAttempts: 0,
        timingConnectivityExcluded: false,
        reasonCode: "protocol-exclusion",
        evidenceReferences: evidence("session-unrelated-protocol-exclusion"),
      },
    );
    aggregate.declaredDecisions = {
      ...aggregate.declaredDecisions,
      accessGate: "pass",
      companionGate: "not-evaluated",
      phase1Branch: "access",
      measuredFailureId: null,
    };

    const result = evaluatePhase0ResearchAggregate(aggregate);

    expect(result.metrics.access.reviewedAttemptRecords).toBe(13);
    expect(result.metrics.access.timingConnectivityAffectedAttempts).toBe(13);
    expect(result.metrics.access.eligibleAttempts).toBe(130);
    expect(result.metrics.access.affectedAttemptRate).toBe(0.1);
    expect(result.metrics.access.timingConnectivityExcludedWorkflows).toBe(1);
    expect(result.decisions.phase1Branch).toBe("access");
  });

  it("requires both aggregate reviewers to accept before Phase 0 can pass", () => {
    const aggregate = validAggregate();
    aggregate.aggregateReview.independentReviewerDecision = "pending";
    aggregate.declaredDecisions = {
      phase0Gate: "pending",
      acquisitionSegment: "pending",
      accessGate: "pending",
      companionGate: "pending",
      phase1Branch: "pending",
      measuredFailureId: null,
    };

    expect(evaluatePhase0ResearchAggregate(aggregate).decisions.phase0Gate).toBe("pending");
  });

  it("validates an allowed, independently reviewed next-reserve substitution", () => {
    const aggregate = validAggregate();
    applyHigherEducationSubstitution(aggregate);

    const result = evaluatePhase0ResearchAggregate(aggregate);
    expect(result.thresholds.frozenPrimaryTwelve).toBe(true);
    expect(result.metrics.recurringProblemDemonstrations).toBe(8);
    expect(result.decisions.phase0Gate).toBe("accepted");
  });

  it("rejects a substitution that skips the next eligible reserve", () => {
    const aggregate = validAggregate();
    applyHigherEducationSubstitution(aggregate);
    const firstReserve = aggregate.facilitators.find(
      ({ facilitatorId }) => facilitatorId === "fac-he-7",
    )!;
    firstReserve.primary = false;
    aggregate.facilitators.push({
      ...firstReserve,
      facilitatorId: "fac-he-8",
      enrollmentOrder: 8,
      primary: true,
      evidenceReferences: evidence("fac-he-8"),
    });
    const reserveSession = aggregate.sessions.find(
      ({ sessionId }) => sessionId === "session-he-7",
    )!;
    reserveSession.facilitatorId = "fac-he-8";
    reserveSession.sessionId = "session-he-8";
    reserveSession.evidenceReferences = evidence("session-he-8");
    aggregate.cohortSubstitutions[0].reserveFacilitatorId = "fac-he-8";

    expect(() => evaluatePhase0ResearchAggregate(aggregate)).toThrow(
      /next eligible reserve by enrollmentOrder/,
    );
  });

  it("does not silently skip an earlier frozen reserve with a final exclusion", () => {
    const aggregate = validAggregate();
    applyHigherEducationSubstitution(aggregate);
    const firstReserve = aggregate.facilitators.find(
      ({ facilitatorId }) => facilitatorId === "fac-he-7",
    )!;
    firstReserve.primary = false;
    firstReserve.disposition = "excluded";
    firstReserve.eligible = false;
    firstReserve.reasonCode = "protocol-exclusion";
    aggregate.facilitators.push({
      ...firstReserve,
      facilitatorId: "fac-he-8",
      enrollmentOrder: 8,
      primary: true,
      disposition: "accepted",
      eligible: true,
      reasonCode: null,
      evidenceReferences: evidence("fac-he-8"),
    });
    const reserveSession = aggregate.sessions.find(
      ({ sessionId }) => sessionId === "session-he-7",
    )!;
    reserveSession.facilitatorId = "fac-he-8";
    reserveSession.sessionId = "session-he-8";
    reserveSession.evidenceReferences = evidence("session-he-8");
    aggregate.cohortSubstitutions[0].reserveFacilitatorId = "fac-he-8";

    expect(() => evaluatePhase0ResearchAggregate(aggregate)).toThrow(
      /next eligible reserve by enrollmentOrder/,
    );
  });

  it("uses leading measures before activation, then willingness to pay", () => {
    const leadingMeasureAggregate = validAggregate();
    leadingMeasureAggregate.sessions[0].recoveryCompleteCheckpoints = 2;
    for (const facilitator of leadingMeasureAggregate.facilitators) {
      facilitator.activationSeconds = facilitator.segment === "higher-education" ? 200 : 50;
    }
    expect(
      evaluatePhase0ResearchAggregate(leadingMeasureAggregate).decisions.acquisitionSegment,
    ).toBe("higher-education");

    const willingnessAggregate = validAggregate();
    for (const facilitator of willingnessAggregate.facilitators) {
      facilitator.activationSeconds = 100;
    }
    expect(evaluatePhase0ResearchAggregate(willingnessAggregate).decisions.acquisitionSegment).toBe(
      "higher-education",
    );
  });

  it("keeps a tied acquisition decision pending when tie-break coverage is incomplete", () => {
    const missingActivation = validAggregate();
    missingActivation.facilitators[0].activationSeconds = null;
    missingActivation.declaredDecisions = {
      ...missingActivation.declaredDecisions,
      acquisitionSegment: "pending",
      accessGate: "pending",
      companionGate: "pending",
      phase1Branch: "pending",
      measuredFailureId: null,
    };
    expect(evaluatePhase0ResearchAggregate(missingActivation).decisions.acquisitionSegment).toBe(
      "pending",
    );

    const missingWillingness = validAggregate();
    for (const facilitator of missingWillingness.facilitators) facilitator.activationSeconds = 100;
    missingWillingness.facilitators[0].willingnessToPay = "unknown";
    missingWillingness.declaredDecisions = {
      ...missingWillingness.declaredDecisions,
      acquisitionSegment: "pending",
      accessGate: "pending",
      companionGate: "pending",
      phase1Branch: "pending",
      measuredFailureId: null,
    };
    expect(evaluatePhase0ResearchAggregate(missingWillingness).decisions.acquisitionSegment).toBe(
      "pending",
    );
  });

  it("keeps acquisition pending when the two leading measures conflict", () => {
    const aggregate = validAggregate();
    aggregate.facilitators.push({
      facilitatorId: "fac-he-7",
      partnerId: "partner-he-4",
      segment: "higher-education",
      enrollmentOrder: 7,
      eligibleAtFreeze: true,
      initialPrimary: false,
      primary: false,
      disposition: "accepted",
      eligible: true,
      recurringProblem: false,
      activationSeconds: 90,
      willingnessToPay: "yes",
      reasonCode: null,
      independentReview: "accepted",
      evidenceReferences: evidence("fac-he-7"),
    });
    for (const index of [1, 2]) {
      aggregate.sessions.push({
        sessionId: `session-he-extra-${index}`,
        facilitatorId: "fac-he-7",
        partnerId: "partner-he-4",
        workflowId: "workflow-he-4",
        segment: "higher-education",
        disposition: "accepted",
        eligible: true,
        recoveryEligibleCheckpoints: 2,
        recoveryCompleteCheckpoints: 1,
        eligibleAttempts: 10,
        timingConnectivityAffectedAttempts: 0,
        timingConnectivityExcluded: false,
        seriousAccessibilityFinding: false,
        externalDeckUsed: false,
        materialContextSwitch: false,
        reasonCode: null,
        independentReview: "accepted",
        evidenceReferences: evidence(`session-he-extra-${index}`),
      });
    }
    for (const session of aggregate.sessions
      .filter(({ segment }) => segment === "workplace")
      .slice(0, 4)) {
      session.recoveryCompleteCheckpoints = 2;
    }
    aggregate.declaredDecisions.acquisitionSegment = "pending";
    aggregate.declaredDecisions.accessGate = "pending";
    aggregate.declaredDecisions.companionGate = "pending";
    aggregate.declaredDecisions.phase1Branch = "pending";
    aggregate.declaredDecisions.measuredFailureId = null;

    const result = evaluatePhase0ResearchAggregate(aggregate);
    expect(result.metrics.segments["higher-education"].repeatPartners).toBe(4);
    expect(result.metrics.segments.workplace.recoveryCompleteCheckpoints).toBeGreaterThan(
      result.metrics.segments["higher-education"].recoveryCompleteCheckpoints,
    );
    expect(result.decisions.acquisitionSegment).toBe("pending");
  });

  it("rejects pending in-scope records and duplicate stable IDs", () => {
    const pending = validAggregate();
    pending.facilitators[0].disposition = "pending";
    expect(() => evaluatePhase0ResearchAggregate(pending)).toThrow(/pending in-scope records/);

    const duplicate = validAggregate();
    duplicate.facilitators[1].facilitatorId = duplicate.facilitators[0].facilitatorId;
    expect(() => evaluatePhase0ResearchAggregate(duplicate)).toThrow(/duplicate stable ID/);
  });

  it("rejects invalid denominators and raw/private fields", () => {
    const invalidDenominator = validAggregate();
    invalidDenominator.sessions[0].timingConnectivityAffectedAttempts = 11;
    expect(() => evaluatePhase0ResearchAggregate(invalidDenominator)).toThrow(
      /cannot exceed eligibleAttempts/,
    );

    const rawField = validAggregate() as ReturnType<typeof validAggregate> & {
      participantName?: string;
    };
    rawField.participantName = "must-not-be-committed";
    expect(() => evaluatePhase0ResearchAggregate(rawField)).toThrow(/raw\/private field names/);
  });

  it("enforces separate segment usability floors", () => {
    const aggregate = validAggregate();
    aggregate.usability[0].eligibleParticipants = 19;
    expect(() => evaluatePhase0ResearchAggregate(aggregate)).toThrow(
      /at least 6 eligible first-time facilitators and 20 eligible participants/,
    );
  });

  it("recomputes all usability journey thresholds instead of trusting accepted", () => {
    const failedRate = validAggregate();
    failedRate.usability[0].metrics.firstSubmitWithoutHelp.numerator = 18;
    expect(() => evaluatePhase0ResearchAggregate(failedRate)).toThrow(
      /eight journey metrics recompute to "rejected"/,
    );

    const failedP95 = validAggregate();
    failedP95.usability[0].metrics.savedAcknowledgementMilliseconds.samples[18] = 1_000;
    failedP95.usability[0].metrics.savedAcknowledgementMilliseconds.samples[19] = 1_000;
    expect(() => evaluatePhase0ResearchAggregate(failedP95)).toThrow(
      /eight journey metrics recompute to "rejected"/,
    );
  });

  it("requires every usability metric to cover its full eligible population", () => {
    const cherryPickedRate = validAggregate();
    cherryPickedRate.usability[0].metrics.firstSubmitWithoutHelp = {
      numerator: 1,
      denominator: 1,
    };
    expect(() => evaluatePhase0ResearchAggregate(cherryPickedRate)).toThrow(
      /must cover all 20 eligible participants/,
    );

    const cherryPickedTiming = validAggregate();
    cherryPickedTiming.usability[0].metrics.blankRoundPublishSeconds.samples = [0];
    expect(() => evaluatePhase0ResearchAggregate(cherryPickedTiming)).toThrow(
      /must cover all 6 eligible facilitators/,
    );
  });

  it("preserves a rejected attempt before the accepted replacement used for the segment decision", () => {
    const aggregate = validAggregate();
    const replacement = aggregate.usability[0];
    replacement.attemptOrder = 2;
    replacement.supersedesStudyId = "study-he-rejected";
    aggregate.usability.unshift({
      studyId: "study-he-rejected",
      segment: "higher-education",
      attemptOrder: 1,
      supersedesStudyId: null,
      disposition: "rejected",
      result: "not-evaluated",
      eligibleFirstTimeFacilitators: 0,
      eligibleParticipants: 0,
      metrics: null,
      reasonCode: "failed-instrumentation",
      independentReview: "accepted",
      evidenceReferences: evidence("study-he-rejected"),
    });

    const result = evaluatePhase0ResearchAggregate(aggregate);

    expect(result.thresholds.acceptedSegmentUsability).toBe(true);
    expect(result.metrics.usability["higher-education"]).toMatchObject({
      accepted: true,
      eligibleFirstTimeFacilitators: 6,
      eligibleParticipants: 20,
    });
  });

  it("requires a complete supersession chain and one final accepted study per segment", () => {
    const brokenChain = validAggregate();
    brokenChain.usability[0].attemptOrder = 2;
    expect(() => evaluatePhase0ResearchAggregate(brokenChain)).toThrow(
      /attemptOrder.*contiguous per-segment sequence/,
    );

    const duplicateDecision = validAggregate();
    duplicateDecision.usability.push({
      ...structuredClone(duplicateDecision.usability[0]),
      studyId: "study-he-2",
      attemptOrder: 2,
      supersedesStudyId: "study-he-1",
      evidenceReferences: evidence("study-he-2"),
    });
    expect(() => evaluatePhase0ResearchAggregate(duplicateDecision)).toThrow(
      /at most one eligible accepted decision record/,
    );
  });

  it("rejects decisions that contradict recomputed thresholds or branch order", () => {
    const failedThreshold = validAggregate();
    failedThreshold.facilitators[3].recurringProblem = false;
    failedThreshold.aggregateReview.researchOwnerDecision = "rejected";
    failedThreshold.aggregateReview.independentReviewerDecision = "rejected";
    expect(() => evaluatePhase0ResearchAggregate(failedThreshold)).toThrow(
      /phase0Gate.*recompute to "rejected"/,
    );

    const reordered = validAggregate();
    reordered.sessions[0].seriousAccessibilityFinding = true;
    reordered.declaredDecisions.phase1Branch = "companion";
    reordered.declaredDecisions.companionGate = "pass";
    reordered.declaredDecisions.measuredFailureId = null;
    expect(() => evaluatePhase0ResearchAggregate(reordered)).toThrow(
      /accessGate.*recompute to "pass"/,
    );
  });

  it("accepts the committed empty example only as a pending, non-evidence record", async () => {
    const source = await readFile(
      resolve(repositoryRoot, "docs/evidence/phase0-research-aggregate.example.json"),
      "utf8",
    );
    const result = evaluatePhase0ResearchAggregate(JSON.parse(source));

    expect(result.decisions.phase0Gate).toBe("pending");
    expect(result.decisions.phase1Branch).toBe("pending");
    expect(result.metrics.observedSessions).toBe(0);
  });
});
