# Privacy and legal source packet

This packet is an engineering inventory for qualified counsel. It is not legal advice and it is
not a privacy notice, contract, consent decision, or launch approval. Keep privileged advice,
personal contacts, commercial terms, signatures, provider credentials, and private document URLs
in the restricted legal system.

## Freeze the reviewed launch scope

Before sending the packet, record in the private matter:

- exact product and documentation commits plus immutable server/web image digests;
- legal entity/operator, community-versus-hosted posture, selected launch markets and languages;
- intended higher-education/workplace users, excluded populations, age posture, and whether payment
  is accepted;
- exact application, media, telemetry, backup, email, billing, support, and authoring-AI providers,
  regions, retention, subprocessors, contracts, and cross-border transfer mechanisms;
- Free/Pro limits, prices, tax/refund/cancellation behavior, support hours, security/privacy/status
  contacts, and incident-notification process; and
- every feature enabled for the candidate, including Learning/Verified trust mode, media, chat,
  Pulse, practice, Presentations, billing, OIDC/LTI, and authoring AI.

Changing a market, language, provider, region, purpose, identity mode, learner population, price,
retention period, or enabled data path after review requires counsel to decide whether re-review is
mandatory.

## Repository-derived engineering sources

Pin the checksum of each in-scope source rather than copying it into a legal document:

| Subject                     | Primary source                                                                                               | What counsel must verify against the deployed candidate                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Product/data boundaries     | `docs/architecture.md`, `docs/api.md`                                                                        | Actors, trust boundaries, accountless participation, realtime credentials, projections            |
| Data inventory              | `docs/privacy-data-map.md`                                                                                   | Purposes, fields, locations, retention, export, deletion, telemetry, backups                      |
| Learning/Verified semantics | `docs/design.md`, `docs/implementation-status.md`                                                            | Session-scoped aliases, no persistent learner profile, disabled institution learner paths         |
| Security controls           | `docs/architecture.md`, `docs/decisions/001-creator-authentication.md`, `docs/runbooks/incident-response.md` | Authentication, encryption boundaries, incidents, moderation, contacts, limitations               |
| Retention/export/deletion   | `docs/privacy-data-map.md`, `docs/runbooks/production-readiness.md`                                          | Actual plan windows, cascades, backup copies, audit retention, account deletion failure behavior  |
| Deployment/residency        | `docs/runbooks/deployment.md`, `docs/runbooks/backup-restore.md`                                             | Selected region, failure domain, off-host copies, telemetry and support access                    |
| Billing                     | `docs/evidence/live-billing-rehearsal.md`, server billing configuration                                      | Provider identifiers retained, entitlement source of truth, cancellation/refund/tax posture       |
| Media                       | `docs/architecture.md`, media configuration and runbooks                                                     | Quarantine, ClamAV, private delivery, object deletion, provider region                            |
| Authoring AI                | `docs/architecture.md`, `docs/design.md`, `docs/implementation-status.md`                                    | Disabled/default posture, exact provider/model, source handling, prompts, retention, human review |
| Institution paths           | `docs/institution-integrations.md`                                                                           | Creator-only OIDC/LTI scope, disabled learner/roster/grade paths, no retroactive association      |
| Community edition           | `LICENSE`, `README.md`                                                                                       | Operator responsibilities and separation from the hosted-service operator                         |

Repository documentation describes intended and tested behavior; counsel must receive the real
provider/configuration inventory and any observed deviation.

## Counsel-authored or counsel-approved artifacts

The restricted source set must include versioned drafts for every row in the
[privacy/legal approval record](privacy-legal-approval.md), including the privacy notice, terms,
cookie/consent behavior, acceptable-use and content policies, DPA, subprocessor/change notice,
retention/deletion/access/export procedure, residency/transfers, incident/breach/law-enforcement
procedure, paid-beta/billing/refund/tax terms, and monitored contact disclosures.

The checked-in `/privacy` and `/terms` pages are explicit drafts. They must not be treated as
approved text. In particular, counsel must reconcile the current `en-CA` language and Canadian
region statement with the selected markets, actual deployed regions, operator identity, and all
enabled providers before public traffic or payment.

## Approval handoff

1. Freeze the source index and record a SHA-256 for every artifact plus the product/docs commits.
2. Have qualified counsel record approved, rejected, or conditional for every source artifact and
   product-specific behavior. Oral approval is not sufficient.
3. Convert every condition into an owned issue and provide completion evidence back to counsel.
   A condition is not closed merely because engineering says it is planned.
4. Have counsel issue a final written decision for the exact markets, languages, populations,
   providers, feature set, and payment posture. Record expiry/re-review triggers.
5. Have the internal privacy/legal owner independently verify that deployed behavior and public
   documents match the approved set, then complete the redaction-safe acceptance binding. Any
   pending row or incomplete condition keeps the readiness gate pending.
