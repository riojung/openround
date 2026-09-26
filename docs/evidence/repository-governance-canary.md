# Repository governance canary evidence record

Do not record access tokens, private collaborator details, private audit payloads, or screenshots that
expose unrelated repository activity. Use stable GitHub URLs and redacted ruleset/audit exports.
This record proves enforced behavior only after the ruleset is active; a disabled ruleset or owner
bypass is not passing evidence.

## Configuration snapshot

- Exercise date/time (UTC):
- Repository and default branch:
- Active ruleset URL/ID and configuration export checksum:
- Ruleset activation time (UTC):
- Named maintainer group reference:
- Independent human reviewer reference:
- Canary pull request URL:
- Canary author:
- Governance owner:

| Required control                                                                     | Configuration/audit evidence | Result  |
| ------------------------------------------------------------------------------------ | ---------------------------- | ------- |
| Pull request required for `main`                                                     |                              | Pending |
| At least one approval from someone other than the author                             |                              | Pending |
| Stale approvals dismissed on new commits                                             |                              | Pending |
| Every review conversation must be resolved                                           |                              | Pending |
| Branch must be current before merge                                                  |                              | Pending |
| Required CI and security contexts match the documented list                          |                              | Pending |
| Force pushes and branch deletion are blocked                                         |                              | Pending |
| Owner break-glass is restricted to pull-request mode                                 |                              | Pending |
| Secret scanning, push protection, alerts, updates, and private reporting are enabled |                              | Pending |

## Required check snapshot

Record the successful check URL for the exact canary merge commit candidate. A similarly named job,
a check from an older commit, or a manually overridden result does not satisfy the row.

| Context                        | Check URL and head SHA | Result  |
| ------------------------------ | ---------------------- | ------- |
| `check`                        |                        | Pending |
| `postgres-migration`           |                        | Pending |
| `browser-smoke`                |                        | Pending |
| `dependency-review`            |                        | Pending |
| `dependency-and-secret-review` |                        | Pending |
| `sbom`                         |                        | Pending |
| `codeql`                       |                        | Pending |

## Canary sequence

| Observation                                                            | Evidence reference | Result                  |
| ---------------------------------------------------------------------- | ------------------ | ----------------------- |
| Documentation-only canary opened after ruleset activation              |                    | Pending                 |
| Independent reviewer approved the current head SHA                     |                    | Pending                 |
| Any post-approval commit dismissed the stale approval                  |                    | Pending / Not exercised |
| Every review conversation was resolved before merge                    |                    | Pending                 |
| Branch was current and all required checks passed on the accepted head |                    | Pending                 |
| Canary merged normally without bypass                                  |                    | Pending                 |
| Ruleset insights/audit log show enforcement for the canary             |                    | Pending                 |
| No unreviewed direct push or force-push exception occurred             |                    | Pending                 |

## Decision and follow-up

- Canary merge commit:
- Bypass events in the review window and disposition:
- Last break-glass access review:
- Next quarterly ruleset/reviewer review:
- Configuration drift or linked issues:
- Governance owner decision (accepted/rejected/pending): Pending
- Independent reviewer decision (accepted/rejected/pending): Pending
