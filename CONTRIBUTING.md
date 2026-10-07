# Contributing

Polling Pops accepts contributions that preserve its clean-room product boundary, accessibility target, and server-authoritative correctness guarantees.

1. Create a focused branch and add tests for behavioural changes.
2. Run `pnpm check` before opening a pull request.
3. Version contracts independently. Keep compatible changes additive; breaking event, API, or stored-content changes require a new contract version and compatibility/upgrade notes. Presentation content uses version 2 and Round reports accept versions 1–4; the `/v1` route prefix is not their schema version. Preserve deterministic read upcasters and immutable published records.
4. Never contribute copied quiz content, logos, sounds, screenshots, source, or expressive assets from another product.
5. Record the source and license of every added asset or dependency.
6. Do not place secrets, personal information, participant names, answer content, or billing payloads in fixtures or logs.

By submitting a contribution, you agree that it is provided under Apache License 2.0.
