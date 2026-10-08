# Polling Pops repository rename

The canonical repository is [riojung/pollingpops](https://github.com/riojung/pollingpops).
New clones and deployment roots use `pollingpops`. Existing content, data volumes, container
images, and signed release records keep their identities; the repository rename is not a data
migration or a new release approval.

## Local clones and project folders

Update every existing clone's remote before running release tooling:

```bash
git remote set-url origin https://github.com/riojung/pollingpops.git
git remote -v
git fetch origin
```

SSH users can use `git@github.com:riojung/pollingpops.git`. GitHub redirects the old repository
and Git URLs, but release tooling requires the canonical remote. Do not recreate
`riojung/openround`: that would remove the redirect. See
[GitHub's repository rename guidance](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).

For a main checkout, stop development servers, builds, and other programs using its directory.
Record `git worktree list --porcelain`, check that the destination does not exist, then rename the
checkout from its parent directory. Reopen editors and update their saved project paths to
`pollingpops`. Repair any linked worktrees with `git worktree repair`, passing their exact existing
paths. For a linked checkout rather than the main checkout, use `git worktree move` instead.
Do not move another chat's checkout just to change its display name.

An active editor/chat may temporarily need an `openround` symlink to the renamed `pollingpops`
checkout. That alias contains no second copy of the repository. Retire the alias only after all
saved project paths and active processes use the new path; remove the symlink itself, never its
target directory. `git worktree list --porcelain` and `git status` must still succeed in every
linked checkout after the move.

Demo capture and rendering now use `artifacts/pollingpops-demo`,
`tests/demo/pollingpops-demo.spec.ts`, `scripts/demo/render-pollingpops-demo.sh`, and
`scripts/demo/write-pollingpops-captions.py`. Move an existing ignored `artifacts/openround-demo`
directory only while no recording/render is active and only when the new destination is absent.
Previously rendered files are historical artifacts; renaming a directory does not regenerate
their narration or captions. Scratch-tool defaults use `/tmp/pollingpops-video-tools` and
`/tmp/pollingpops-voice-tools`; existing tool paths remain selectable with `OPENROUND_FFMPEG` and
`OPENROUND_EDGE_TTS`.

## Existing hosted deployments

New example configurations use `/opt/pollingpops/staging` and `/opt/pollingpops/production`,
with placeholder domains under `pollingpops.example`. Replace these placeholders with reviewed
real targets before use. The checked-in SSH account and Compose project names retain their
existing identities.

An already-provisioned host must keep its actual `singleVm.deployPath`, SSH account, and
`composeProjectName` in its reviewed configuration. Do not apply the new example root to an
existing host without a separate maintenance migration: it would select a different release
tree rather than move the old one. Receipts, symlinks, runtime files, backup jobs, monitoring,
and service commands all depend on that tree. Retain the old root until a reviewed migration
has restored the same data, verified services and rollback, and updated those dependencies.
This repository change does not move remote files or provision a host.

Ephemeral observability credentials and rendered configuration now use `/run/pollingpops`.
These tmpfs files are recreated during container startup, not migrated. Grafana provisioning
filenames and the dashboard filename use `pollingpops`, while stored dashboard/datasource UIDs,
metric names, and queries remain unchanged.

## Container images and signed releases

Keep `imageRepository` at its configured value, currently `ghcr.io/riojung/openround/openround`.
Both release and staging workflows read this setting; a repository rename must not silently
publish a different image family. Existing digest references, attestations, and package access
remain necessary for rollback. Changing registry names needs its own publication/access and
rollback plan.

New GitHub workflow identities use `riojung/pollingpops`. Historical release bindings retain
their original repository, run URLs, asset URLs, hashes, and signer identity. Validation permits
only the exact old/new repository pair, requires each immutable binding to be internally
consistent, and verifies the signer selected from the validated binding. Renamed live GitHub
metadata may resolve a historical binding through the canonical repository. Never rewrite an
old signed binding to make it appear newly signed or broaden trust to other owners/repositories.
Staging and rollback verification retain explicitly scoped legacy workflow identities.
Compatibility does not waive production promotion gates: the operations checkout must still
be the fetched `origin/main` revision, and its difference from the accepted build is restricted
by the existing release policy. An old image/binding passing verification is not, by itself,
authorization to redeploy that build with a newer tooling revision.

## Identifiers retained for compatibility

Do not bulk-rename `@openround/*` packages, `OPENROUND_*` environment variables, database roles,
database/bucket names, Compose project names or volumes, cookies, resume keys, metrics, API
headers, migrations, native JSON/QTI discriminators, or previously published `openround-*`
guide URLs. These are compatibility interfaces, not current public branding. The original
copyright attribution also remains unchanged. See the [brand guide](../brand.md).

## Verification

Run `pnpm check` after changing repository references. The operations, signed-release acceptance,
staging-environment, and release-scan suites cover the canonical repository and legacy rollback
boundaries. Run `pnpm test:alert-routing` with a working Docker context to validate the ephemeral
credential/config paths. Verify the renamed checkout and all linked worktrees separately;
successful local tests do not establish hosted provisioning or production readiness.
