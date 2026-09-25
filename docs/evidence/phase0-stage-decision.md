# Phase 0 segment and Phase 1 branch decision

This is a redaction-safe aggregate decision record. Keep facilitator identities, consent records,
raw notes, participant data, and customer content in the approved private research system. Link
only pseudonymous, reviewed evidence records here.

## Decision metadata

- Decision date/time (UTC):
- Research protocol/version:
- Build commits and image digests represented:
- Research owner:
- Independent reviewer:
- Redacted evidence index URL/checksum:
- Frozen in-scope cohort/version and observation cutoff:
- In-scope records by final disposition (accepted/rejected/excluded/pending):
- Frozen primary facilitator cohort (six education/six workplace IDs):
- Same-segment reserve order and substitutions with reasons:
- Phase 0 research gate result (accepted/rejected/pending): Pending
- Phase 0 independent reviewer decision (accepted/rejected/pending): Pending

Do not select an acquisition segment or Phase 1 branch while the Phase 0 research gate or its
independent review is pending.

Every record inside the frozen cohort/cutoff must have a final accepted, rejected, or excluded
disposition under the predeclared rules. Any pending in-scope record keeps every dependent aggregate
and decision pending.

## Acquisition-segment evidence

| Measure                                     | Higher education | Workplace | Evidence references |
| ------------------------------------------- | ---------------- | --------- | ------------------- |
| Eligible facilitator interviews             |                  |           |                     |
| Recurring “what next?” problem demonstrated |                  |           |                     |
| Partners completing at least two pilots     |                  |           |                     |
| Observed real sessions                      |                  |           |                     |
| Evidence-complete recovery checkpoints      |                  |           |                     |
| Eligible recovery checkpoints               |                  |           |                     |
| Median time to unassisted first activation  |                  |           |                     |
| Willingness-to-pay yes/known denominator    |                  |           |                     |

- Total recurring-problem demonstrations/eligible facilitators:
- Total observed real sessions:
- Total evidence-complete/eligible recovery checkpoints and percentage:
- Accepted P0 beta usability evidence reference:

The Phase 0 research gate may be accepted only when all of these reviewed thresholds pass: at
least six eligible higher-education and six eligible workplace facilitators are interviewed; at
least eight of the frozen primary twelve demonstrate the recurring post-result decision problem;
at least three
partners per segment run twice; at least ten real sessions are observed; at least 50% of eligible
recovery checkpoints are evidence-complete; and the P0 beta usability study is accepted. A pending
or rejected independent review keeps the gate pending or rejected.

Selection order: choose the segment with more repeat pilots and evidence-complete recovery loops.
If those reviewed measures are tied, prefer faster activation, then stronger willingness-to-pay
evidence. If the leading measures conflict without a defensible winner, leave the decision pending
and collect more evidence rather than inventing a score.

- Selected primary acquisition segment (higher education/workplace/pending): Pending
- Selection rationale and evidence references:
- Independent reviewer decision (accepted/rejected/pending): Pending

## Phase 1 access signals

- Stable partner workflow IDs with a reviewed timing/connectivity exclusion:
- Partner workflows with timing/connectivity exclusion:
- Observed partner workflows (denominator):
- Timing/connectivity-affected attempts (numerator/denominator and percentage):
- Serious accessibility finding IDs and review status:
- Access gate result (pass/fail/pending): Pending

The Access gate passes if any one of these reviewed conditions is true: at least three partner
workflows exclude participants because of timing/connectivity; at least 10% of observed attempts are
affected; or a serious accessibility finding exists.

Use the campaign counting rules: repeat sessions of one stable partner/workflow ID count as one
workflow, and an observed attempt is one eligible participant/checkpoint response opportunity,
counted once regardless of retries or reconnects. Do not mix joins or unrelated interaction types
into the attempt denominator.

## Phase 1 companion signals

- Stable facilitator IDs for repeat external-deck use:
- Repeat facilitators using an external deck:
- Repeat facilitators reviewed (denominator):
- Observed sessions with a material context-switch interruption:
- Observed sessions reviewed (denominator):
- Companion gate result (pass/fail/pending): Pending

The Companion gate passes only when at least four repeat facilitators use an external deck and at
least two observed sessions suffer a material context-switch interruption.

## Ordered Phase 1 decision

Apply the rules without reordering them:

1. Select **Access and resilience** when the Access gate passes.
2. Evaluate **Companion mode** only after the Access gate explicitly fails, and select it only when
   the Companion gate passes.
3. Use Phase 1 for the largest measured activation or correctness failure only after both gates
   explicitly fail.
4. If either required gate result is pending, keep the selected branch pending.

If both gates explicitly fail, compare only independently reviewed activation or correctness
failures with a defined eligible population. Record exclusions and failed instrumentation; do not
rank raw event counts that lack a denominator or combine unlike populations into one rate.

| Candidate activation/correctness failure | Affected eligible attempts/workflows | Eligible denominator | Rate | Severity and user consequence | Evidence references | Independent reviewer result |
| ---------------------------------------- | ------------------------------------ | -------------------- | ---- | ----------------------------- | ------------------- | --------------------------- |
|                                          |                                      |                      |      |                               |                     | Pending                     |

- Largest measured activation/correctness failure and denominator:
- Selected Phase 1 branch (access/companion/measured failure/pending): Pending
- Decision rationale and evidence references:
- Research owner decision (accepted/rejected/pending): Pending
- Independent reviewer decision (accepted/rejected/pending): Pending
