# Legacy Fly deployment reference

The Fly TOML files are retained only as historical architecture and migration reference. Fly.io is
not an active OpenRound deployment target, and these files are not maintained as a runnable
staging or production profile. They do not prove that any Fly application, managed data service,
domain, or regional environment exists.

The active hosted strategy is remote single-VM Docker Compose. Start with
[`compose.single-vm.yaml`](../../compose.single-vm.yaml), the checked-in single-VM infrastructure
files, and the [deployment runbook](../../docs/runbooks/deployment.md). The active topology requires
digest-pinned application images, strict SSH host-key verification, TLS for the application and
media origins, isolated runtime and migration credentials, encrypted off-host backups, and a timed
restore onto a clean replacement VM.

Do not infer high availability or an SLA from either profile. The single-VM topology has one
failure domain and remains blocked for public production until capacity, security, backup/restore,
monitoring, legal, accessibility, and operational readiness gates have evidence.
