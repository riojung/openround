# Upgrade and rollback runbook

1. Read release notes and verify the image digest, signature, SBOM, and vulnerability report.
2. Back up PostgreSQL and confirm a recent restore exercise.
3. Apply expand-only schema changes with the owner-only `DATABASE_MIGRATION_URL`. Keep the
   application `DATABASE_URL` on a non-owner role granted `openround_runtime`, and verify forced
   row-level security with the production-like integration test. New code must tolerate both old
   and new columns during the deployment window. The published server image exposes the one-shot
   `node dist/migrate.js` command; run it from a restricted maintenance job and never place
   `DATABASE_MIGRATION_URL` in the long-lived server environment.
4. Deploy to staging and run the synthetic creator, host, three-player, reconnect, finish, report, and deletion flow.
5. Promote one canary, check error rate, event-loop lag, acknowledgement latency, reconnects, database pool, Redis latency, and reconciliation.
   Keep `FEATURE_RECOVERY_PACK_LIVE_CARDS=false` while any v5 server or worker can receive traffic;
   authoring-only and ordinary rooms remain v5-readable during this mixed-version window.
6. Promote production only when thresholds remain normal.
7. Roll back by deploying the prior immutable image. Do not reverse a destructive database migration; use the documented forward repair.
8. Contract or remove old schema only in a later release after every running version has stopped using it.

## Recent content, report, and deletion upgrades

The current feature code includes migrations through
`052_recovery_pack_live_cards.sql`. Apply the complete ordered migration set with the restricted
one-shot migration job before starting the new server; do not grant the runtime role ownership or
direct mutation privileges on published Presentation versions.

| Change                                 | Data and compatibility behavior                                                                                                                                                                                                                                                                                    | Rollout/rollback requirement                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Question Health                        | Migration 045 stores content-addressed dismissals; 046 stores bounded approved field diffs and apply/undo provenance. Read-only post-use analysis derives from retained exact-version reports.                                                                                                                     | Leave `FEATURE_QUESTION_HEALTH` off outside the evidence allowlist. Rehearse stale revision, apply/undo, export, and source-deletion cleanup. Published content must remain unchanged.                                                                                                                                                                                                                  |
| Session Decision Replay                | Migration 047 adds the immutable creation-time `decision_replay_enabled` setting, defaulting existing sessions to false. Eligible new Round sessions capture bounded aggregate events in the existing journal and produce Report V4; V1–V3 remain readable.                                                        | Deploy replay-capable server, worker, and web images before enabling `FEATURE_DECISION_REPLAY`. Disabling the flag prevents new capture-enabled rooms but preserves capture in existing rooms. Choose a replay/Report V4-capable rollback target once such rooms/reports exist; older writers cannot preserve complete capture and older readers may reject V4. Never backfill a timeline from answers. |
| Presentation content v2                | Drafts, history, published content, and browser recovery are upcast on read from v1 title/body into stable text elements, preserving media, notes, citations, and style. Optional percentage frames extend v2. No database rewrite is required for this content change.                                            | Deploy the matching web/server pair within the existing Presentation beta gate. After v2 or custom-frame writes, use a v2/geometry-capable rollback target: an older editor can reject v2 or discard custom geometry on save. Do not rewrite immutable published versions as a rollback.                                                                                                                |
| Archived artifact and session deletion | Migration 048 protects retained practice with `ON DELETE NO ACTION` and adds parent-scoped locking/cleanup for favorites and Group links. Owner artifact deletion requires archived status and no retained session/assignment dependencies. Presentation session deletion requires finished status or live expiry. | Verify runtime-role behavior, restore/dependent-write races, all-user favorite cleanup, and terminal-session/report-worker/socket cleanup on a production-like copy. Keep the stronger foreign key and cleanup triggers during a code rollback. Deletion is not reversible by deploying an older image.                                                                                                 |

### Recovery Pack update compatibility

