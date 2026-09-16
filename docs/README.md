# OpenRound documentation

OpenRound is a pre-release, independently branded live quiz platform for classrooms and workplace learning. Use this index to choose the shortest path for your role.

## Start here

| I want to…                                                | Read                                         |
| --------------------------------------------------------- | -------------------------------------------- |
| Run OpenRound locally and complete a first round          | [Quick start](quick-start.md)                |
| Create, host, join, and review quizzes                    | [User guide](user-guide.md)                  |
| Understand product behavior and interaction choices       | [Product and experience design](design.md)   |
| Understand services, state, storage, and trust boundaries | [Architecture and protocol](architecture.md) |
| Integrate with REST or realtime interfaces                | [API and realtime reference](api.md)         |

## Build and operate

- [Implementation status](implementation-status.md) describes what is implemented and what remains a release gate.
- [Production readiness](runbooks/production-readiness.md) is the promotion checklist for a public environment.
- [Backup and restore](runbooks/backup-restore.md), [upgrade](runbooks/upgrade.md), [incident response](runbooks/incident-response.md), and [observability](runbooks/observability.md) cover routine operations.
- [Free-pilot Cloud Run guidance](../infra/cloudrun/README.md) and the
  [Canadian Fly profile](../infra/fly/README.md) document provider boundaries and the one-shot
  migration workflow.
- [Privacy data map](privacy-data-map.md) identifies stored data, purpose, and retention behavior.
- [Asset register](asset-register.md) records the origin and licensing of bundled product assets.

## Release boundary

The Compose stack is suitable for local evaluation and community-operated deployments after the operator replaces secrets and completes the readiness checklist. The repository does not by itself establish legal approval, an availability commitment, school-contract readiness, external security assurance, or production capacity evidence.
