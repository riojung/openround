# Privacy data map

This engineering inventory is not a legal opinion. Confirm purposes, legal basis, processor location, notices, and contracts before production.

| Data                        | Purpose                              |                                     Default retention | Location rule                                                               | Deletion                                                |
| --------------------------- | ------------------------------------ | ----------------------------------------------------: | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| Creator email and session   | Account access and support           |                         Account life; session 30 days | Workspace home region                                                       | Account deletion anonymizes email and revokes sessions  |
| Policy consent and version  | Evidence of creator acknowledgement  |                              Policy/legal requirement | Workspace home region                                                       | Counsel-approved retention/anonymization procedure      |
| Checkpoint content/versions | Authoring and frozen live delivery   |                                          Account life | Workspace home region                                                       | Workspace/account deletion                              |
| Image objects and metadata  | Instructional question media         |                         Account life; quarantine 24 h | Workspace home region                                                       | Account deletion or quarantine cleanup                  |
| Participant nickname        | Room identification                  |                            Free 30 days; Pro 365 days | Session home region                                                         | Session purge or early deletion                         |
| Answers, scores, timestamps | Correctness, recovery, reports       |                            Free 30 days; Pro 365 days | Session home region                                                         | Session purge or early deletion                         |
| Confidence/interventions    | Recovery diagnosis and evidence      |                            Free 30 days; Pro 365 days | Session home region                                                         | Session purge or early deletion                         |
| Q&A, replies, votes         | Audience voice and moderation        |                            Free 30 days; Pro 365 days | Session home region                                                         | Session purge, moderation, or early deletion            |
| Follow-up attempts/answers  | Accountless unresolved-concept work  |                       Source-session retention window | Session home region                                                         | Source session purge, revocation, or early deletion     |
| Authoring source/job        | Create cited review-only drafts      | 30/365 days; source cleared after terminal processing | Workspace home region; configured provider receives bounded source sections | Job retention or account deletion                       |
| External creator identity   | Explicit institution sign-in/linking |                            Account or membership life | Workspace home region; identity provider processes its own authentication   | Creator unlink, membership removal, or account deletion |
| LTI registration/launch     | Instructor launch and Deep Linking   |           Registration life; launches are short-lived | Workspace home region; registered LMS receives the signed response          | Operator disable, launch expiry, or workspace deletion  |
| Opaque token hashes         | Resume and authorization             |                        Live use 24 h; purge with data | Session home region                                                         | Session purge                                           |
| Security metadata           | Abuse prevention and incident review |                                        30 days target | Primary region                                                              | Scheduled purge                                         |
| Audit records               | Sensitive-operation accountability   |              365 days by default, operator-configured | Workspace home region                                                       | Scheduled purge plus workspace deletion                 |
| Stripe identifiers/status   | Entitlement reconciliation           |                            Contract/legal requirement | Provider plus application region                                            | Provider and application workflow                       |

Account export includes authoring source text and uploaded-source bytes while a job still needs
them, because it is the creator's private account export. Ordinary authoring API views never return
the raw source. Terminal processing clears source text/bytes and retains only the digest, proposal,
and citations until job retention expires. Provider processing location depends on the operator's
approved configuration and must be disclosed separately.

Account export includes media metadata but not binary image bytes. Account deletion first removes
the workspace's private objects and then cascades durable product records; it stops before deleting
the account record if object storage or cache cleanup fails. Host and participant token hashes are
not included in export.

Live session access and report retention are separate clocks. Host and participant credentials
stop working when the 24-hour live window ends; the session tree remains inaccessible to guests
but available to its creator until the stored plan-based purge deadline or an earlier explicit
deletion.

Never collect participant birth date, phone, precise location, advertising ID, biometric
information, social graph, or marketing consent in the guest experience. Never place participant,
session, report, or Q&A data in authoring prompts. Normal logs must redact email, nickname, tokens,
answer content, cookies, and billing payloads.

Federated identity records store provider, issuer, subject, optional verified email hint, link
time, and last-use time. Ordinary identity APIs omit the subject. OIDC state and LTI state are
stored only as short-lived hashes; OIDC PKCE verifiers/nonces and LTI nonces expire with those
transactions. Account export excludes bearer hashes and LTI response JWTs. An approved
institution audit export includes actor IDs, actions, targets, request IDs, timestamps, metadata,
and the workspace home-region label, so its recipients and retention require institutional policy.
The scheduled retention worker deletes audit records older than `AUDIT_RETENTION_DAYS` (365 by
default, configurable from 30 to 3,650 days); an institution must approve that value before launch.

Creator OIDC and instructor LTI do not change participant anonymity. Identified learner launch,
NRPS, AGS, managed SAML/SCIM, and K–12 remain disabled or unimplemented in this release.
