# Signed release candidate evidence record

Create this record only after every `single-vm-beta-preflight` gate is complete. Do not record
registry credentials, signing secrets, private deployment targets, or unredacted vulnerability
details. Reference public workflow artifacts or access-controlled, redacted evidence instead.

## Release identity

- Release tag (`v0.9.0` for the initial beta gate; signed and protected):
- Tag object/verification reference:
- Exact `main` commit:
- Release workflow run and attempt:
- Release URL:
- Candidate creation time (UTC):
- Maintainer:
- Independent reviewer:
- `pnpm readiness:require:beta:preflight` output reference for the tagged commit:
- Matching CI, Security, and Production-path smoke workflow URLs:

## Published artifact inventory

Every subject digest must be immutable and trace to the exact tagged commit. Do not accept `latest`,
a mutable tag, a workstation build, or a signature with an identity outside the documented
allowlist.

| Artifact                          | Immutable reference/digest | Evidence | Result  |
| --------------------------------- | -------------------------- | -------- | ------- |
| Server OCI image                  |                            |          | Pending |
| Web OCI image                     |                            |          | Pending |
| Release manifest                  |                            |          | Pending |
| Server SBOM                       |                            |          | Pending |
| Web SBOM                          |                            |          | Pending |
| Server provenance/attestation     |                            |          | Pending |
| Web provenance/attestation        |                            |          | Pending |
| Server vulnerability/SARIF result |                            |          | Pending |
| Web vulnerability/SARIF result    |                            |          | Pending |
| Source archive/checksum           |                            |          | Pending |

## Independent verification

| Check                                                                                   | Command/output or artifact reference | Result  |
| --------------------------------------------------------------------------------------- | ------------------------------------ | ------- |
| Cosign verifies both image digests against the exact GitHub Actions identity and issuer |                                      | Pending |
| Provenance subjects equal the published image digests                                   |                                      | Pending |
| SBOM subjects and component inventories match the published images                      |                                      | Pending |
| Scan/SARIF results have no unresolved release-blocking finding                          |                                      | Pending |
| Image build markers equal the tagged commit                                             |                                      | Pending |
| Manifest contains the complete server/web pair and no mutable image reference           |                                      | Pending |
| Release notes describe scope, compatibility, known limitations, and checksums           |                                      | Pending |
| Compose deployment documentation uses immutable promoted digests                        |                                      | Pending |
| Upgrade, canary, rollback, and forward-repair guidance is current                       |                                      | Pending |

## Promotion and decision

- Staging verification reference for these exact digests:
- Upgrade/canary rehearsal reference:
- Rollback rehearsal reference:
- Known issues and linked fixes:
- Artifact retention location/policy:
- Maintainer decision (accepted/rejected/pending): Pending
- Independent reviewer decision (accepted/rejected/pending): Pending
- `pnpm readiness:require:beta` result after ledger acceptance:

A failed check requires a new reviewed commit and tag. Do not rewrite, replace, or attach corrected
artifacts to an existing release identity and then treat it as the originally reviewed candidate.
