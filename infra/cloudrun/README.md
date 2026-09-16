# Free pilot deployment

This profile is for short, low-volume pilots with synthetic or consenting adult data. It has no uptime commitment and may incur charges when free quotas are exceeded. WebSocket connections keep Cloud Run instances active.

1. Create a Supabase project in `ca-central-1`, apply `packages/db/migrations/001_initial.sql`, and create a private `openround-media` bucket.
2. Create a free or low-cost Redis-compatible database. Store only pseudonymous session state and use a one-day TTL.
3. Build and deploy the server image to Cloud Run in `northamerica-northeast2` with request timeout `3600`, minimum instances `0`, maximum instances `1`, and concurrency `500`.
4. Set HTTPS `WEB_ORIGIN` and `PUBLIC_API_URL` values, plus `COMMUNITY_MODE=false`,
   `BILLING_MODE=disabled`, `ALLOW_IN_MEMORY=false`, `RUN_MIGRATIONS=false`,
   `FEATURE_SIGNUPS=false`, and `METRICS_ENABLED=false`.
5. Apply migrations with the server image's one-shot `node dist/migrate.js` command from a
   restricted maintenance environment; never add the owner credential to the Cloud Run service.
6. Deploy the web image with `NEXT_PUBLIC_API_URL` set to the server URL.
7. Configure and verify SMTP before enabling sign-ups. Configure an authenticated private scraper
   before enabling metrics.
8. Limit test sessions to the Free plan: 20 participants, short rounds, and no school production data.

Client reconnection is mandatory because Cloud Run applies a request timeout to WebSocket connections. Move to the Canadian production profile before accepting payment or promising availability.
