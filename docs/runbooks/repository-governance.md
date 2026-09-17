# Repository governance and release controls

Apply these controls to `main` after the workflow changes that define the checks are merged. GitHub
settings are external state; this file is the required configuration and audit checklist, not
evidence that the rules are active.

## Main branch ruleset

- Require a pull request and at least one approving review from someone other than the author.
- Dismiss stale approvals when new commits are pushed and require all conversations to resolve.
- Require branches to be current before merge.
- Require these pull-request checks:
  - `CI / check`
  - `CI / postgres-migration`
  - `CI / browser-smoke`
  - `Security / dependency-review`
  - `Security / dependency-and-secret-review`
  - `Security / sbom`
  - `Security / codeql`
- Block force pushes and branch deletion. Restrict bypass to an audited break-glass maintainer
  group and review every bypass after the incident.
- Enable secret scanning, push protection, private vulnerability reporting, and Dependabot alerts.
- Prefer merge commits or squash merges consistently; never publish a release from an unreviewed
  branch tip.

## Release controls

1. Confirm `pnpm readiness:require:beta` succeeds against reviewed evidence.
2. Confirm the latest `Production-path smoke` and target-region readiness runs match the candidate
   commit.
3. Create a signed, protected semantic-version tag from `main`.
4. Let the release workflow build immutable images, provenance, SBOMs, and scan results. Do not
   retag or use `latest` in production.
5. Verify signatures and digests before promotion; retain the workflow URL and digest in the
   release record.
6. Follow the upgrade canary and rollback runbook. A failed gate requires a new reviewed commit
   and tag rather than rewriting an existing release.

## Audit record

Record the ruleset URL, activation date, maintainer group, required checks, secret-scanning state,
last bypass review, and next quarterly review in the private operations system. Link that record
from the `repository-governance` gate in `docs/release-readiness.json`.
