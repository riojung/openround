# OpenRound documentation

OpenRound is a pre-release, independently branded comprehension recovery system for higher
education and workplace learning. Use this index to choose the shortest path for your role.

## Start here

| I want to…                                                | Read                                                                       |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Get guidance that matches my enabled workspace            | Sign in and open the in-product `/help` page                               |
| Run OpenRound locally and complete a first round          | [Quick start](quick-start.md)                                              |
| Create, host, join, recover, and review understanding     | [User guide](user-guide.md)                                                |
| Understand product behavior and interaction choices       | [Product and experience design](design.md)                                 |
| Review the 2026 Kahoot-alternatives UX benchmark and plan | [Kahoot-alternatives UX gap plan](kahoot-alternatives-2026-ux-gap-plan.md) |
| Review the competitive position and post-P0 roadmap       | [Competitive strategy and roadmap](competitive-strategy-and-roadmap.md)    |
| Understand services, state, storage, and trust boundaries | [Architecture and protocol](architecture.md)                               |
| Integrate with REST or realtime interfaces                | [API and realtime reference](api.md)                                       |
| Configure a gated institution pilot                       | [Institution integration guide](institution-integrations.md)               |

## Build and operate

- [Implementation status](implementation-status.md) describes what is implemented and what remains a release gate.
- [Release readiness ledger](release-readiness.json) is the machine-validated source of truth for
  Canadian beta and GA promotion gates; [evidence templates](evidence/README.md) cover human and
  provider verification.
- [Production readiness](runbooks/production-readiness.md) is the promotion checklist for a public environment.
- [Build, service, and deployment](runbooks/deployment.md) is the command reference for product
  images, local service lifecycle, and digest-pinned Fly.io promotion.
- [Canadian staging readiness](runbooks/staging-readiness.md),
  [repository governance](runbooks/repository-governance.md),
  [backup and restore](runbooks/backup-restore.md), [upgrade](runbooks/upgrade.md),
  [audience interaction moderation](runbooks/audience-moderation.md),
  [incident response](runbooks/incident-response.md), and
  [observability](runbooks/observability.md) cover release and routine operations.
- [Free-pilot Cloud Run guidance](../infra/cloudrun/README.md) and the
  [Canadian Fly profile](../infra/fly/README.md) document provider boundaries and the one-shot
  migration workflow.
- [Privacy data map](privacy-data-map.md) identifies stored data, purpose, and retention behavior.
- [Institution integrations](institution-integrations.md) documents creator OIDC, instructor LTI,
  audit export, residency evidence, and the capabilities that remain deliberately disabled.
- [Asset register](asset-register.md) records the origin and licensing of bundled product assets.
- [Creator authentication ADR](decisions/001-creator-authentication.md) records the deliberate P0
  choice and migration triggers.

## Release boundary

The Compose stack is for local development and evaluation only. Hosted staging and production
promotion uses the Fly.io deployment path, digest-pinned images, separate runtime and migration
credentials, and the applicable readiness evidence. The repository and deployment scripts do not
by themselves establish that an environment has been provisioned or deployed, nor do they
establish legal approval, an availability commitment, school-contract readiness, external
security assurance, or production capacity evidence.

The signed-in `/help` page is available in the default Compose profile and adapts its written
steps and destinations to the active rollout. Its two captioned professional-builder videos are
shown only when the workspace shell, Round Builder v2, Presentations, Groups, Discover, and
practice assignments are all enabled for that allowlisted workspace.
