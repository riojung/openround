# Single-VM staging deployment evidence record

Do not record SSH keys, environment files, access tokens, cookies, private IP addresses, internal
hostnames, unredacted provider screenshots, or secret-bearing command output. Store those details in
the approved private operations system and link only a redacted record or checksum here.

## Candidate and ownership

- Exercise start/end (UTC):
- Candidate Git commit:
- Server and web image digests:
- Signed staging manifest workflow/artifact URL:
- Deployment configuration fingerprint or checksum (no values):
- Provider, region, machine class, and resource-limit inventory reference:
- GitHub environment and protection-rule reference:
- Operations owner:
- Independent reviewer:

## Host and deployment baseline

| Check                                                                             | Evidence reference | Result  |
| --------------------------------------------------------------------------------- | ------------------ | ------- |
| Dedicated VM uses the approved supported OS and current security patches          |                    | Pending |
| Non-root deployment account and restricted Docker access are documented           |                    | Pending |
| Inbound firewall admits only approved SSH and HTTPS paths                         |                    | Pending |
| SSH host key was obtained through an independent channel and is pinned            |                    | Pending |
| Application and media DNS resolve to the reviewed target                          |                    | Pending |
| Application and media origins have valid public TLS; HTTP redirects to HTTPS      |                    | Pending |
| Candidate images and manifest signatures verify before deployment                 |                    | Pending |
| Production configuration preflight passes for the exact candidate                 |                    | Pending |
| Migrations use the owner connection; runtime uses the forced-RLS application role |                    | Pending |
| Encrypted database and object backups leave the VM on the approved schedule       |                    | Pending |

## Service and dependency verification

Every row must refer to the same deployed candidate. A locally substituted dependency or a service
whose readiness check is degraded keeps this record pending.

| Component                    | Required observation                                                      | Evidence reference | Result  |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------ | ------- |
| Caddy                        | TLS termination, security headers, and HTTPS redirect pass                |                    | Pending |
| Web                          | Root responds and `X-OpenRound-Build-Id` matches the candidate            |                    | Pending |
| API/realtime                 | `/health/live` and `/health/ready` pass with the expected build ID        |                    | Pending |
| PostgreSQL                   | Durable write/read and forced-RLS runtime access pass                     |                    | Pending |
| Valkey                       | Readiness and realtime adapter/lease dependency pass                      |                    | Pending |
| MinIO/private object storage | Private object write/read and authorization pass                          |                    | Pending |
| ClamAV                       | Fresh signatures and quarantine-to-clean media flow pass                  |                    | Pending |
| SMTP                         | Synthetic delivery reaches the approved test inbox                        |                    | Pending |
| Metrics                      | Authenticated collector succeeds; unauthenticated/public access is denied |                    | Pending |
| Tracing                      | Synthetic trace reaches the selected backend and can be found by trace ID |                    | Pending |

## Remote readiness result

- Staging readiness workflow run and attempt:
- Remote-probe artifact URL/checksum:
- Verified API build ID:
- Verified web build ID:
- Dependency-health result:
- Expected-versus-effective deployment and workspace feature controls:
- Media upload, malware scan, private delivery, and deletion result:
- Creator authentication and synthetic workspace result:
- Redaction review result:
- Failures, retries, exclusions, and linked issues:

The hosted remote probe establishes deployment correctness only. Record the four target-region load
profiles and soak in the separate [target-region load record](target-region-load.md); record alert
delivery and off-host restoration in their own gates.

## Acceptance

- Exact candidate is deployed from the signed protected-workflow manifest:
- All required services are healthy with no local/degraded substitution:
- TLS, build fencing, configuration preflight, SMTP, private media, metrics, and tracing pass:
- No database, Valkey, MinIO administration, metrics endpoint, or Docker socket is public:
- Open severity-1/2 defects, security findings, or unreconciled failures:
- Operations owner decision (accepted/rejected/pending): Pending
- Independent reviewer decision (accepted/rejected/pending): Pending
