# Free pilot deployment

This profile is for short, low-volume pilots with synthetic or consenting adult data. It has no uptime commitment and may incur charges when free quotas are exceeded. WebSocket connections keep Cloud Run instances active.

1. Create a Supabase project in `ca-central-1` and a private `openround-media` bucket. Do not apply
   only `001_initial.sql`; the image's ordered migration runner must apply and record the complete
   checked-in migration set.
2. Create a free or low-cost Redis-compatible database. Store only pseudonymous session state and use a one-day TTL.
3. Build and deploy the server image to Cloud Run in `northamerica-northeast2` with request timeout `3600`, minimum instances `0`, maximum instances `1`, and concurrency `500`.
4. Set HTTPS `WEB_ORIGIN` and `PUBLIC_API_URL` values, plus `COMMUNITY_MODE=false`,
   `BILLING_MODE=disabled`, `ALLOW_IN_MEMORY=false`, `RUN_MIGRATIONS=false`,
   `FEATURE_SIGNUPS=false`, `FEATURE_ROUND_EXPERIENCES=false`,
   `FEATURE_AUDIENCE_PULSE=false`, `FEATURE_ROOM_CHAT=false`, and `METRICS_ENABLED=false`.
5. Apply migrations with the server image's one-shot `node dist/migrate.js` command from a
   restricted maintenance environment. This command applies every pending ordered migration and
   verifies the recorded checksums; never add the owner credential to the Cloud Run service.
6. Deploy the web image with `NEXT_PUBLIC_API_URL` set to the server URL.
7. Configure and verify SMTP before enabling sign-ups. Configure an authenticated private scraper
   before enabling metrics.
8. Limit test sessions to the Free plan: 20 participants, short rounds, and no school production data.
9. Keep chat disabled unless the pilot explicitly tests moderation. Cloud Run timeout/reconnect also
   applies to the separately sequenced audience stream; monitor durable outbox lag and require
   audience resynchronization after every socket reconnect. Do not treat the free pilot as
   evidence for the 250-participant mixed answer/chat/Pulse production gate.

Client reconnection is mandatory because Cloud Run applies a request timeout to WebSocket connections. Move to the Canadian production profile before accepting payment or promising availability.
