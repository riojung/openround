# OpenRound user guide

OpenRound lets a facilitator prepare a quiz, run it live, and review the results. Participants join as session-scoped guests and do not create accounts.

## Roles and screens

| Role                | Main job                                         | Main screens                                                |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| Creator/facilitator | Create, publish, host, and review                | Sign in, dashboard, editor, host controls, reports, account |
| Presenter           | Show the room a clean shared view                | Lobby, question, reveal, standings, finish                  |
| Participant         | Join and answer on a personal device             | Join, lobby, question, result, finish                       |
| Community operator  | Deploy, secure, back up, and support the service | Compose/deployment configuration, metrics, logs, runbooks   |

For a local first run, complete the [quick start](quick-start.md) before using this guide.

## Segment defaults

The segment selected during a creator's first sign-in changes session defaults, not the game engine.

| Setting   | Education                                           | Workplace learning                                                          |
| --------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| Scoring   | Accuracy: a correct answer receives the base points | Speed: a correct answer receives a time-weighted portion of the base points |
| Results   | Private participant results                         | Leaderboard enabled                                                         |
| Nicknames | System-generated friendly aliases                   | Participant-entered nickname, with a generated fallback                     |
| Late join | Allowed                                             | Allowed                                                                     |

The live-session setup screen starts with these defaults. The facilitator can change every setting
for an individual round before creating its room code.

## Sign in

1. Open the product and select **Create a free quiz** or go to `/signin`.
2. Choose the segment you mainly facilitate.
3. Enter your email, accept the Terms and Privacy notice, and request a magic link.
4. Follow the single-use link on the same browser profile.

The local Compose stack captures the message in Mailpit at <http://localhost:8025>. Native
development mode displays **Continue to dashboard**; Compose can expose the same shortcut only when
an operator explicitly enables its loopback-only testing configuration. A hosted production operator
must keep debug magic links disabled and configure SMTP plus an approved public origin.

### Return to your quizzes or sign out

- From the home page, open **Menu** on a phone or narrow browser. On a wider screen, use the creator
  links beside the OpenRound logo.
- Select **My quizzes** to return to the creator dashboard and manage drafts, published quizzes, and
  archived quizzes.
- Select **Sign out** to revoke the current browser session. Afterward, the same menu provides
  **Sign in** when you return.

## Create a quiz

From **Your quizzes**, enter a title under **Start a new quiz** and select **Create quiz**.

### Edit quiz details

- Give the quiz a clear title and optional description.
- Changes autosave after a short pause, including incomplete questions. Wait for **Saved** before
  navigating away.
- The **Draft checklist** names the quiz field or question that needs attention and explains how to
  resolve it. Every question must be complete before previewing or publishing.
- Use the left question list to move between questions.

### Add questions

OpenRound P0 supports:

- **Multiple choice:** two to six answer choices and exactly one correct answer.
- **True or false:** fixed True and False choices and exactly one correct answer.

For each question:

1. Write the question prompt.
2. Complete every answer label and use the radio control to mark the correct answer.
3. Choose a time limit from 5 seconds to 5 minutes.
4. Choose 0, 500, 1,000, or 2,000 base points.
5. Optionally add an explanation that appears after reveal.
6. Use **Move up**, **Move down**, **Duplicate**, or **Delete question** to organize the quiz.

A focused live question should be readable on a phone, have one unambiguous best answer, and leave enough time for the intended audience to read all choices.

### Add a question image

Image upload appears only when the operator enables malware scanning.

1. Enter alt text that communicates the instructional meaning of the image.
2. Select a JPEG, PNG, or WebP file no larger than 10 MB.
3. Wait through upload and safety checking until the preview appears.

The image remains private. It is first uploaded to quarantine, checked by signature and size, scanned, and then promoted for authorized delivery. If scanning is disabled or unhealthy, new uploads stay unavailable.

### Publish

Select **Preview** to save the draft and inspect every question in the participant layout. Use
**Previous question**, **Next question**, and **Reveal answer** to check answer labels, timing,
images, correctness, and explanations, then return to the editor.

Select **Publish** after the draft is saved and valid. Publishing freezes an immutable version. The quiz card then offers **Host**.

Editing a published quiz changes its draft but does not change an active session. Publish again when you want future sessions to use the new version.

## Manage the quiz library

From the dashboard you can:

- Search by quiz title or description.
- **Edit** any non-archived quiz.
- **Host** a quiz that has a published version.
- **Duplicate** a quiz to make an independent copy.
- **Archive** a quiz to remove it from the normal library.
- Select **Include archived quizzes**, then **Restore** an archived quiz.

Archiving is reversible; deleting session or account data is not.

## Host a live round

Select **Host** on a published quiz. Before a room is created, review or change:

- Maximum participants, up to the current plan or operator limit
- Whether participants may join after the round starts
- Accuracy or speed scoring
- Private results or leaderboard results
- Friendly generated aliases or participant-entered nicknames

Select **Create live session**. OpenRound then creates a session with a seven-digit code, direct
join URL, QR code, and session-scoped host credential. The session uses the latest immutable
published version, even if its editable draft changes later.

Keep the host tab open. The host credential is stored in that tab's session storage and is not available in an unrelated tab or browser.

### Prepare the lobby

