# Independently reviewed gate acceptance

Every completed Phase 0 gate other than the two automated engineering baselines and the separately
bound signed-release gate must include a redaction-safe `acceptance` object in
`docs/release-readiness.json`. The object is an index and integrity binding, not the private record
itself. Keep identities, credentials, private URLs, customer content, participant data, raw
responses, and consent records in the approved evidence system.

The readiness checker requires this shape when one of the independently reviewed gates moves to
`complete`:

```json
{
  "recordVersion": 1,
  "candidateBuildId": "<full-40-character-git-commit>",
  "environment": "<bounded-reviewed-environment-name>",
  "startedAt": "<ISO-8601-UTC>",
  "completedAt": "<ISO-8601-UTC>",
  "acceptedAt": "<ISO-8601-UTC-not-before-completion>",
  "owner": {
    "role": "<must-equal-the-ledger-gate-owner>",
    "decision": "accepted"
  },
  "independentReviewer": {
    "role": "<bounded-role-without-personal-identity>",
    "independent": true,
    "decision": "accepted"
  },
  "manifest": {
    "url": "<stable-https-url-to-the-redacted-evidence-manifest>",
    "sha256": "sha256:<64-lowercase-hex-characters>"
  }
}
```

The independent reviewer role must differ from the gate-owner role. The gate's `evidence` array
must include both the manifest URL and checksum and may otherwise contain only unique stable HTTPS
references without embedded credentials, query strings, or fragments, or explicit `sha256:`
checksums. Reserved/example hosts, loopback addresses, free-form notes, and placeholder values fail
validation. Remove `nextAction` when a gate is completed; acceptance metadata on an incomplete gate
also fails validation.

All completed independently reviewed gates must name the same exercised candidate commit. The
release tag cannot point at that exact commit because recording acceptance changes the ledger and
therefore creates a new commit. Instead, release preflight requires the tagged commit to be a
descendant whose complete source delta from the exercised candidate is only
`docs/release-readiness.json`. Its `releaseBinding.buildId` names that later tagged commit. A later
application/configuration candidate requires re-acceptance of every affected gate; never combine
accepted records from different exercised builds into one release decision.

The referenced manifest must bind the exact candidate and list redacted artifact hashes, exercise
times, failures and reruns, final owner/reviewer decisions, and any gate-specific denominators. A
checksum without reviewer acceptance does not pass a gate, and a later build or configuration
requires a new exercise wherever the change can affect the accepted result.
