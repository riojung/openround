# Live billing rehearsal evidence record

Use Stripe test mode and a dedicated synthetic creator/workspace. Do not record API keys, webhook
secrets, cookies, customer email addresses, payment-method details, full provider payloads, checkout
URLs, or unredacted Stripe object IDs. Keep sensitive provider evidence in the approved private
operations system and reference redacted artifacts or checksums only.

## Candidate and configuration

- Exercise start/end (UTC):
- Candidate Git commit and image digests:
- Single-VM staging evidence reference:
- Synthetic account/workspace reference:
- Stripe test account and endpoint reference (redacted):
- Product/price configuration version or checksum:
- Signed replay workflow run/artifact:
- Operations owner:
- Independent reviewer:

## Configuration checks

| Check                                                                                         | Evidence reference | Result  |
| --------------------------------------------------------------------------------------------- | ------------------ | ------- |
| Test-mode restricted key and webhook secret come from the approved secrets system             |                    | Pending |
| Webhook endpoint uses public HTTPS and verifies the Stripe signature                          |                    | Pending |
| Checkout price, currency, interval, trial, tax, and customer notices match the approved offer |                    | Pending |
| Customer portal exposes only the approved cancellation and billing actions                    |                    | Pending |
| Logs, traces, support tools, and artifacts omit secrets and full billing payloads             |                    | Pending |
| Entitlement changes are attributable and reconcile to provider state                          |                    | Pending |

## Provider-originated journey

Locally signed replay payloads test ordering and idempotency but do not replace these actions from
Stripe's test environment.

| Step                                                  | Provider event/action reference | Application observation | Entitlement result | Result  |
| ----------------------------------------------------- | ------------------------------- | ----------------------- | ------------------ | ------- |
| Complete test-mode checkout                           |                                 |                         |                    | Pending |
| Receive and verify provider-originated signed webhook |                                 |                         |                    | Pending |
| Open the customer portal                              |                                 |                         |                    | Pending |
| Cancel through the portal                             |                                 |                         |                    | Pending |
| Receive cancellation/update webhook                   |                                 |                         |                    | Pending |
| Reconcile final provider and local state              |                                 |                         |                    | Pending |

## Retry, ordering, and failure behavior

| Scenario                                    | Expected behavior                                               | Evidence reference | Result  |
| ------------------------------------------- | --------------------------------------------------------------- | ------------------ | ------- |
| Deliver the same event more than once       | One durable effect; duplicates acknowledged safely              |                    | Pending |
| Retry after a transient application failure | Event converges without duplicate entitlement change            |                    | Pending |
| Deliver an older event after newer state    | Stale event cannot roll entitlement backward                    |                    | Pending |
| Invalid signature                           | Request rejected with no state change                           |                    | Pending |
| Cancellation/end-of-period transition       | Effective access matches the approved policy and provider state |                    | Pending |
| Reconciliation after process restart        | Local entitlement converges to provider truth                   |                    | Pending |

## Reconciliation and cleanup

- Initial local entitlement and provider state:
- Final local entitlement and provider state:
- Duplicate/stale/invalid events observed and durable outcomes:
- Billing audit-event reference:
- Synthetic subscription/customer cleanup result:
- Credential/session rotation result:
- Failures, discrepancies, and linked issues:

## Acceptance

- Checkout, portal, signed delivery, retry idempotency, cancellation, and reconciliation all pass:
- Replay and provider-originated evidence represent the same candidate and configuration:
- No unresolved entitlement mismatch or severity-1/2 defect remains:
- Operations owner decision (accepted/rejected/pending): Pending
- Independent reviewer decision (accepted/rejected/pending): Pending
