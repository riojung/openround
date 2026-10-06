# Ubuntu 26 GitHub-hosted runner migration

[GitHub plans](https://github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration/)
to move the `ubuntu-latest` label from Ubuntu 24 to Ubuntu 26 between October 19 and November 19, 2026. OpenRound uses native Node dependencies, Playwright browser packages, service containers,
Docker Compose, Buildx, Trivy, and Cosign, so a normal unit-test pass is not sufficient compatibility
evidence. Compare the published [Ubuntu 26 runner
inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2604-Readme.md)
with the [Ubuntu 24 runner
inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
when reviewing a failure.

The `Ubuntu 26 compatibility canary` workflow runs explicitly on `ubuntu-26.04`. It is scheduled
weekly, can be dispatched manually, and runs on runner-sensitive workflow, Dockerfile, Compose,
and lockfile pull requests. Primary CI now runs on the same Ubuntu 26 image and retains the format,
lint, type, unit, build, readiness, tracing, observability, PostgreSQL/RLS/multi-writer, and full
desktop/mobile Chromium, Firefox, and WebKit checks. The canary no longer repeats those three jobs;
it retains the two distinct checks:

- the production Compose media, observability, multi-process, backup/restore, and restart paths;
- Buildx plus server/web image builds, with Trivy and Cosign installation/version checks.

Every canary job has an explicit `Ubuntu 26 / ...` display name and a prefixed job identifier.
These contexts do not replace, satisfy, or share a name with any required `CI` or `Security`
context. A scheduled canary result therefore cannot be mistaken for a required pull-request check.
Production-path smoke continues on every `main` push. Removing duplicate jobs does not close the
two-scheduled-run acceptance gate below or remove any release, capacity, signing, or restore gate.

The canary deliberately disables hosted-runner latency assertions in its 100-client Compose sample.
It checks correctness, restart recovery, response uniqueness, and report reconciliation; variable
GitHub-hosted hardware is not target-region capacity evidence and cannot close a release-readiness
gate. Its image job also performs actual Trivy scans and an ephemeral local-key Cosign sign/verify
cycle. That cycle tests the Ubuntu binary path only; it does not replace the release workflow's
keyless identity, registry, transparency-log, or signed-manifest evidence.

## Migration decision

The migration pull request replaces every GitHub-hosted `runs-on: ubuntu-latest` label with explicit
`ubuntu-26.04`. Do not merge it until the normal CI and Security workflows plus every canary job
complete successfully on that exact head commit. The Security run must include dependency review,
audit/license verification, gitleaks, SBOM generation, and CodeQL. Review the uploaded
image-toolchain versions, Trivy output, Cosign verification, and Compose evidence, and confirm there
was no response loss, report mismatch, browser failure, migration failure, or unsupported action
runtime.

After merge, require the automatic Production-path smoke run and two scheduled canary runs to pass
on the migrated default branch before removing the temporary canary. A later tagged release still
must independently prove keyless signing and verification. Do not alter the protected self-hosted
target-region label while performing the hosted-runner migration.

If a blocking incompatibility remains near October 19, pin affected hosted jobs to
`ubuntu-24.04`, open an owner/date-bound remediation issue, and keep the canary running. Treat that
pin as a temporary rollback, not accepted Ubuntu 26 evidence. Never change to `ubuntu-26.04` merely
to silence the migration notice.
