# Target-region load and soak evidence record

Do not record creator cookies, room codes, access tokens, participant aliases, customer content,
private target addresses, or raw session state. Store only redacted artifact references, aggregate
measurements, and independently reviewed infrastructure inventory references.

- Exercise start/end (UTC):
- Candidate Git commit and server/web image digests:
- Workflow run and attempt:
- Staging inventory reference (provider, region, machine class, resource limits):
- Load-runner inventory reference and declared region:
- Installed Actions Runner version:
- Runner-version command output/checksum or inventory evidence reference:
- `actions-runner-2-327-1-plus` label applied after version review (reviewer and UTC):
- Automatic-update/current-release verification:
- Network path and expected round-trip characteristics:
- `target-region-evidence-bundle.json` URL and SHA-256:
- Target saturation evidence reference (CPU, memory, disk, network, PostgreSQL, Valkey):
- Durable archive reference:
- Owner and independent reviewer:

## Required target-region matrix

Every row must target the same candidate build and provisioned single-VM environment. A missing,
failed, or stale row makes the gate incomplete. Local Compose and co-located CI results are useful
instrumentation checks but cannot fill this matrix.

| Artifact     | Clients | Run ID / artifact URL | Joined | Accepted responses | Client receipt | Report reconciliation | Latency result | Result  |
| ------------ | ------: | --------------------- | -----: | -----------------: | -------------- | --------------------- | -------------- | ------- |
| Round        |      50 |                       |        |                    |                |                       |                | Pending |
| Presentation |      50 |                       |        |                    |                |                       |                | Pending |
| Round        |     250 |                       |        |                    |                |                       |                | Pending |
| Presentation |     250 |                       |        |                    |                |                       |                | Pending |

For every row, attach the complete redacted JSON artifact and record:

- Verified build ID and run ID:
- Join p50/p95:
- Durable answer acknowledgement p50/p95/p99:
- Participant receipt p95 and timeout count/rate:
- Reconnect/synchronization result:
- Accepted response count and reconciled report response count:
- Lost or duplicate accepted responses:
- Pre-reveal answer-key or hidden-diagnostic leakage result:
- Failure, retry, or exclusion details:

Every row uses target-load schema version 2 with the same `artifactType`, numeric `profile`,
`runnerRegion`, expected/observed build identity, counts, correctness, receipts, recovery, report,
latency, and immutable threshold fields. The bundle must list exactly the four rows above plus
runner provenance and the soak summary, hash their exact bytes, and report all validation flags as
true except the deliberately external `externalEvidenceContentVerified` and `acceptanceComplete`
flags. Those remain false because a URL alone cannot prove the referenced saturation/archive
content or human acceptance. A zero-minute dispatch must also report `soakValidated: false`; retain
it only as incomplete fixed-matrix evidence. Do not accept loose files when the bundle
build/region/workflow identity, target origin, wall-clock coverage, inventory, or a source hash
differs.

## Soak and saturation

- Soak profile, requested duration, completed games, and artifact/checksum URL:
- VM CPU, memory, disk, network, PostgreSQL, and Valkey saturation evidence from the target services (not runner metrics):
- Process-restart and coordination-loss recovery evidence reference:
- Abuse/rate-limit observations:
- Estimated target-host cost and support impact:
- Incidents or linked issues:

## Acceptance

- All four matrix rows meet join p95 below 500 ms:
- All four rows meet answer acknowledgement p95 below 250 ms and p99 below 600 ms:
- All four rows meet participant receipt p95 below 500 ms with no material timeout rate:
- Every acknowledged response is unique, durable, and present in the reconciled report:
- Representative soak completed without response loss, report mismatch, data leak, or severity-1/2 defect:
- Bundle is retained at the durable archive reference and every recorded source hash matches:
- Owner decision: Pending
- Independent reviewer decision: Pending