Migration 049 adds the gated Pack foundation. Migration 050 expands Round media-reference
discovery to both the original insertion and accepted update baseline; migration 051 adds nullable
Pack-update undo-source metadata to existing Round mutation receipts. Apply these forward-only
migrations before enabling Pack updates. Existing forced RLS, immutable versions, tenant checks,
and retention/export/delete behavior remain in force; no new public capacity promise is made.

Before enabling `FEATURE_RECOVERY_PACKS` for a workspace, rehearse an unchanged-copy update, a
local/source conflict, a deleted copy, apply/undo, acknowledgement loss, concurrent draft edits,
and media present only in an updated delayed probe. Confirm that published Rounds and the original
insertion remain unchanged, source Pack deletion leaves copies readable, and a disabled flag
blocks new applies without blocking reads or fenced undo.

Updated Round exports declare native JSON version 4; this server still accepts versions 1–3.
After `updateBaseline` writes, choose an update-aware web/server rollback target. An older editor
can discard the accepted baseline when it saves, and an older media extractor may omit probe-only
assets. Disabling the flag does not make such an older image a safe writer. Keep both expanded
migrations during rollback and never rewrite published snapshots to downgrade their format.

### Recovery Pack Presentation insertion and update compatibility

Apply migration `053_recovery_pack_presentation_media.sql` before enabling Presentation Pack
insertion. It expands the existing media extractor and backfills draft, history, and published
references for both original and accepted baselines, including probe-only assets; it adds no table
or learner data. Keep the migration during a code rollback.

Apply `054_recovery_pack_presentation_undo.sql` before deploying Presentation Pack updates. It adds
nullable source-revision metadata and an index/check constraint to existing mutation receipts.
The current accepted update protects its preceding snapshot from normal history pruning; a later
meaningful draft edit releases this exception. Existing forced RLS, export/delete coverage, and
parent cascades still apply. No new content schema version is introduced by updates.

Ordinary and legacy Presentation documents remain schema v2, including existing question-level
Pack provenance copied from Rounds. Complete frozen Pack baselines explicitly write schema v3,
while the draft mutation request envelope remains v2. Deploy v3-aware web, server,
and worker readers before enabling insertion through both `FEATURE_PRESENTATIONS` and
`FEATURE_RECOVERY_PACKS` and their respective workspace allowlists. After any v3 writes, use only a
v3-aware rollback target: disabling a flag blocks new insertion but cannot make a v2-only reader or
editor safe. Never rewrite immutable published versions to downgrade them.

Rehearse dirty-draft insertion, lost acknowledgement and exact-mutation retry, concurrent draft
edits, deletion of local copies, source Pack deletion, disabled-feature reference reads, and media
held only by a frozen delayed probe. Verify normal autosave, history, publication, account export,
deletion, and pre-reveal role/media projections. This increment copies only the diagnostic/recheck
as live blocks; frozen intervention cards and the optional delayed probe remain authoring references.
Pause each flag/allowlist after an accepted insertion loses its acknowledgement: its exact mutation
must still replay without a new revision, while a fresh insertion remains blocked.
Also rehearse three-way update choices, context-only acceptance, deleted-checkpoint restoration,
an exact reviewed version after another Pack publish, revision-fenced undo, an aged undo source,
and media held only by an accepted delayed probe. Confirm unchanged block IDs/metadata and slide
order, immutable published versions, and private live projections. Pausing either flag blocks new
updates but preserves comparisons, already accepted receipt recovery, and fenced history restore.
Live Presentation card playback remains a separate increment.

### Live Recovery Pack card compatibility

Migration 052 adds nullable aggregate Pack/card attribution to existing session interventions;
the session's forced workspace RLS and retention/deletion cascade still apply. Apply it before
starting the new server. It does not link evidence to a mutable source Pack or add learner identity.

