# Phase 0 evidence campaign

Use this runbook to collect the reviewed evidence required to select OpenRound's primary
acquisition segment and exactly one Phase 1 branch. Product telemetry can corroborate a session,
but it cannot replace consented observation, recheck-validity review, or independent coding.

Do not commit identities, contact details, consent records, participant answers, customer content,
room codes, credentials, private provider URLs, or raw session state. Store them in the approved
private research system. Repository records contain only reviewed aggregates, pseudonymous
references, stable evidence URLs or checksums, and decisions.

## Roles and preconditions

Before recruitment begins:

1. Name the research owner and an independent reviewer who did not facilitate the observed session.
2. Freeze the protocol version, consent language, represented Git commit, and image digests.
3. Select the private research system and verify its access and retention controls.
4. Copy the interview, session-observation, and usability templates into that system. Copy the
   [research prototype evaluation](../evidence/research-prototype-evaluation.md) only when an
   optional Prototype Lab study is part of the protocol.
5. Define facilitator eligibility, exclusion, assistance, failed-instrumentation, and serious
   accessibility-finding rules before viewing outcomes.
6. Assign stable pseudonymous partner, facilitator, and workflow IDs and freeze the in-scope cohort
   and observation cutoff before aggregation begins.

The build may remain allowlisted and feature-flagged. Repository presence or local automation does
not make a pilot eligible.

## Counting rules

- An in-scope record is every interview, observation, or usability task started for the frozen
  cohort before the cutoff, regardless of its eventual eligibility. Apply the predeclared rules to
  give every in-scope record an independently reviewed final disposition of accepted, rejected, or
  excluded with a reason before a gate or branch decision. Use only the predeclared aggregate reason
  codes: `eligibility-failure`, `withdrawal`, `unusable-protocol-record`,
  `failed-instrumentation`, or `protocol-exclusion`. Any pending record keeps the dependent
  aggregate and decision pending; it is not valid input to a closure aggregate.
- Preserve every independently reviewed usability attempt, including rejected and excluded
  attempts. Number attempts separately within each segment using contiguous `attemptOrder` values;
  attempt 1 uses `supersedesStudyId: null`, and every later attempt names the immediately preceding
  study. A final aggregate has exactly one eligible `accepted` decision record per segment, and it
  must be the last attempt in that segment's chain. Earlier rejected/excluded attempts remain in the
  aggregate with null metrics and their predeclared reason instead of being overwritten.
- Before recurring-problem outcomes are coded, freeze a primary evaluation cohort containing the
  first six independently confirmed eligible facilitator IDs by enrollment order in each segment.
  Freeze a same-segment reserve order at the same time. Substitute only for a predeclared
  withdrawal, eligibility failure, or unusable protocol record, always taking the next reserve and
  recording the reason. Never substitute because a facilitator does not demonstrate the problem;
  an unresolved primary record keeps the gate pending.
- A partner workflow is one recurring real facilitation process identified by a stable pseudonymous
  partner/workflow ID and definition version. Repeated sessions of the same workflow count once.
  Assign a new workflow ID only for a material change to the audience, delivery tools, or sequence
  that the independent reviewer accepts; a new session alone never creates another workflow.
- For this campaign, an observed attempt is one eligible participant's opportunity to submit one
  response to an observed live diagnostic or linked recheck. Count each participant/checkpoint
  opportunity once regardless of retries or reconnects. Exclude content-only blocks, staff
  previews, and records excluded by the predeclared protocol; do not combine joins or unrelated
  interaction types into the response-attempt rate.
- Compute the Access affected-attempt rate from accepted eligible session records plus any final,
  independently reviewed record with a timing/connectivity exclusion and a positive eligible-attempt
  denominator. Keep such attempts in both the numerator and denominator even when that exclusion
  makes the enclosing session rejected, excluded, or ineligible; otherwise the failure mechanism
  selects itself out of the rate. Other rejected or excluded records remain outside this population.
- An attempt is timing/connectivity-affected only when the participant cannot receive or submit the
  checkpoint and obtain authoritative acknowledgement before the applicable host close/deadline,
  or can complete it only through an observer-documented timing/connectivity workaround. A wrong
  answer, voluntary nonresponse, or content misunderstanding is not affected.
- A workflow has a timing/connectivity exclusion when at least one participant cannot complete a
  required workflow step, or can participate only through an ad hoc workaround, for a reviewed
  timing/connectivity reason. Count each stable workflow ID at most once.

## Minimum evidence set

The Phase 0 research gate cannot pass until the reviewed evidence includes all of the following:

- at least six eligible higher-education and six eligible workplace facilitators;
- at least eight of the frozen primary twelve demonstrating the recurring post-result “what next?”
  problem;
- at least three partners per segment completing two pilots;
- at least ten observed real sessions;
- at least 50% of eligible recovery checkpoints completing an acknowledged diagnostic, recorded
  intervention, valid linked recheck, and reconciled report; and
- one final eligible accepted P0 beta usability decision record per segment, with any earlier
  rejected/excluded attempts retained in its ordered supersession chain.

Each segment usability result must represent at least six eligible first-time facilitators and at
least twenty eligible participants. Freeze these hard floors in the protocol before recruitment;
larger predeclared samples are allowed, but the floors cannot be relaxed after outcomes are viewed.

Recruit above the minimums so exclusions or failed instrumentation do not pressure reviewers to
relax eligibility rules.

## Interview and observation workflow

For each facilitator interview:

1. Record consent and identity only in the private system.
2. Complete a private copy of the
   [design-partner interview record](../evidence/design-partner-interview.md).
3. Have the independent reviewer code eligibility, recurring-problem evidence, segment, and
   repeat-pilot status. An interview does not count until that review is accepted.

