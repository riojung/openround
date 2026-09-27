# Release evidence records

The files in this directory are blank, redaction-safe templates for gates that cannot be proven by
source code alone. Copy a template into the private operations record for each exercise; do not
commit customer content, participant names, credentials, private provider URLs, or unredacted
screenshots.

For each completed gate:

1. Record the immutable image digest, Git commit, environment, UTC start/end time, owner, and
   reviewer.
2. Attach redacted logs or checksums and a stable evidence URL with access appropriate to the
   reviewers.
3. Record failures and follow-up issues; a partial exercise is not a passing gate.
4. Update `docs/release-readiness.json` only after the named reviewer accepts the evidence. For the
   signed-release gate, use the exact evidence-only transition and `releaseBinding` documented in
   the signed release candidate record; do not combine that acceptance with any other change.
5. Run `pnpm readiness:check`; run `pnpm readiness:require:beta:preflight` before tagging a beta
   candidate, then run `pnpm readiness:require:beta` after the signed-release evidence is accepted.

Available release templates cover [single-VM staging](single-vm-staging.md),
[monitoring, paging, and support rehearsal](operations-rehearsal.md),
[target-region load and soak](target-region-load.md),
[provider restoration](provider-restore.md), [accessibility](accessibility-review.md),
[security](security-review.md), [privacy/legal approval](privacy-legal-approval.md),
[live billing](live-billing-rehearsal.md), [repository governance](repository-governance-canary.md),
[physical devices](device-matrix.md), and the [signed release candidate](signed-release-candidate.md).

Research templates cover [design-partner interviews](design-partner-interview.md),
[observed beta sessions](session-observation.md), the aggregate
[P0 beta usability study](beta-usability.md), and the
[Phase 0 segment/Phase 1 branch decision](phase0-stage-decision.md). Use the
[research prototype evaluation](research-prototype-evaluation.md) for the allowlisted Companion,
Question Health, and delayed-probe studies; a completed prototype record is research input and does
not pass a release or roadmap gate by itself.
Use the [Phase 0 evidence campaign runbook](../runbooks/phase0-evidence-campaign.md) to sequence
recruitment, observation, independent review, aggregation, and the ordered branch decision.
