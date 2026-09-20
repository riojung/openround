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
   <http://localhost:8025>; after requesting the link, select **Open local email inbox** on the
   sign-in page. If the configured public address differs from the browser address, move to the
   configured sign-in page first and continue using that origin after authentication.

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

### Reuse questions from another Round

When the UX beta is enabled, an owner or editor can select **Reuse from your workspace** in the
question Insert area. Search by Round title, question prompt, response type, or concept, then choose
one or more main questions. A valid linked recheck is included with its main question and counts
toward the current Round's 200-question limit.

Selecting **Add _N_ questions** appends one independent snapshot to the current draft and
autosaves it through the normal editor queue. Every copy receives fresh question and choice IDs;
copied main-to-recheck links point to the copied recheck. The source Round is not changed, and
later edits to either Round do not synchronize. Use the editor's one-step **Undo** immediately
after the add to remove the whole copied selection.

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

### Choose a Round Experience

Every checkpoint set has one category and a versioned experience preset. The category recommends
a visual treatment; choosing a category never silently changes a preset you selected yourself.

| Category          | Recommended preset | Intended character                      |
| ----------------- | ------------------ | --------------------------------------- |
| General           | Focus              | Warm, calm, and neutral                 |
| Education         | Campus             | Friendly academic pattern               |
| Business          | Studio             | Professional slate and teal             |
| Technical         | Blueprint          | Structured grid and cyan accents        |
| Safety/compliance | Signal             | High contrast and restrained motion     |
| Icebreaker        | Spark              | Bright cards and optional lively motion |

The preset changes only presentation: semantic colours, accessible answer colours, bundled/system
typography, original patterns, card treatment, motion profile, and optional sound cues. It never
changes scoring, timing, order, visibility rules, or control placement. Publish after choosing a
preset so the immutable version records it. At session setup, the host can preview and override
the preset for that one round. Session creation freezes the resolved experience.

On a live device, **High contrast**, **Reduce motion**, and **Mute** are local preferences. They
always override the room presentation without changing another person’s screen. Sound starts
muted and duplicates visual status rather than carrying unique information.

## Host a live round

Select **Host** on a published set. Review audience, scoring, result visibility, late joining,
nickname policy, Round Experience, presenter sound, and Q&A settings before creating the room.
OpenRound then issues a seven-digit code, direct link, downloadable QR, and one-time host
credential.

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

## Audience Pulse and room chat

Audience Pulse provides four structured, non-judgmental signals throughout the Recovery Loop:
**Got it**, **I’m unsure**, **Show an example**, and **Too fast**. A participant has one current
signal per lobby, checkpoint, recheck, revote, or intervention context and may change or clear it.
The next context starts with no signal.

Hosts and cohosts see each session alias, current signal, connection/answer state, last activity,
chat count, and moderation state. Presenter and participant screens receive aggregate counts only,
and those counts remain hidden until at least five unique participants signal in the context. An
open checkpoint never exposes an individual answer, correctness, confidence, or score effect in
the activity dashboard. Pulse remains separate from Recovery Loop recommendations in this
release—it is facilitator context, not an automated judgment.

Room chat is separate from Q&A and starts disabled for every session. A host can:

- Enable or close chat, choose public or room-anonymous participant aliases, and set 0/5/15/30
  second slow mode.
- Select an off, pinned-only, or live presenter feed. Pinned-only is the default.
- Pin or remove a message and mute a participant for 5, 15, or 60 minutes.
- Ban audience interaction, restore access, or kick the participant from the round.

Chat supports plain text up to 500 characters, one-level replies, and like/love/insight/laugh
reactions. It does not render links, attachments, Markdown, or private messages. A message created
in private-alias mode remains **Anonymous** to the room even if the host later switches to public
aliases; moderators retain the session alias for safety. Participants can report another person’s
message. Slow mode and distributed hard limits remain server-enforced across processes.

The participant interface explains: “The facilitator can see your session alias and signal; the
room sees totals only.”

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

1. Enter the seven-digit code, choose a session avatar, and, when enabled, enter a nickname.
2. Wait in the lobby until a checkpoint opens.
3. Submit the displayed response format: one choice, an exact set of choices, a decimal value, a
   rating, or a poll selection.
