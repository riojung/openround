# Monitoring, alerting, and incident rehearsal

- Date/time (UTC):
- Build commit and image digest:
- Environment:
- Incident commander/on-call responder:
- Monitoring, logging, tracing, paging, warning, and ticket systems:

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

## Operational drill

- Scenario used:
- Detection time:
- Acknowledgement time:
- Kill switch exercised:
- Active game impact:
- Status/support communication result:
- Runbook gaps and issue URLs:
- Reviewer decision: Pending
