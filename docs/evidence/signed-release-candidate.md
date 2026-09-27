# Signed release candidate evidence record

Create this record only after every `single-vm-beta-preflight` gate is complete. Do not record
registry credentials, signing secrets, private deployment targets, or unredacted vulnerability
details. Reference public workflow artifacts or access-controlled, redacted evidence instead.

## Release identity

- Release tag (`v0.9.0` for the initial beta gate; signed and protected):
- Exact annotated tag object ID and verification reference:
- Exact tagged `main` commit/build ID:
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
allowlist. HIGH/CRITICAL scans include findings without an upstream fix; do not treat the absence
of a fix as acceptance.

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

## Ledger acceptance binding

After both reviewers accept the evidence, merge an evidence-only change to
`docs/release-readiness.json`. Change only its `updatedAt` and the `signed-release` gate: set the
gate to `complete`, replace `nextAction` with stable HTTPS evidence references, and add this
machine-validated binding using values copied from the protected release workflow artifacts:

```json
"releaseBinding": {
  "schemaVersion": 1,
  "tag": "v0.9.0",
  "tagObject": "<full annotated Git tag object ID>",
  "buildId": "<full tagged commit ID>",
  "manifestDigest": "sha256:<SHA-256 of the exact downloaded build-manifest.json bytes>",
  "imageDigests": {
    "server": "sha256:<server image digest>",
    "web": "sha256:<web image digest>"
  }
}
```

Do not reformat the downloaded manifest before calculating `manifestDigest`. The deployer permits
the resulting descendant commit only when its complete tree delta from `buildId` is the readiness
ledger, every other gate is byte-equivalent in parsed JSON, the annotated tag object resolves to
`buildId`, all three artifact digests match the selected manifest, and an immediate fetch from the
trusted OpenRound `origin` confirms that the acceptance commit is the current `main` tip and the tag
object is published. The deployer also asks GitHub for that exact tag object and requires its
cryptographic verification status to be `valid`, its tag name to match, and its target to be the
bound build commit. A local-only, unsigned, recreated, or substituted tag is never acceptable
evidence.

Cosign verification during deployment derives the exact release-workflow certificate identity from
this bound tag; a signature issued for a different allowed release tag is rejected.

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
