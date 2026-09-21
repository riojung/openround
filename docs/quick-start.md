# OpenRound quick start

This guide starts the complete community stack and walks through one live checkpoint round. The
normal path takes about ten minutes after container images are available.

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

1. Select **Create a free checkpoint set**.
2. Choose **Workplace learning** or **Education**. This sets the session defaults described in the [user guide](user-guide.md#roles-and-screens).
3. Enter any valid development email address.
4. Accept the draft Terms and Privacy notice, then select **Send sign-in link**.
5. Select **Open local email inbox** in the confirmation, choose the newest OpenRound message, and
   open its sign-in link. You can also open Mailpit directly at <http://localhost:8025>.

Mailpit keeps local messages inside the development stack; it does not send external email. The
Compose profile does not return sign-in bearer tokens in API responses by default.

Sign-in cookies belong to the configured `OPENROUND_PUBLIC_URL`. If the browser is using a
different origin—for example, `localhost` while the stack is configured for a LAN IP—the sign-in
page identifies both addresses and links to the configured one. Continue using that configured
address after opening the email link.

Once signed in, `/help` is available in the default classic setup as well as the professional
workspace beta. The page keeps its steps and links aligned with the capabilities enabled for the
current workspace. Captioned professional-builder videos appear only for an allowlisted workspace
when their full workflow is enabled; the default Compose profile shows the supported classic Round
path instead.

For isolated, one-computer testing only, you can expose **Continue to dashboard** while also binding
the product to loopback so another LAN client cannot request a token for an existing creator:

```bash
OPENROUND_PUBLIC_URL=http://localhost:8080 \
OPENROUND_HTTP_BIND=127.0.0.1 \
AUTH_DEBUG_MAGIC_LINKS=true \
docker compose up --build -d
```

Do not use this shortcut while the product is reachable by other devices. Return to the secure
default by running the normal `docker compose up -d` command again.

## 3. Create and publish a Round

1. In the professional workspace, select **Create**, then **Round**, choose a starting method, and
   give the Round a title. In the classic view, enter a title under **Your checkpoint sets** and
   select **Create checkpoint set**.
2. Add a single-select, true/false, multiple-select, numeric, rating, or poll checkpoint.
3. Choose a topic category and one of the six Round Experience presets. The category recommends a
   preset but does not replace an explicit selection. Preview the host, presenter, and phone
   treatment.
4. Enter the prompt and complete the response-specific answer settings.
5. For a diagnostic checkpoint, optionally collect confidence, add a concept key, and create a
   linked recheck.
6. Set the timer, points, optional explanation, and private misconception feedback.
7. Wait for the header to show **Saved**, select **Preview**, and step through the participant view.
8. Return to the editor, select **Publish**, then return to **Library** or, in the classic view,
   **Dashboard**.

Publishing creates an immutable version for future sessions. You can keep editing the draft afterward; a running session continues to use the version it started with.

## 4. Host and join a round

1. On the published Round card, select **Host**.
2. Review the audience, late-join, scoring, result, nickname, and published experience settings.
   Optionally choose a one-session preset override. Presenter sounds remain off unless explicitly
   enabled.
3. Select **Create live session**.
4. Leave the host tab open. It contains the session-scoped host credential.
5. In another browser or private window, open <http://localhost:8080/join>.
6. Enter the seven-digit code shown by the host. Enter a nickname when custom nicknames are enabled; education sessions assign a friendly alias.
7. Confirm the participant appears in the host lobby. In **Audience Pulse**, enable room chat for
   this test; it is off by default. Choose whether participant aliases are public, set slow mode,
   and choose the presenter feed mode.
8. On the participant device, select **I’m unsure** or **Show an example**. Confirm that the host
   sees the alias and signal while the participant view withholds room totals until five unique
   people have signalled. Send a plain-text chat message and try a reaction or one-level reply.
9. Select **Start round**. The lobby signal clears for the new checkpoint context.
10. Answer on the participant device. The participant should see **Answer received and saved** before reveal.
11. As host, use **Lock answers**, inspect the deterministic insight card, record an intervention,
    and select **Reveal answer**.
12. Open the linked recheck or same-checkpoint revote before continuing. **Pause**, **Resume**,
    **Show standings**, and **End session** appear only when valid for the current phase.
13. Finish the last recovery branch and select **Open report**.

The report shows initial evidence, confidence, misconceptions, interventions, linked recovery,
revote improvement, unresolved concepts, participant outcomes, Q&A, aggregate pulse/chat evidence,
and versioned exports. Authorized report users can open the separate interaction transcript.

Each live surface also provides local high-contrast, reduced-motion, and mute controls. These
preferences override the selected preset on that device and do not change the frozen session
experience for anyone else.

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

## Optional: enable source-grounded authoring

The assistant is disabled by default. A community operator may connect an approved
OpenAI-compatible chat-completions endpoint. Review that provider's privacy, retention, residency,
security, cost, and model terms before sending private documents.

Set these values in a local `.env` file (do not commit the API key):

```dotenv
AUTHORING_AI_MODE=openai_compatible
AUTHORING_AI_ENDPOINT=https://provider.example/v1/chat/completions
AUTHORING_AI_API_KEY=replace-with-a-provider-secret
AUTHORING_AI_MODEL=approved-model-name
AUTHORING_AI_PROVIDER_NAME=approved-provider
```

Then rebuild the server:

```bash
docker compose up --build -d server web caddy
```

On the dashboard, expand **Draft checkpoints from a trusted source**. Use pasted text or a PDF,
DOCX, or PPTX file no larger than 6 MB. The result is a cited proposal; select **Create unpublished
review draft**, verify it in the editor, and publish manually. The worker never receives live
participant responses or session data. Leave `AUTHORING_AI_MODE=disabled` to guarantee that no
authoring source is sent to a model.

## Optional: enable institution integration in a test environment

Generic creator OIDC and LTI 1.3 instructor launch/Deep Linking are disabled by default. They
require deployment secrets, an operator-granted workspace policy, and provider/platform
registration; changing environment variables alone does not enable a workspace. Learner LTI,
NRPS/AGS, managed SAML/SCIM, and K–12 remain unavailable.

Follow the [institution integration guide](institution-integrations.md) to configure callback
URLs, generate a tool signing key, grant the policy, register an LMS, test replay/revocation, and
record the external pilot evidence. Do not use the example Compose secrets for a real institution.

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

For a staged interaction rollout, set `FEATURE_ROUND_EXPERIENCES`,
`FEATURE_AUDIENCE_PULSE`, and `FEATURE_ROOM_CHAT` independently. A comma-separated
`THEMED_INTERACTIONS_WORKSPACE_ALLOWLIST` restricts those capabilities to selected workspace UUIDs;
leave it empty for normal Community operation.

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