For each real session:

1. Complete a private copy of the
   [session-observation record](../evidence/session-observation.md).
2. Reconcile accepted answers with the ready report and review whether every claimed linked
   recheck is meaningfully different.
3. Record eligible and evidence-complete checkpoint denominators.
4. Record timing/connectivity exclusions, serious accessibility findings, external-deck use, and
   material context-switch interruptions using evidence references rather than raw content.
5. Record repeat-facilitator status and the previous accepted observation reference.
6. Obtain an independent accepted, rejected, excluded, or pending disposition. Preserve every
   recorded denominator and exclusion reason; a pending observation cannot support a gate result,
   and any aggregate that depends on it remains pending.

Run the moderated usability protocol with the
[P0 beta usability record](../evidence/beta-usability.md). Preserve segment-level results; an
overall result cannot conceal a failed segment.

Companion, Question Health, and delayed-probe Prototype Lab tasks are optional research inputs, not
Phase 0 closure prerequisites. When the frozen protocol includes one, use a private copy of the
[research prototype evaluation record](../evidence/research-prototype-evaluation.md). Treat the
lab's redacted export as corroborating instrumentation only. Independently review the paired real
workflow, every in-scope finding disposition, and delayed-probe validity before including any
aggregate in a roadmap decision. Prototype activity never substitutes for a real observed session,
an evidence-complete recovery checkpoint, or an independently reviewed gate result.

## Machine-readable aggregate

After every in-scope record has a final independent disposition, copy the deliberately empty
[aggregate example](../evidence/phase0-research-aggregate.example.json) to the approved private
working location and populate it against the
[aggregate schema](../evidence/phase0-research-aggregate.schema.json). Do not commit the populated
file. Use only stable pseudonymous IDs and `sha256:` checksums or opaque `ref:` handles that resolve
through the approved private evidence index. The validator rejects unknown/raw fields, pending
records, missing reviewed reason codes, duplicate record IDs, unstable workflow bindings, bad
denominators, broken usability supersession chains, multiple accepted usability decision records,
undersized usability samples, a cherry-picked primary cohort, and decisions that disagree with the
inputs.

Run:

```sh
pnpm research:check -- path/to/redacted-aggregate.json
```

The evaluator independently recomputes the six eligible facilitators per segment, the first six
eligible primary facilitators per segment and eight-of-twelve recurring-problem threshold, three
repeat partners per segment, ten real sessions, the evidence-complete checkpoint ratio, and
one final eligible accepted usability decision record with at least six eligible first-time
facilitators and twenty eligible participants in each segment. Rejected/excluded attempts remain
preserved but never replace or contribute metrics to that final decision record. The initial primary
cohort must be the first six eligible-at-freeze
facilitators per segment. Any final-cohort change must name the removed ID, the next same-segment
reserve ID, an allowed reason, its sequence, evidence, and an accepted independent review; the
validator replays the chain instead of inferring a substitution. A repeat partner has at least two
accepted eligible session IDs. A repeat external-deck facilitator has at least two accepted eligible
sessions and an accepted session with external-deck use. These definitions prevent a repeated
record or one-off prototype task from satisfying a field gate.

For acquisition selection, one segment must be no worse on repeat partners and evidence-complete
checkpoints and better on at least one. Conflicting leaders remain pending. If both leading measures
tie, the evaluator compares median unassisted activation, then the yes/known
willingness-to-pay rate; missing or still-tied reviewed evidence remains pending. For the final
fallback, it selects only a unique accepted activation/correctness failure with the greatest
affected/eligible rate. A top-rate tie remains pending rather than inventing another score.

The command's success means the redacted aggregate is internally consistent. It does not establish
that evidence is authentic, reviewers are independent, or a gate is accepted; preserve its output
and input checksum in the decision record for human review. Phase 0 computes accepted only when all
thresholds pass and both the explicit research-owner and independent-reviewer aggregate decisions
are accepted.

## Aggregate and decide

After review, validate the machine-readable aggregate and populate only its redaction-safe totals,
checksum/reference, and evaluator result in the
[Phase 0 decision record](../evidence/phase0-stage-decision.md):

1. Confirm the cohort and cutoff are frozen and every in-scope record has a final disposition.
2. Accept or reject the Phase 0 research gate against every minimum above.
3. If accepted, choose the acquisition segment with more repeat pilots and evidence-complete
   recovery loops; break a tie using faster activation, then willingness to pay.
4. Evaluate Access first. It passes when timing/connectivity excludes participants in at least
   three partner workflows, affects at least 10% of observed attempts, or produces a serious
   accessibility finding.
5. Evaluate Companion only after Access explicitly fails. It passes when at least four repeat
   facilitators use an external deck and at least two observed sessions contain a material
   context-switch interruption.
6. Consider the largest measured activation or correctness failure only after both prior gates
   explicitly fail. Compare reviewed candidates with explicit eligible denominators.
7. Keep the branch pending if any prerequisite decision or independent review is pending.

Failed gates cancel or reframe the candidate capability; they do not merely delay it.

## Close the campaign

1. Record the frozen cohort/cutoff and the accepted, rejected, or excluded disposition of every
   in-scope record; unresolved or pending records keep the campaign open.
2. Add stable redacted evidence URLs or checksums to the aggregate decision record.
3. Obtain research-owner and independent-reviewer decisions.
4. Update the `design-partners` and `beta-usability` entries in
   `docs/release-readiness.json` only when their criteria are fully accepted.
5. Run `pnpm research:check -- path/to/redacted-aggregate.json`, `pnpm readiness:check`, and
   `pnpm test:smoke-support`.
6. Submit the decision and ledger change through normal review before enabling Phase 1 creation in
   any workspace.
