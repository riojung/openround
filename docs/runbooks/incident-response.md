# Incident response runbook

## Severity

- **SEV1:** participant data exposure, broad authentication failure, durable answer corruption, or most live sessions unavailable.
- **SEV2:** one customer or region materially impaired, billing/retention failure, or elevated answer/report mismatch.
- **SEV3:** degraded non-critical workflow with a safe workaround.

## Response

1. Acknowledge, name an incident commander, preserve evidence, and open a timestamped decision log.
2. Protect active rooms: stop deployment, disable risky features, reject new lobbies if necessary, and preserve durable answers.
3. Assess affected region, deployment version, sessions, data classes, and time window using identifiers rather than participant content.
4. Mitigate with pause, rollback, credential rotation, traffic isolation, or provider failover as appropriate.
5. Update the independent status page. Use counsel-approved customer notification procedures for possible privacy incidents.
6. Reconcile answers and reports before declaring recovery.
7. Complete a blameless review with root cause, detection gap, customer impact, corrective owner, due date, and regression test.

Never copy tokens, cookies, participant nicknames, answer content, email addresses, or full billing events into chat or incident documents.
