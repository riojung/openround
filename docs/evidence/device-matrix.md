# Physical-device and network matrix

- Date/time (UTC):
- Protocol/version:
- Build commit and image digest:
- Single-VM staging URL (redacted if private):
- Test owner:
- Independent reviewer:
- Frozen supported-device/browser policy reference:
- Run ID and evidence index/checksum:

Use real devices and the final QR hostname; browser emulation does not satisfy a row. Freeze exact
hardware model, OS build, browser version, network/carrier or managed-network profile, and UTC run
time before execution. Each row must cover both a Round and a Presentation: scan/open, nickname
join, acknowledged answer, temporary network loss, resume without duplicate acceptance, reveal,
and final result. A desktop facilitator must verify roster and ready-report reconciliation against
the accepted-answer count.

| Run ID | Hardware/OS build   | Browser/version | Network/carrier profile    | Round result | Presentation result | Reconnect/deduplication | Report reconciliation | Evidence/issue |
| ------ | ------------------- | --------------- | -------------------------- | ------------ | ------------------- | ----------------------- | --------------------- | -------------- |
|        | Current iPhone/iOS  | Safari          | Wi-Fi                      | Pending      | Pending             | Pending                 | Pending               |                |
|        | Previous iPhone/iOS | Safari          | Cellular                   | Pending      | Pending             | Pending                 | Pending               |                |
|        | Current Android     | Chrome          | Wi-Fi                      | Pending      | Pending             | Pending                 | Pending               |                |
|        | Previous Android    | Chrome          | Cellular                   | Pending      | Pending             | Pending                 | Pending               |                |
|        | Windows laptop      | Chrome and Edge | Managed Wi-Fi              | Pending      | Pending             | Pending                 | Pending               |                |
|        | macOS laptop        | Safari/Chrome   | Managed Wi-Fi              | Pending      | Pending             | Pending                 | Pending               |                |
|        | Chromebook          | Chrome          | School-like filtered Wi-Fi | Pending      | Pending             | Pending                 | Pending               |                |

- Thirty-device concurrent lobby run ID, device mix, joined/currently-connected/disconnected counts, and duration:
- Thirty-device acceptance: all devices join the same reviewed room, host counts reconcile, every
  selected responder receives the current block and authoritative acknowledgement, reconnects do
  not duplicate an answer, and the ready report reconciles accepted answers with zero unexplained
  participant or response loss.
- Camera/QR permission observations:
- Firewall, captive portal, proxy, VPN, or WebSocket restrictions and fallback behavior:
- Accepted answers/reconciled answers by run:
- Open blockers and issue URLs:
- Test owner decision (accepted/rejected/pending): Pending
- Independent reviewer decision (accepted/rejected/pending): Pending

Every required row and the thirty-device lobby must pass for the gate to be accepted. Any omitted
row requires a reviewed support-policy change before the campaign begins; it cannot be waived
after seeing the result. Follow the [physical-device execution runbook](../runbooks/device-matrix.md).
