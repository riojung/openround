# Repository governance and release controls

Apply these controls to `main` after the workflow changes that define the checks are merged. GitHub
settings are external state; this file is the required configuration and audit checklist, not
evidence that the rules are active.

## Current rollout state — 2026-09-19

The repository has a [disabled validation ruleset](https://github.com/riojung/openround/rules/23705684)
with the exact checks and pull-request-only owner break-glass path below. Secret scanning, push
protection, Dependabot alerts/security updates, and private vulnerability reporting are enabled.
The ruleset must remain disabled until a second human collaborator with write access accepts the
review responsibility; otherwise every owner-authored change would require a bypass and the
independent-review policy would be nominal rather than effective.

After the reviewer is present and candidate CI is green, activate the existing ruleset, open a
documentation-only canary PR, obtain that reviewer’s approval, pass every required check, resolve
every conversation, update the branch, and merge normally without bypass. Record the resulting
ruleset insight in the
[repository governance canary record](../evidence/repository-governance-canary.md) before marking
the release gate complete.

## Main branch ruleset

- Require a pull request and at least one approving review from someone other than the author.
- Dismiss stale approvals when new commits are pushed and require all conversations to resolve.
- Require branches to be current before merge.
- Require these pull-request checks:
  - `check`
  - `postgres-migration`
  - `browser-smoke`
  - `dependency-review`
  - `dependency-and-secret-review`
  - `sbom`
  - `codeql`

  GitHub’s UI qualifies these with the workflow name, while the ruleset API requires the bare job
  contexts above and the GitHub Actions integration ID `15368`.

- Block force pushes and branch deletion. On this personal repository, restrict bypass to the
  named owner user in `pull_request` mode; do not grant the entire administrator role. If the
  repository moves to an organization, replace that user with an audited break-glass maintainer
  group. Review every bypass after the incident.
- Enable secret scanning, push protection, private vulnerability reporting, and Dependabot alerts.
- Prefer merge commits or squash merges consistently; never publish a release from an unreviewed
  branch tip.

## Release controls

1. Confirm `pnpm readiness:require:beta:preflight` succeeds against reviewed evidence. This target
   includes every single-VM beta gate except the signed-release artifact that the tag will create.
2. Confirm the latest `CI`, `Security`, and `Production-path smoke` runs match the candidate
   commit. The release preflight looks up successful runs for the exact tagged commit and rejects
   stale ledger links; retain target-region readiness separately with the deployment evidence.
3. Create a signed, protected, `v`-prefixed semantic-version tag from `main`. Do not add `+build`
   metadata because the release policy accepts semantic-version tag identities only; images receive
   the commit-derived `production-<full-commit>` tag and are promoted by immutable digest.
4. Let the release workflow build images, provenance, SBOMs, and scan results. Do not
   retag or use `latest` in production.
5. Verify signatures and digests before promotion; retain the workflow URL and digest in the
   [signed release candidate record](../evidence/signed-release-candidate.md).
6. After its manifest digest, image digests, SBOM, SARIF, provenance, and successful Cosign
   verification are retained, open and independently review an evidence-only PR. Its complete tree
   delta from the tagged commit must be only `docs/release-readiness.json`; within that ledger it
   may update only `updatedAt` and move `signed-release` from pending to complete with stable HTTPS
   evidence and the exact tag object, tagged build commit, manifest SHA-256, and server/web image
   digests in `releaseBinding`. Merge it without bypass, then run `pnpm readiness:require:beta` for
   the final decision.
7. Deploy the exact downloaded manifest from that evidence-only descendant. The deployer verifies
   the descendant and binding, fetches the protected `origin/main` and exact tag, and requires the
   operations `HEAD` to equal that fetched main tip. It also requires GitHub to report a valid
   signature for the exact bound annotated tag object and confirms that object's name and target.
   A local, unsigned, recreated, or substituted tag cannot satisfy this gate. Cosign must also match
   the exact release-workflow certificate identity for the bound tag, not merely another semver
   release tag. The exact-source rule remains in force for every ordinary deployment.
8. Follow the upgrade canary and rollback runbook. A failed gate requires a new reviewed commit
   and tag rather than rewriting an existing release.

## Audit record

Record the ruleset URL, activation date, maintainer group, required checks, secret-scanning state,
last bypass review, and next quarterly review in the private operations system. Link that record
from the [repository governance canary record](../evidence/repository-governance-canary.md) and the
`repository-governance` gate in `docs/release-readiness.json`.