4. If confidence is requested, choose one of the three confidence levels.
5. Wait for the durable saved acknowledgement. Retrying the same submission cannot create a
   second score effect.
6. After reveal, review private correctness, explanation, and choice feedback when available.

Session avatars come from a fixed set: Comet, Fox, Owl, Otter, Panda, Robot, Rocket, and Star.
They are cosmetic, contain no uploaded or free-form profile data, and are not learner accounts.
Older clients and direct API callers may omit the avatar; the server then chooses a stable avatar
from the participant's session ID. The resolved choice is saved with the live session, so refresh
and reconnect keep it. Hosts and presenters can use avatars with nicknames to follow the room, and
authorized reports retain them with participant detail. When results are private, a participant
can see their own avatar but not another participant's avatar.

No persistent learner identity is created. The resume credential lives in that browser tab's
session storage. Refreshing the same tab can recover state; another browser normally joins as a
new guest.

## Reports and recovery evidence

Reports are generated asynchronously from durable answers and should be ready within 60 seconds.
Report v3 includes initial accuracy, confidence-versus-correctness, misconception distribution,
interventions, linked-recheck recovery, separately labelled revote improvement, unresolved
concepts, participation, response time, the frozen experience, aggregate Pulse distributions,
conversation/moderation counts, Q&A, and participant-private feedback.

Linked recovery always displays its numerator, denominator, evidence type, and a small-sample
warning. It means initially incorrect participants who answered both checks and later answered the
linked recheck correctly. It is session evidence, not proof of long-term learning.

Download versioned JSON or formula-safe UTF-8 CSV where the edition permits it. Use **Delete
session and report** to permanently remove the session tree. Hosted Free defaults to 30-day report
retention, Hosted Pro to 365 days, and community operators configure their own default.

The standard report stays aggregate-first and does not embed raw chat or participant-level signal
history. An authorized owner, editor, or viewer can open the interaction transcript; only an
owner/editor audit view can reveal a removed body. Transcript CSV follows the existing export
entitlement and escapes spreadsheet formula prefixes.

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

## Assign practice from a published Round

When standalone practice is enabled for your workspace, open a published Round and choose
**Assign practice**. OpenRound freezes the current published version, so publishing later edits does
not change an assignment that learners have already opened.

- Choose an optional title, a timed or no-countdown mode, and a close date within your plan's
  retention window.
- Use the generic link for anonymous, unpaired practice or add recipient labels to create
  revocable one-attempt links. Labels help you distribute links; learners still do not need
  accounts.
- Copy or download every new bearer link when it is shown. OpenRound stores only its hash and does
  not reveal the same URL again.
- Open **Practice** to see aggregate started/completed counts, add another labelled personal link,
  revoke a link, create an accommodation pass, or close the assignment early.

Standalone practice includes the published Round's main questions. Linked rechecks remain
conditional Recovery Loop material and are not added as unconditional practice questions. If a
workspace administrator later disables new assignment creation, already-created assignments stay
available to manage and complete until they close or expire.

## Account and data controls

Open **Account** to manage members, workspace selection, branding, secure embed origins, billing,
data export, and deletion. Workspace branding requires readable colours and is layered only onto
safe Round Experience surfaces. Account export includes owned collaboration, Q&A, Pulse, chat,
moderation, recovery, follow-up, and authoring data without bearer-token hashes. Permanent
deletion requires typing `DELETE` and removes private objects before durable workspace records.

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
| **Room chat is closed**                                 | The host must enable chat for this session; Pulse may still be available.            |
| **You are sending messages too quickly**                | Wait for the displayed slow-mode/rate-limit interval, then retry once.               |
| Pulse totals are hidden                                 | Fewer than five unique participants have signalled in the current context.           |
| Report says **Finalizing…**                             | Wait up to 60 seconds, then ask the operator to inspect report jobs.                 |
| Authoring says **disabled**                             | The operator has not configured an approved provider; no source is sent.             |
| An authoring proposal **needs attention**               | Review its extraction/provider message and submit a corrected source or retry later. |

Operators should continue with the [production readiness checklist](runbooks/production-readiness.md)
and [incident response runbook](runbooks/incident-response.md).
