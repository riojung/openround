# OpenRound user guide

OpenRound helps a facilitator run a complete comprehension-recovery loop:
**ask → diagnose → intervene → recheck → prove**. Participants join as session-scoped guests and
do not need accounts.

For a local first run, complete the [quick start](quick-start.md) first.

## Roles and screens

| Role               | Main job                                                       | Access                                        |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------- |
| Workspace owner    | Manage people, billing, deletion, content, rounds, and reports | Full workspace                                |
| Editor             | Create checkpoint sets, host rounds, and use reports           | No membership, billing, or workspace deletion |
| Viewer             | Review content and reports                                     | Read only                                     |
| Session cohost     | Help control one assigned live round                           | Revocable round-scoped credential             |
| Presenter          | Show a clean room-facing display                               | Separate read-only credential                 |
| Participant        | Join, answer, ask questions, and resume on one device          | Accountless, round-scoped credential          |
| Community operator | Deploy, secure, back up, and support the service               | Deployment and runbooks                       |

Education onboarding defaults to accuracy scoring, private results, generated aliases, calmer
motion, Q&A premoderation, and participant replies off. Workplace onboarding defaults to speed
scoring, a leaderboard, entered aliases, Q&A postmoderation, and participant replies on. A
facilitator can change round settings before creating a room.

## Sign in and workspace access

1. Select **Create a free checkpoint set** or open `/signin`.
2. Choose education or workplace learning.
3. Enter an email address, accept the displayed policies, and request a sign-in link.
4. Follow the single-use link. Local Compose captures it in Mailpit at
   <http://localhost:8025>.

Use **My checkpoint sets** to return to the dashboard and **Sign out** to revoke the current
browser session. Owners can invite editors or viewers from **Account**. An invitation is
single-use and expiring. A person who belongs to multiple workspaces can switch the active
workspace there.

## Create and organize checkpoint sets

From **Your checkpoint sets**, enter a title and select **Create checkpoint set**. Draft changes
autosave after a short pause. Wait for **Saved** before leaving the editor.

The editor supports:

- Single select and true/false
- Multiple select with exact-set scoring
- Numeric responses with decimal normalization, absolute tolerance, and an optional unit
- Unscored ratings and polls

For a diagnostic or practice checkpoint, choose whether confidence is off, optional, or required.
Confidence uses **Not sure**, **Somewhat sure**, and **Very sure**. Add concept keys to connect
evidence across a main checkpoint and its linked recheck. For wrong choices, optional private
misconception keys and participant feedback turn the distribution into a more useful diagnosis.
Ratings and polls are always opinion checkpoints, unscored, and confidence-free.

Use **Add linked recheck** to create a differently worded check for the same concept. Rechecks are
unscored by default. A main checkpoint may link to one recheck; a recheck cannot link onward.

Optional images are private. When an operator enables malware scanning, provide meaningful alt
text, select a JPEG, PNG, or WebP file up to 10 MB, and wait for upload and safety checking to
finish.

Select **Preview** to inspect the participant experience, then **Publish**. Publishing creates an
immutable version. Editing afterward changes only the draft until it is published again; an
active round always retains the version it started with.

### Source-grounded authoring assistant

When an operator configures an approved provider, expand **Draft checkpoints from a trusted
source** on the dashboard.

1. Paste at least 50 characters or choose a private PDF, DOCX, or PPTX file up to 6 MB.
2. Select **Create review proposal**. Arbitrary URL ingestion is intentionally unavailable.
3. Wait while an isolated worker extracts bounded text and asks the configured provider for a
   main checkpoint, linked recheck, answers, rationales, misconception labels, and citations.
4. Compare every citation and answer with the source.
5. Select **Create unpublished review draft** only when the proposal is useful.
6. Edit and explicitly publish through the normal editor.

The assistant never publishes content. Its citations remain on the created draft and are private
to creators; participant/session data is never sent in authoring prompts. If the panel says the
assistant is disabled, the deployment sends no source to a model. Hosted Free allows three jobs
per month, Hosted Pro allows 100, and a community operator controls provider access.

