# Monitoring, paging, support, and incident rehearsal

This record covers one beta-preflight gate. Alert delivery alone is not sufficient: the same
candidate must also have an active named support rota and complete an end-to-end support incident
drill accepted by both the operations owner and an independent reviewer. Do not record personal
phone numbers, private receiver URLs, access tokens, customer content, participant identifiers, or
unredacted provider payloads. Keep those details in the approved private operations system and
reference only redacted records or checksums here.

- Date/time (UTC):
- Build commit and image digest:
- Environment:
- Operations owner:
- Independent reviewer:
- Incident commander and on-call rota reference:
- Support rota and escalation-policy reference:
- Public status, security, privacy, and support contact references:
- Monitoring, logging, tracing, paging, warning, and ticket systems:

## Operational ownership

| Check                                                                    | Evidence reference | Result  |
| ------------------------------------------------------------------------ | ------------------ | ------- |
| Primary and backup responders are named for the exercise window          |                    | Pending |
| Support hours, intake route, severity rubric, and acknowledgement target |                    | Pending |
| Incident commander and technical escalation contacts are reachable       |                    | Pending |
| Public status, security, privacy, and support contacts are live          |                    | Pending |
| Every alert route and support queue has a current owner                  |                    | Pending |

## Delivery checks

| Check                              | Expected route     | Received by | Time to receive | Result  |
| ---------------------------------- | ------------------ | ----------- | --------------- | ------- |
| Synthetic `severity=page` alert    | Paging/on-call     |             |                 | Pending |
| Synthetic `severity=warning` alert | Team channel       |             |                 | Pending |
| Synthetic `severity=ticket` alert  | Work queue         |             |                 | Pending |
| Resolution notification            | Original routes    |             |                 | Pending |
| Trace lookup from `x-trace-id`     | Tracing backend    |             |                 | Pending |
| Request lookup from `x-request-id` | Log backend        |             |                 | Pending |
| Metrics route denied without token | Collector boundary |             |                 | Pending |

## End-to-end support incident drill

- Scenario used:
- Synthetic support report and intake route:
- Severity classification and triage result:
- Detection time:
- Acknowledgement time:
- Technical escalation and responder handoff result:
- Kill switch exercised:
- Active game impact:
- Initial status/support communication and update timing:
- Resolution, customer-facing closure, and queue disposition:
- Target acknowledgement/resolution result:
- Runbook gaps and issue URLs:

## Acceptance

- Page, warning, ticket, resolution, trace, log, and metrics-boundary checks all pass:
- Named support rota, incident command, escalation, and public contact checks all pass:
- The support report was triaged, escalated, communicated, mitigated, and closed end to end:
- No unresolved severity-1/2 operational or support defect remains:
- Operations owner decision (accepted/rejected/pending): Pending
- Independent reviewer decision (accepted/rejected/pending): Pending
