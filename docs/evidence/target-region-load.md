# Target-region load and soak evidence record

Do not record creator cookies, room codes, access tokens, participant aliases, customer content,
private target addresses, or raw session state. Store only redacted artifact references, aggregate
measurements, and independently reviewed infrastructure inventory references.

- Exercise start/end (UTC):
- Candidate Git commit and server/web image digests:
- Workflow run and attempt:
- Staging inventory reference (provider, region, machine class, resource limits):
- Load-runner inventory reference and declared region:
- Network path and expected round-trip characteristics:
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

## Soak and saturation

- Soak profile, requested duration, completed games, and artifact/checksum URL:
- VM CPU, memory, disk, network, PostgreSQL, and Valkey saturation evidence:
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
- Owner decision: Pending
- Independent reviewer decision: Pending
