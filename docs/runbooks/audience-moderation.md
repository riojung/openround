# Audience interaction moderation runbook

Use this runbook for Audience Pulse, room chat, and Q&A. It is an operational aid, not a substitute
for an approved acceptable-use policy, safeguarding procedure, employment policy, or legal advice.

## Before the round

For the scoped Presentation backend preview, apply migration 060 first and use a native host
credential. Companion remains read-only; the Presentation Q&A UI/replies are not shipped yet.
The [API reference](../api.md#presentation-qa-commands-backend-preview) documents the current transport.
Refresh before host changes and send the current audience sequence as the revision fence.
Retry lost acknowledgements with the original key/payload; after a conflict review current state
and use a new key for the revised command. Removal is terminal; ordinary views/account exports
blank the removed body. `banAuthor` stops new questions/votes from that room credential without
exposing its identity. All scoped Q&A records follow parent retention/deletion. Notices contain no
body; clients must sync current visible state and discard removed cached content.

1. Name the host and at least one cohost for a large or sensitive session. Give presenters only a
   read-only presenter credential.
2. Leave chat disabled unless conversation serves the session. Choose public or private aliases,
   a 5/15/30-second slow mode when risk is elevated, and `pinned` presenter feed unless a live feed
   has an explicit purpose.
3. Explain the visible privacy boundary: facilitators see a guest’s session alias and Pulse signal;
   the room receives aggregates only after five unique signalers. Private chat aliases remain
   moderator-visible.
4. State the conduct rule, reporting path, and consequence ladder. Confirm who handles a safety or
   privacy escalation outside the product.
5. Test mute, ban, kick, pin, remove, transcript access, and audience resynchronization in staging.

## During the round

- Use **mute** for a temporary cooling-off period. Choose 5, 15, or 60 minutes and tell the person
  what changed when appropriate.
- Use **remove** for a specific message. Removal hides the body from ordinary views; do not quote
  it into logs or a public chat.
- Use **ban audience interaction** when a participant must stop sending signals, chat, or Q&A but
  may remain in the instructional flow. Use **kick** only when the participant must leave the round.
- Switch the presenter feed to `off` during an incident. `pinned` is the normal moderated mode.
- Treat Pulse as context, not a diagnosis. Do not single out a participant publicly or infer
  ability, disability, intent, or performance from a signal.
- If volume spikes, increase slow mode, close chat, keep Pulse/Q&A only if manageable, and assign a
  cohost to the moderation queue.

## Evidence and access

The standard report is aggregate-first. Owners, editors, and viewers with report access can open
the interaction transcript. Only owners/editors using the explicit audit view may retrieve removed
bodies. Every staff settings/moderation action records actor context in the audit trail.

Do not download a transcript merely for convenience. If export is necessary, store it in the
approved regional location, restrict access, preserve the report’s retention deadline, and delete
extra copies after the purpose ends. CSV export is entitlement-controlled and formula-safe, but it
still contains user-generated text.

## Abuse or privacy incident

1. Preserve identifiers and timestamps without copying bodies, aliases, tokens, or participant
   signal mappings into an incident channel.
2. Disable chat or the whole audience interaction surface; set the presenter feed to `off`.
3. Remove visible content, mute/ban the accountless guest, and kick only when needed to protect the
   room.
4. Record the session ID, message/event ID, region, observed impact, and moderator action.
5. Escalate suspected threats, protected-data disclosure, identity leakage, or systematic abuse
   through the [incident response runbook](incident-response.md).
6. Do not extend retention or reveal removed content without the approved incident/privacy process.

## Rehearsal gate

Before enabling chat for a production workspace, demonstrate with two server processes that a
committed message survives process loss, duplicated outbox delivery does not duplicate the UI,
private-at-creation aliases never become public, a reconnect omits removed content, limits work
across processes, session deletion removes all interaction rows, and metrics/logs contain no user
text or aliases.
