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
4. Update `docs/release-readiness.json` only after the named reviewer accepts the evidence.
5. Run `pnpm readiness:check`; run `pnpm readiness:require:beta:preflight` before tagging a beta
   candidate, then run `pnpm readiness:require:beta` after the signed-release evidence is accepted.

Available templates cover [accessibility](accessibility-review.md),
[security](security-review.md), [physical devices](device-matrix.md),
[provider restoration](provider-restore.md), [alert delivery](operations-rehearsal.md),
[target-region load and soak](target-region-load.md),
[design-partner interviews](design-partner-interview.md), and
[observed beta sessions](session-observation.md), plus the aggregate
[P0 beta usability study](beta-usability.md) and
[Phase 0 segment/Phase 1 branch decision](phase0-stage-decision.md). Use the
[research prototype evaluation](research-prototype-evaluation.md) for the allowlisted Companion,
Question Health, and delayed-probe studies; a completed prototype record is research input and does
not pass a release or roadmap gate by itself.
Use the [Phase 0 evidence campaign runbook](../runbooks/phase0-evidence-campaign.md) to sequence
recruitment, observation, independent review, aggregation, and the ordered branch decision.