- Share the code, copyable direct link, or QR code. Every participant in the session uses the same code; it is a room identifier, not a one-use credential.
- If the QR warning says `localhost`, expand **Change join address** and enter the host computer's reachable LAN address or the deployment's public HTTPS address. The QR updates immediately and remembers the override in that browser.
- Watch participants appear in the roster.
- Remove an inappropriate or unintended participant with **Remove**.
- Use **Lock lobby** to stop further admission; **Unlock lobby** reopens it.
- Select **Presenter view** for a clean room-facing display. Use **Host controls** to return.
- **Start round** becomes available after at least one participant joins.

The presenter lobby also displays the QR and direct link. For a local event, participant devices must share a network with the host and be able to reach port `8080`. For participants outside that network, use a deployed HTTPS service; do not expose the development stack directly to the internet.

### Run each question

The host interface only offers actions valid for the current phase:

1. **Start round** opens the first question and starts the server-owned deadline.
2. **Pause** freezes the active timer; **Resume** continues it.
3. **Lock answers** closes answering early. The server also locks at the deadline.
4. **Reveal answer** displays the correct choice and explanation.
5. **Show standings** displays the leaderboard when that session uses public standings.
6. **Next question** opens the next item. On the last question, the action becomes **Finish round**.

Use **End session** only when the round must stop early. It finishes the session and cannot return it to the lobby.

The server, not the browser countdown, decides whether an answer was on time. If the connection drops, the client shows **Reconnecting…** and requests an authoritative snapshot after reconnecting.

## Join and participate

Participants can use the join form on the home page, open `/join`, follow a direct link, or scan the host QR code.

1. Enter the seven-digit code.
2. Enter a nickname if custom names are enabled. Education sessions ignore entered names and assign friendly aliases.
3. Select **Join round** and wait in the lobby.
4. When a question opens, read the full question and labels on the participant device and select one answer.
5. Wait for **Answer received and saved**. A second answer is not accepted.
6. After reveal, review the result and explanation.

No participant account is created. The participant resume credential is stored only in that browser tab's session storage. Refreshing the same tab can recover the live state; moving to another tab or browser requires joining again and may create a new participant row.

## Review and export results

At the end of a round, the host can select **Open report**. A report includes:

- Participant count, answer count, and overall accuracy
- Per-question response count, correct count, accuracy, and difficult-question indicator
- Participant nickname, score, correct-answer count, and answer count
- **Download CSV** for a UTF-8 export on hosted Pro/Team or any community deployment. Hosted Free
  shows the upgrade path instead.

The report page displays its stored deletion deadline. Hosted Free reports default to 30 days and
hosted Pro/Team reports to 365 days. A self-hosting operator controls its default with
`COMMUNITY_REPORT_RETENTION_DAYS`. Upgrading changes the default for reports generated afterward;
an existing report keeps the deadline recorded when its session finished.

Use **Delete session and report** to permanently remove the session, participant rows, answers, and report. Confirm this choice carefully; it cannot be undone from the product interface.

## Account and data controls

Open **Account** from the dashboard to:

- See the current segment and plan.
- Save one workspace name, background colour, and action colour on hosted Pro/Team or community
  deployments. Each colour must pass 4.5:1 contrast against white text. New sessions copy the saved
  theme into host, presenter, and participant views; an already-created room does not change.
- Open hosted billing management when the deployment enables it. Billing is disabled in community mode.
- Download a UTF-8 JSON export of the creator's account and owned workspace data.
- Permanently delete the account and associated quizzes, media, sessions, answers, reports, and cached live state by typing `DELETE`.

The privacy and terms pages included in this repository are drafts. A public operator must replace them with counsel-approved text and set an appropriate policy version.

## Facilitation and accessibility tips

- Ask participants to join before locking the lobby, and verify the roster count aloud.
- Prefer accuracy mode for formative learning and use speed scoring only when response speed is meaningful.
- Do not put essential information only in an image; provide useful alt text and include the relevant facts in the question.
- Allow extra time for reading, translation, assistive technology, or a slower connection.
- Participants do not need to see a shared projector: complete prompts and answer labels appear on their devices.
- Avoid collecting names when anonymous participation is sufficient, especially in educational settings.
- Test keyboard navigation, zoom, screen reader behavior, and reduced motion in the environment used for the event.

## Troubleshooting a live round

| Message or symptom                                      | Meaning and response                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Invalid code**                                        | Check all seven digits. The session may have finished or expired. Ask the host for the current code.                            |
| **Session is not accepting participants**               | The lobby is locked, late joining is disabled, or the round ended. The host can unlock the lobby only while still in the lobby. |
| **Session has reached its participant limit**           | The configured plan/operator ceiling is full. Remove an unintended lobby entry or run another session.                          |
| **Choose another nickname**                             | The nickname is empty after normalization or reserved. Enter a different name.                                                  |
| **Time expired before the server received that answer** | The authoritative deadline passed before receipt. The host can allow more time on future questions.                             |
| **This tab does not have the host credential**          | Return to the original host tab and start the session from the dashboard if the credential is gone.                             |
| **Reconnecting…**                                       | Leave the tab open. If it persists, check the network and ask the operator to inspect realtime service logs.                    |
| Report says **Finalizing…**                             | Wait briefly. If it does not appear, the operator should inspect server logs and report reconciliation metrics.                 |

Operators should continue with the [production readiness checklist](runbooks/production-readiness.md) and [incident response runbook](runbooks/incident-response.md).