### Import, export, folders, and tags

Use folders, tags, and search to organize the library. Imports support bulk paste, CSV, versioned
OpenRound JSON, and the supported QTI 3 profile. Every import displays validation errors and
warnings; unsupported content is never silently discarded. OpenRound JSON is the lossless native
format. QTI supports selected-response, multiple-select, and numeric checkpoints; unsupported
types and omitted media are reported.

Export a checkpoint set as OpenRound JSON, formula-safe UTF-8 CSV, or QTI ZIP. Hosted portability
exports require Pro; community deployments do not impose an application paywall.

## Host a live round

Select **Host** on a published set. Review audience, scoring, result visibility, late joining,
nickname policy, and Q&A settings before creating the room. OpenRound then issues a seven-digit
code, direct link, downloadable QR, and one-time host credential.

Keep the host tab open. Host, cohost, and presenter credentials are separate and stored only in
the tab that received them. From the host screen you can issue revocable cohost or presenter
access instead of sharing the host credential.

### Lobby and multi-device entry

- Share the same room code, direct link, or QR with every participant; each receives an
  independent resume credential.
- If a local QR contains `localhost`, use **Change join address** and enter the computer's
  reachable trusted-LAN address. A public event requires a deployed HTTPS domain.
- Watch the roster, remove or ban abusive guests, and lock or unlock admission.
- Open the presenter popout for a room-facing display. The dedicated embed route is read-only and
  works only for HTTPS origins on the workspace allowlist.

### Run the Recovery Loop

1. **Start round** opens the main checkpoint using a server-owned deadline.
2. Participants answer and optionally report confidence. An answer is complete only after
   **Answer received and saved**.
3. Lock at the deadline or select **Lock answers** early.
4. Review the measured participation, correctness, confidence, and misconception signals. Every
   insight card shows the threshold and measurement behind its suggestion; it is guidance, not an
   automated judgment.
5. Before reveal, peer discussion is available. After reveal, record an explanation, example, or
   break intervention.
6. Run the linked recheck, or use a same-checkpoint revote when no linked recheck exists.
7. Finish the recovery branch before showing standings or moving to the next main checkpoint.

Pause and resume preserve server time. Reconnect restores the exact lobby, checkpoint,
intervention, or recheck state. Open checkpoint payloads never expose answer keys, explanations,
misconception labels, private citations, or response distributions.

## Audience Q&A

When Q&A is enabled, participants can submit questions and vote once per question. Depending on
the round settings, a question appears immediately or waits for a host/cohost moderator. Hosts and
cohosts can publish, answer, dismiss, or remove it, add replies, and remove abusive replies.
Participant replies are optional.

Education's default public display is anonymous while retaining a facilitator-visible alias for
moderation. Workplace defaults show aliases publicly. Q&A has independent rate and payload limits,
cursor pagination, sanitization, kick/ban integration, retention, export, and deletion.

## Join and participate

Open the home join form, `/join`, a direct link, or the QR code.

1. Enter the seven-digit code and, when enabled, a nickname.
2. Wait in the lobby until a checkpoint opens.
3. Submit the displayed response format: one choice, an exact set of choices, a decimal value, a
   rating, or a poll selection.
4. If confidence is requested, choose one of the three confidence levels.
5. Wait for the durable saved acknowledgement. Retrying the same submission cannot create a
   second score effect.
6. After reveal, review private correctness, explanation, and choice feedback when available.

No persistent learner identity is created. The resume credential lives in that browser tab's
session storage. Refreshing the same tab can recover state; another browser normally joins as a
new guest.

## Reports and recovery evidence

Reports are generated asynchronously from durable answers and should be ready within 60 seconds.
They include initial accuracy, confidence-versus-correctness, misconception distribution,
interventions, linked-recheck recovery, separately labelled revote improvement, unresolved
concepts, participation, response time, Q&A, and participant-private feedback.

