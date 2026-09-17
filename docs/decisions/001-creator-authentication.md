# ADR 001: Keep the server-owned creator session for P0

- Status: accepted for P0
- Date: 2026-09-16

## Context

The initial plan named Auth.js with a PostgreSQL adapter. OpenRound now has a Fastify-owned,
email-magic-link flow with hashed, one-time, expiring tokens; hashed, revocable creator sessions;
secure HttpOnly cookies; explicit logout; policy consent records; workspace-scoped creator
contexts; and integration coverage. Replacing it solely to match a library choice would change a
security-critical path without adding a P0 capability.

## Decision

Keep the current implementation for P0 and treat its documented behavior as the invariant. This
is a deliberate architecture decision, not an untracked omission. Reconsider Auth.js or another
identity provider when OpenRound needs federated identity, account linking, institutional SSO,
provider-managed multifactor authentication, or a separately operated identity service.

Any migration must preserve session revocation, consent history, tenant isolation, auditability,
cookie security, realtime-token scoping, and account deletion. It requires threat-model review,
session migration/forced reauthentication planning, and equivalent integration and browser tests.
