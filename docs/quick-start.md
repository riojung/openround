# OpenRound quick start

This guide starts the complete community stack and walks through one quiz round. The normal path takes about ten minutes after container images are available.

## What you need

- Docker Desktop or Docker Engine with Docker Compose v2
- At least 2 GB of memory for the core profile; allow at least 4 GB for ClamAV image scanning
- Local ports `8080`, `8025`, and `9000` available
- A modern browser; use a second browser or private window to simulate a participant

Run all commands from the repository root, the directory containing `compose.yaml`.

## 1. Start the core stack

The core profile includes the product, API/realtime server, PostgreSQL, Valkey, private MinIO storage, Mailpit, and Caddy. Untrusted image uploads are disabled because this profile has no malware scanner.

```bash
docker compose up --build -d
docker compose ps
```

Wait until `server`, `web`, `postgres`, `valkey`, and `minio` are healthy. Confirm the public readiness endpoint:

```bash
curl -fsS http://localhost:8080/health/ready
```

Open:

- Product: <http://localhost:8080>
- Captured development email: <http://localhost:8025>

## 2. Sign in as a creator

1. Select **Create a free quiz**.
2. Choose **Workplace learning** or **Education**. This sets the session defaults described in the [user guide](user-guide.md#segment-defaults).
3. Enter any valid development email address.
4. Accept the draft Terms and Privacy notice, then select **Send sign-in link**.
5. Open Mailpit at <http://localhost:8025>, select the new OpenRound message, and open its sign-in
   link.

Mailpit keeps local messages inside the development stack; it does not send external email. The
Compose profile does not return sign-in bearer tokens in API responses by default.

For isolated, one-computer testing only, you can expose **Continue to dashboard** while also binding
the product to loopback so another LAN client cannot request a token for an existing creator:

```bash
OPENROUND_HTTP_BIND=127.0.0.1 AUTH_DEBUG_MAGIC_LINKS=true docker compose up --build -d
```

Do not use this shortcut while the product is reachable by other devices. Return to the secure
default by running the normal `docker compose up -d` command again.

## 3. Create and publish a quiz

1. On **Your quizzes**, enter a title and select **Create quiz**.
2. Add at least one **Multiple choice** or **True or false** question.
3. Enter the question, complete every answer label, and select exactly one correct answer.
4. Set the timer, points, and optional explanation.
5. Wait for the header to show **Saved**, select **Preview**, and step through the participant view.
6. Return to the editor, select **Publish**, then return to **Dashboard**.

Publishing creates an immutable version for future sessions. You can keep editing the draft afterward; a running session continues to use the version it started with.

## 4. Host and join a round

1. On the published quiz card, select **Host**.
2. Review the audience, late-join, scoring, result, and nickname settings, then select **Create live
   session**.
3. Leave the host tab open. It contains the session-scoped host credential.
4. In another browser or private window, open <http://localhost:8080/join>.
5. Enter the seven-digit code shown by the host. Enter a nickname when custom nicknames are enabled; education sessions assign a friendly alias.
6. Confirm the participant appears in the host lobby, then select **Start round**.
7. Answer on the participant device. The participant should see **Answer received and saved** before reveal.
8. As host, use **Lock answers**, **Reveal answer**, and **Next question**. **Pause**, **Resume**, **Show standings**, and **End session** appear when they are valid for the current phase.
9. Finish the last question and select **Open report**.

The report shows participation, accuracy, difficult questions, participant outcomes, and a UTF-8 CSV download.

## Join from phones, tablets, and other computers

One seven-digit code identifies one live session; it is intentionally shared by every participant in that room. Up to the configured session limit can join the same code from separate devices.

`localhost` always means “this device,” so a QR containing `localhost` cannot work on a phone. For devices on the same trusted Wi-Fi or LAN:

1. Find the host computer's IPv4 address. Developers with Node.js installed can run `pnpm network:urls`; otherwise use the operating system's network settings, `ipconfig` on Windows, or `ipconfig getifaddr en0` on macOS.
2. Confirm another device can open `http://HOST_ADDRESS:8080`, for example `http://192.168.1.20:8080`.
3. Keep the facilitator on `localhost`, then expand **Change join address** in the host's **Scan to join** panel and enter the reachable network address.
4. The host and presenter screens now show a QR and copyable link with the code prefilled. Scan it from each participant device.

OpenRound uses same-origin API and realtime routes in the Compose profile, so participants need only reach port `8080`. If access fails, allow Docker/Caddy through the host firewall and check that the Wi-Fi does not use client isolation. A LAN address works only on that network; internet-wide access requires a deployed HTTPS domain.

To make the LAN address canonical for sign-in links, redirects, and QR codes, start or rebuild the stack with it:

```bash
OPENROUND_PUBLIC_URL=http://192.168.1.20:8080 docker compose up --build -d
```

Then open the facilitator interface at that same address. Replace the example address with the host's address.

To use scanned question images across LAN devices, also expose MinIO deliberately and give signed URLs a reachable address:

```bash
OPENROUND_PUBLIC_URL=http://192.168.1.20:8080 \
OPENROUND_STORAGE_URL=http://192.168.1.20:9000 \
OPENROUND_STORAGE_BIND=0.0.0.0 \
docker compose -f compose.yaml -f compose.media.yaml up --build -d
```

Replace `192.168.1.20` with the host address. This exposes the product and signed-object endpoint to the local network; use it only on a trusted network. A public deployment must use HTTPS, a real SMTP provider, private production storage, rotated secrets, and the production readiness gates.

## Enable question images

Use the media overlay to add ClamAV quarantine and scanning. The first start may take several minutes while ClamAV initializes its signature database.

```bash
docker compose -f compose.yaml -f compose.media.yaml up --build -d
docker compose -f compose.yaml -f compose.media.yaml ps
```

After the scanner is healthy, the quiz editor accepts JPEG, PNG, and WebP images up to 10 MB. Enter meaningful instructional alt text before selecting a file. Files are private and unavailable until they pass validation and malware scanning.

## Day-to-day commands

The examples below use the core profile. If you enabled images, repeat the same `-f compose.yaml -f compose.media.yaml` arguments for lifecycle commands so Compose also manages the ClamAV service and volume.

Follow service logs:

```bash
docker compose logs -f server web caddy
```

Stop the stack while preserving data:

```bash
docker compose down
```

Start it again with the same data:

```bash
docker compose up -d
```

Delete all local OpenRound database, cache, and object-storage volumes:

```bash
docker compose down --volumes
```

The last command is destructive and cannot be undone unless you have a backup.

## Optional native developer mode

For a fast code-editing loop without PostgreSQL, Valkey, SMTP, or object storage, use the in-memory development mode. It is intentionally non-durable: all data disappears when the server stops, and media uploads are disabled.

Requirements are Node.js 22 or newer and Corepack/pnpm.

```bash
corepack enable
pnpm install
env \
  NODE_ENV=development \
  ALLOW_IN_MEMORY=true \
  COMMUNITY_MODE=true \
  WEB_ORIGIN=http://localhost:3000 \
  PUBLIC_API_URL=http://localhost:4000 \
  NEXT_PUBLIC_API_URL=http://localhost:4000 \
  FEATURE_MEDIA_UPLOADS=false \
  RUN_MIGRATIONS=false \
  pnpm exec turbo run dev --env-mode=loose
```

Open <http://localhost:3000>. In development mode, the sign-in page displays **Continue to dashboard** after accepting the policies and requesting a link.

`--env-mode=loose` is required here so Turborepo passes the explicitly listed shell variables to the web and server development tasks.

The `.env.example` values target services by their Compose network names and are intended for the containerized profile. Do not copy that file unchanged for a host-native server process.

For an operational pause without restarting containers, use the `ADMIN_TOKEN`-protected
`GET|PATCH /v1/admin/features` API described in the
[observability runbook](runbooks/observability.md#kill-switches). Startup `FEATURE_*` settings stay
as hard ceilings, so a runtime update cannot enable a capability disabled by deployment
configuration.

For a local operations dashboard and alert-rule evaluation, add `compose.observability.yaml` and
the `observability` profile, then run `pnpm smoke:observability`. Prometheus binds to loopback port
9090 and Grafana to loopback port 3001; setup and production caveats are in the
[observability runbook](runbooks/observability.md#bundled-dashboard-and-rules).

## Troubleshooting startup

| Symptom                                          | Check                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Product does not open                            | Run `docker compose ps` and wait for health checks; then inspect `docker compose logs server web caddy`.                          |
| Port is already allocated                        | Stop the process using `8080`, `8025`, or `9000`, or change the corresponding Compose port mapping.                               |
| No sign-in message                               | Open Mailpit, verify the `mailpit` service is running, and request a fresh link. Links are single-use.                            |
| No local **Continue to dashboard** link          | This unsafe shortcut is off by default. Use Mailpit, or enable it only with the loopback-only command above.                      |
| Image control is disabled                        | Start with `compose.media.yaml` and wait for `clamav` to become healthy.                                                          |
| Host or participant cannot resume in another tab | Credentials are stored in that tab's session storage. Return to the original tab; if needed, create or join a new session.        |
| Browser shows **Reconnecting…**                  | Keep the page open and inspect server/Caddy logs. The client automatically requests an authoritative snapshot after reconnecting. |

## Before public or production use

The included passwords, admin token, HTTP origin, Mailpit service, and policy text are development defaults. Do not expose this stack to a network unchanged. Keep `AUTH_DEBUG_MAGIC_LINKS=false` and complete the [production readiness checklist](runbooks/production-readiness.md), [security guidance](../SECURITY.md), backup/restore rehearsal, provider-specific load tests, legal review, and secret rotation before handling real users or school data.

Continue with the [user guide](user-guide.md) for complete workflows or the [architecture document](architecture.md) for implementation details.