Linked recovery always displays its numerator, denominator, evidence type, and a small-sample
warning. It means initially incorrect participants who answered both checks and later answered the
linked recheck correctly. It is session evidence, not proof of long-term learning.

Download versioned JSON or formula-safe UTF-8 CSV where the edition permits it. Use **Delete
session and report** to permanently remove the session tree. Hosted Free defaults to 30-day report
retention, Hosted Pro to 365 days, and community operators configure their own default.

## Create an accountless follow-up

Pro and community facilitators can select unresolved concepts on a completed report and create an
immutable self-paced follow-up.

- Choose timed or no-countdown time-flex mode and an optional close date.
- Copy the generic anonymous link or download one-time personal links for live participants.
- Create a revocable 1.5× or 2× accommodation pass without storing a reason or revealing it to
  others.
- Close the follow-up early or revoke an individual link from the report.

Personal bearer links allow one attempt by default. A generic link creates an unpaired anonymous
attempt. Progress and deadlines are server-owned, attempts can resume on the same device, and
follow-up deletion/retention cascades with its source session.

## Account and data controls

Open **Account** to manage members, workspace selection, branding, secure embed origins, billing,
data export, and deletion. Workspace themes require readable colours and are copied into each new
round. Account export includes owned collaboration, Q&A, recovery, follow-up, and authoring data
without bearer-token hashes. Permanent deletion requires typing `DELETE` and removes private
objects before durable workspace records.

### Institution-enabled workspaces

An operator-approved institution workspace also shows its permanent home region, capability
policy, linked identities, LMS registrations, and—when approved—an owner-only audit export.
Workspace owners cannot self-enable contract-gated capabilities.

For creator OIDC, first sign in by email and explicitly link the institution identity from
**Account**. OpenRound keys the link by workspace, issuer, and subject; it never links by matching
email. The Account screen then provides the workspace-specific institution sign-in URL and lets
you revoke the link.

For LTI 1.3, an LMS administrator and the OpenRound operator must register matching issuer,
client, deployment, authorization, JWKS, and return-origin values. The first verified instructor
launch requires explicit linking to an existing creator. A Deep Linking launch opens a selection
screen containing published checkpoint sets and returns one signed resource link to the LMS.
Learner LTI launch, roster access, and grade passback are not available in this release; continue
to use the anonymous live-round QR or direct link for participants.

See the [institution integration guide](institution-integrations.md) for operator configuration,
security behavior, and pilot gates.

The included legal pages are drafts. A public operator must replace them with counsel-approved
text and set the corresponding policy version.

## Accessibility and facilitation

- Prefer accuracy mode for formative learning; use speed only when speed has instructional value.
- Use time-flex follow-up or accommodation passes where timing is not part of the construct.
- Keep prompts concise, but put every essential fact and answer label on participant devices.
- Never rely on colour, position, a projector, or an image alone.
- Test keyboard operation, screen readers, 200% zoom, reduced motion, contrast, and the actual
  participant network before an important event.
- Use anonymous participation when names are unnecessary, especially in education.

## Troubleshooting

| Message or symptom                                      | Meaning and response                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Invalid code**                                        | Check all seven digits; the round may have ended or expired.                         |
| **Session is not accepting participants**               | The lobby is locked, late join is off, or the round ended.                           |
| **Time expired before the server received that answer** | The authoritative deadline passed before receipt.                                    |
| **This tab does not have the host credential**          | Return to the original host tab or issue a new scoped staff credential.              |
| **Reconnecting…**                                       | Leave the tab open; the client requests an authoritative snapshot.                   |
| Report says **Finalizing…**                             | Wait up to 60 seconds, then ask the operator to inspect report jobs.                 |
| Authoring says **disabled**                             | The operator has not configured an approved provider; no source is sent.             |
| An authoring proposal **needs attention**               | Review its extraction/provider message and submit a corrected source or retry later. |

Operators should continue with the [production readiness checklist](runbooks/production-readiness.md)
and [incident response runbook](runbooks/incident-response.md).
