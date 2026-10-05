# Signed release candidate evidence record

Create this record only after every `single-vm-beta-preflight` gate is complete. Do not record
registry credentials, signing secrets, private deployment targets, or unredacted vulnerability
details. Reference public workflow artifacts or access-controlled, redacted evidence instead.

## Release identity

- Release tag (`v0.9.0` for the initial beta gate; signed and protected):
- Exact annotated tag object ID and verification reference:
- Exact tagged `main` commit/build ID:
- Exact exercised candidate commit and evidence-only descendant proof:
- Release workflow run and attempt:
- Draft release URL (must remain draft until final acceptance):
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

The release workflow assembles this inventory only after the image build, both release-blocking
scans, Cosign signing/verification, immutable manifest, SBOM, and provenance steps succeed. It
creates a draft GitHub Release and attaches the bounded notes and `SHA256SUMS`; it has no automatic
publication path. Its final step re-reads the release through the GitHub API, requires the exact 13
documented assets with no extras, compares every API-reported size and SHA-256 digest with the local
file, requires the draft title/body to match the checksummed `release-notes.md`, downloads
`SHA256SUMS` by its GitHub asset ID, and retains
`release-publication-<tag>/release-binding.json`. Confirm the API still reports `draft: true` before
beginning review.

The tagged commit must be a descendant of the one commit named by every completed preflight-gate
acceptance, and `docs/release-readiness.json` must be the complete tree delta between them. This
allows reviewed evidence to be recorded without the impossible requirement that a commit contain
its own future SHA. Any application, configuration, workflow, migration, or other source change
after the exercised candidate requires a new candidate and affected evidence.

## Ledger acceptance binding

After both reviewers accept the evidence, merge an evidence-only change to
`docs/release-readiness.json`. Change only its `updatedAt` and the `signed-release` gate: set the
gate to `complete`, replace `nextAction` with stable HTTPS evidence references, and add an
`acceptance` object plus the exact `releaseBinding` emitted by the protected release workflow. The
acceptance manifest URL and checksum must be the `downloadUrl` and `digest` of the bound
`SHA256SUMS` asset:

```json
"acceptance": {
  "recordVersion": 1,
  "candidateBuildId": "<exercised preflight candidate commit>",
  "environment": "github-release-draft",
  "startedAt": "<ISO-8601 UTC review start>",
  "completedAt": "<ISO-8601 UTC review completion>",
  "acceptedAt": "<ISO-8601 UTC acceptance time>",
  "owner": { "role": "maintainer", "decision": "accepted" },
  "independentReviewer": {
    "role": "independent-release-reviewer",
    "independent": true,
    "decision": "accepted"
  },
  "manifest": {
    "url": "https://github.com/riojung/openround/releases/download/v0.9.0/SHA256SUMS",
    "sha256": "sha256:<SHA-256 of the exact downloaded SHA256SUMS bytes>"
  }
},
"releaseBinding": {
  "schemaVersion": 2,
  "tag": "v0.9.0",
  "tagObject": "<full annotated Git tag object ID>",
  "buildId": "<full tagged commit ID>",
  "githubRelease": {
    "id": 123456789,
    "apiUrl": "https://api.github.com/repos/riojung/openround/releases/123456789",
    "htmlUrl": "<exact GitHub API html_url>",
    "targetCommitish": "<full tagged commit ID>",
    "draft": true,
    "createdAt": "<exact GitHub API created_at>"
  },
  "manifestDigest": "sha256:<SHA-256 of the exact downloaded build-manifest.json bytes>",
  "imageDigests": {
    "server": "sha256:<server image digest>",
    "web": "sha256:<web image digest>"
  },
  "assets": [
    {
      "id": 123456790,
      "name": "SHA256SUMS",
      "size": 1234,
      "digest": "sha256:<SHA-256 of the exact SHA256SUMS bytes>",
      "apiUrl": "https://api.github.com/repos/riojung/openround/releases/assets/123456790",
      "downloadUrl": "https://github.com/riojung/openround/releases/download/v0.9.0/SHA256SUMS"
    }
  ]
}
```

The abbreviated `assets` example shows one entry only; do not construct it by hand. Copy the entire
sorted 13-entry array from `release-binding.json`. It must contain `SHA256SUMS`, the release notes,
the source archive, the preflight and build manifests, and server/web Cosign verification, SBOM,
provenance, and SARIF files—no more and no fewer.

Do not reformat downloaded files before calculating their digests. The deployer permits the
resulting descendant commit only when its complete tree delta from `buildId` is the readiness
ledger, every other gate is byte-equivalent in parsed JSON, and the owner and explicitly independent
reviewer have accepted the exact checksum asset. It fetches `origin/main` and the annotated tag,
then independently asks GitHub for the tag object and bound release ID. The release must still be a
draft for acceptance and the first deployment, with the accepted creation time, target commit, and
exact asset IDs, names, sizes, digests, API URLs, and canonical download URLs. For later normal or
replacement-host deployment, the deployer accepts that same release after publication only in
explicit published-redeploy mode with the independently reviewed SHA-256 of its successful
pre-publication production receipt. That receipt must prove the exact accepted release, immutable
manifest/images, reviewed production target and configuration, successful post-deploy checks, and
operations inputs; its deployment interval must begin after acceptance and finish before
publication. A published release without this prior-deployment proof is rejected, so it cannot be
used for a first production deployment. The deployer also requires publication to follow creation
and acceptance and every bound byte and identity to remain unchanged. It downloads the bound
`SHA256SUMS` and preflight assets by asset ID,
verifies their bytes, requires canonical checksums for every other required asset, and requires the
preflight to name the accepted exercised candidate plus successful `push` runs on `main` from the
exact CI, Security, and Production-path smoke workflow files. A local-only, unsigned, recreated,
mutated, or substituted tag, release, or asset is never acceptable evidence.

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
- Maintainer role, decision, and acceptance time (accepted/rejected/pending): Pending
- Independent reviewer role, independence attestation, decision, and acceptance time: Pending
- `pnpm readiness:require:beta` result after ledger acceptance:
- Exact draft deployment and post-deploy verification reference:
- Manual publication actor/time (only after the final command and exact draft deployment succeed):

A failed check requires a new reviewed commit and tag. Do not rewrite, replace, or attach corrected
artifacts to an existing release identity and then treat it as the originally reviewed candidate.
The release workflow accepts only the first creation push for a version tag. The accepted GitHub
release must remain a draft while the deployer downloads and verifies its exact manifest and while
the canary/post-deploy checks run. Only then may a named maintainer publish that unchanged draft.
After any failed or rejected candidate, increment the version and create a new protected tag and
draft release.
