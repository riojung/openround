# Physical-device and network execution

This runbook turns the physical-device evidence matrix into a repeatable acceptance exercise. It
does not permit browser emulation to stand in for real hardware or a local Compose stack to stand
in for the reviewed single-VM staging candidate.

## Freeze the candidate

1. Record the full Git commit, immutable server/web image digests, deployment configuration
   checksum, final application/media origins, and UTC cutoff.
2. Freeze the supported hardware, OS, browser, and network matrix before testing. Record exact
   versions; “current” and “previous” are only recruitment labels, not evidence.
3. Name a test owner and an independent reviewer. Create stable run IDs and a private evidence
   index that contains no room code, cookie, participant alias, or response content.
4. Create one reviewed Round and one reviewed Presentation containing a scorable block, reveal,
   intervention, and linked recheck. Include a content slide with a moved/resized title, multiple
   text boxes, and an image. Record enabled flex, Question Health, and Decision Replay flags when
   they are in the candidate. Keep the content and settings identical across devices.

## Execute each device row

For each real device/network combination:

1. Scan the final-hostname QR code, verify HTTPS and the expected destination, and join with a
   synthetic alias.
2. Open the current question/block, submit once, and wait for the authoritative `Saved`
   acknowledgement. Record acknowledgement and client-receipt timing without recording the answer.
3. Remove connectivity after submit and before the next block, restore it, and verify sequence and
   revision recovery. Repeat once with connectivity removed before acknowledgement; the client
   must not claim success until the server acknowledges it.
4. Complete reveal, intervention, and linked recheck. Verify keyboard/touch operation and screen
   reader status where that device is also in the accessibility scope.
5. Finish the session. Reconcile joined, currently connected, disconnected, accepted-response, and
   ready-report counts. Confirm retries did not create duplicate accepted answers.
6. Repeat the steps for the other artifact type. Record captive-portal, firewall, proxy, VPN,
   WebSocket, QR-permission, and fallback observations.
7. Compare the customized content slide in authoring preview, facilitator, and participant views.
   Check touch/keyboard and inspector placement controls on supported authoring devices, image
   clearance, legible overflow, and narrow top-to-bottom/left-to-right reading order. Reopen the
   saved slide and confirm its geometry persists.
8. For enabled replay/flex candidates, verify host-closed flex responses and the ready report's
   captured decision timeline without inventing earlier history. Delete a synthetic finished or
   expired session, then archive/delete its unreferenced source through the owner UI. Check
   confirmation focus/status and stale browser/back-navigation behavior; old credentials must fail.

## Thirty-device lobby

Use at least the frozen matrix's representative device/network mix. Join all thirty devices to one
reviewed room, keep them connected for ten minutes, submit from every selected responder, exercise
at least five disconnect/reconnects, and finish the session. Acceptance requires:

- 30/30 successful joins with host aggregate counts matching the observed roster;
- every device receiving the current block without private projection leakage;
- every submitted response receiving one authoritative acknowledgement;
- zero lost or duplicate accepted answers after reconnect; and
- a ready report whose accepted-answer counts reconcile exactly.

Record timestamps, counts, device mix, issue references, and redacted artifact hashes. Do not
commit raw aliases, answers, cookies, room codes, private URLs, or screenshots containing customer
content.

## Review and cleanup

Resolve every severity-1/2, data-loss, leakage, reconciliation, and material accessibility defect,
then rerun its affected row and the thirty-device lobby when shared behavior changed. Revoke test
credentials, delete synthetic data according to retention policy, and have both the test owner and
independent reviewer accept the completed record before updating the readiness ledger.
