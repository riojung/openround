# P0 beta usability evidence record

Do not record participant names, answer content, room codes, tokens, source material, or raw session
state. Keep consent records and any identifiable research notes in the approved private research
system. This record should contain only aggregate results and pseudonymous study identifiers.

- Study dates (UTC):
- Build commit and image digests:
- Single-VM staging environment:
- Research owner and independent reviewer:
- Study protocol/version:
- Participant counts by segment (higher education/workplace):
- First-time facilitator counts by segment:
- Participant count:
- Exclusions, failed instrumentation, or accessibility accommodations:

## Required P0 thresholds

Record both the numerator/denominator (or complete timing sample) and the aggregate result. A
threshold passes only when the reviewed protocol measures the stated task without coaching unless
the metric explicitly asks whether help was required.

Report each numerator/denominator or timing sample separately for education and workplace. Preserve
excluded or failed-instrumentation attempts as separate rejected/excluded aggregate records with
null metrics; do not merge their partial data into a replacement study. Number every segment's
attempts contiguously with `attemptOrder`, and link each replacement to the immediately preceding
`studyId` with `supersedesStudyId`. The overall result does not replace either segment result when
choosing the primary acquisition segment.

The redacted research aggregate must encode the six ratio rows as exact numerator/denominator
pairs and the publish/acknowledgement rows as complete bounded timing samples. `pnpm research:check`
recomputes every rate, the publish median, and the nearest-rank acknowledgement p95; a typed
`accepted` label cannot override a failed threshold.

Every accepted segment record must cover the full declared eligible population: facilitator tasks
use the `eligibleFirstTimeFacilitators` denominator/sample size and participant response tasks use
the `eligibleParticipants` denominator/sample size. Do not silently drop failed instrumentation or
other observations. Close that study record as rejected or excluded with the predeclared reason and
run a new independently reviewed study when the protocol requires replacement evidence.
The replacement becomes the segment's only eligible accepted decision record and must be the final
entry in that segment's explicit supersession chain; the earlier attempt remains preserved.

| Metric                                                                                 | Required threshold                          | Education result/sample | Workplace result/sample | Overall result | Result  |
| -------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------- | ----------------------- | -------------- | ------- |
| First-time facilitator starts a starter- or source-based session unassisted            | At least 80% within 5 minutes               |                         |                         |                | Pending |
| Four-question blank Round reaches publish                                              | Median below 5 minutes                      |                         |                         |                | Pending |
| Facilitator identifies the valid next live action                                      | At least 90% within 10 seconds              |                         |                         |                | Pending |
| Participant submits a first response without help                                      | At least 95%                                |                         |                         |                | Pending |
| Saved acknowledgement after Submit                                                     | p95 below 1 second                          |                         |                         |                | Pending |
| User finds any retained result from Results                                            | Within 45 seconds for every qualifying task |                         |                         |                | Pending |
| User identifies the report's main unresolved concept                                   | Within 45 seconds for every qualifying task |                         |                         |                | Pending |
| Pilot user completes Recovery Rehearsal and explains the suggested action without help | At least 80%                                |                         |                         |                | Pending |

## Study integrity and decision

- Task order and counterbalancing:
- Timing/instrumentation method and clock source:
- Browser, device, and network mix:
- Assistance rubric:
- Qualitative comprehension themes:
- Failed thresholds and linked issues:
- Deviations from protocol:
- Redacted aggregate dataset/checksum URL:
- Research owner decision: Pending
- Independent reviewer decision: Pending