Ordinary rooms and all v1–v5 legacy rooms retain game state v5 with live playback disabled through
commands, caching, and restart. Only new live-card-eligible rooms write v6. Eligibility requires
both `FEATURE_RECOVERY_PACKS=true` and the separate default-off
`FEATURE_RECOVERY_PACK_LIVE_CARDS=true`, plus the evidence workspace allowlist. Authoring alone
does not activate v6 writers. Snapshots report the room's actual schema version.

Keep the live-card switch off throughout the canary. Drain and replace every v5 server and worker,
then verify the serving image set before enabling it. Once enabled rooms or their reference-bearing
decision evidence exist, use only a v6-capable, live-card-aware server/worker rollback target: old
writers cannot preserve card projections and attribution. Disabling either flag prevents eligibility
in new rooms without interrupting enabled active rooms or hiding copied content/reports; it does
not downgrade existing v6 state. Cards resolve only from the room's immutable published Round
snapshot (accepted update baseline when present), never from a latest source lookup. Text/citation
cards are post-reveal only in this slice.

Keep migration 052 during rollback. Rehearse authoring-only v5 creation, commands, and cold restart
before enablement, then duplicate/stale commands,
participant/presenter projection safety, empty-cache restart during a selected card, finish and
linked recheck, source Pack deletion, and both Report V3/V4 attribution with CSV export.

Before promotion, use synthetic records to verify legacy draft/history/published reads; move and
resize slide text, save, undo/redo, publish, and compare preview with both live roles; verify narrow
reading order and image reservation. For a capture-enabled Round, finish/reconcile a Report V4 and
confirm explicit incomplete capture at the bound without identity leakage. Delete finished/expired
sessions, then archive and delete unreferenced content; confirm active/restored source and retained
assignment guards, inaccessible reports/credentials, and released room codes. Retain the serving
image set, flags, migration result, compatible rollback target, and human acceptance with the release
evidence. See [deletion and restored data](backup-restore.md#deletion-and-restored-data) before using
a pre-deletion backup.

Whole-room flex still needs a flex-capable rollback target after creation is enabled; follow the
[deployment rollback policy](deployment.md#failure-and-rollback-policy). These compatibility checks
do not replace the external security, accessibility, capacity, or restore gates.

## Presentation concurrent-response rollout

`PRESENTATION_CONCURRENT_RESPONSE_WRITES` defaults to `false`. Leave it off while a prior server
image can still receive traffic: the compatibility trigger then advances the stored session fence
that image reads. After the expand release is the only serving version, verify reconnect and report
reconciliation, then enable the switch to use the commit-visible per-session aggregate fence and
remove response-row contention.

Migration 040 stops rather than creating a second sequence domain when an unexpired legacy session
has an imported timeline sequence above its aggregate fence. Finished sessions remain reconnectable
until live expiry, so they are included in the guard. If it fires, leave the old image serving,
expire the identified sessions through the normal lifecycle, and rerun the migration. Do not bypass
the guard or enable concurrent response writes to force rollout.

Before starting a prior-image rollback, disable the switch on every current instance and wait for
them to restart. Then, from the owner-only migration connection, reconcile the stored compatibility
counter while briefly fencing joins and responses:

```sql
BEGIN;
LOCK TABLE presentation_live_sessions IN EXCLUSIVE MODE;
SELECT set_config('app.system_access', 'on', true);
UPDATE presentation_live_sessions AS session
SET event_seq = GREATEST(
  session.event_seq,
  session.event_seq_offset
    + session.revision
    + (SELECT count(*) FROM presentation_live_participants AS participant
       WHERE participant.session_id = session.id)
    + (SELECT count(*) FROM presentation_live_responses AS response
       WHERE response.session_id = session.id)
);
COMMIT;
```

Only after that transaction succeeds may the prior image start serving. The trigger remains
installed, so its subsequent writes continue advancing the stored fence.

Do not enable the switch merely because the migration completed. Record the serving image set,
configuration change, rollback rehearsal, and 50/250-client results as one release evidence set.
