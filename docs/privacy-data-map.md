# Privacy data map

This engineering inventory is not a legal opinion. Confirm purposes, legal basis, processor location, notices, and contracts before production.

| Data                        | Purpose                              |              Default retention | Location rule                    | Deletion                                               |
| --------------------------- | ------------------------------------ | -----------------------------: | -------------------------------- | ------------------------------------------------------ |
| Creator email and session   | Account access and support           |  Account life; session 30 days | Workspace home region            | Account deletion anonymizes email and revokes sessions |
| Policy consent and version  | Evidence of creator acknowledgement  |       Policy/legal requirement | Workspace home region            | Counsel-approved retention/anonymization procedure     |
| Quiz content and versions   | Authoring and frozen live delivery   |                   Account life | Workspace home region            | Workspace/account deletion                             |
| Image objects and metadata  | Instructional question media         |  Account life; quarantine 24 h | Workspace home region            | Account deletion or quarantine cleanup                 |
| Participant nickname        | Room identification                  |     Free 30 days; Pro 365 days | Session home region              | Session purge or early deletion                        |
| Answers, scores, timestamps | Correctness, recovery, reports       |     Free 30 days; Pro 365 days | Session home region              | Session purge or early deletion                        |
| Opaque token hashes         | Resume and authorization             | Live use 24 h; purge with data | Session home region              | Session purge                                          |
| Security metadata           | Abuse prevention and incident review |                 30 days target | Primary region                   | Scheduled purge                                        |
| Audit records               | Sensitive-operation accountability   |                365 days target | Workspace home region            | Policy-controlled deletion                             |
| Stripe identifiers/status   | Entitlement reconciliation           |     Contract/legal requirement | Provider plus application region | Provider and application workflow                      |

Account export includes media metadata but not binary image bytes. Account deletion first removes
the workspace's private objects and then cascades durable product records; it stops before deleting
the account record if object storage or cache cleanup fails. Host and participant token hashes are
not included in export.

Live session access and report retention are separate clocks. Host and participant credentials
stop working when the 24-hour live window ends; the session tree remains inaccessible to guests
but available to its creator until the stored plan-based purge deadline or an earlier explicit
deletion.

Never collect participant birth date, phone, precise location, advertising ID, biometric information, social graph, or marketing consent in P0. Never place participant data in AI prompts. Normal logs must redact email, nickname, tokens, answer content, cookies, and billing payloads.
