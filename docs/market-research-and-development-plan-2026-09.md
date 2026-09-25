# OpenRound market research and evidence-led development plan

Research date: 2026-09-23
Committed horizon: 24 weeks with one full-time engineer plus fractional product, design,
accessibility, security, operations, and research support
Option horizon: six to twelve months, released only through the evidence gates below

This document updates the **priority order** in the earlier competitive and UX plans. It does not
replace their historical analysis, implementation detail, or release-readiness gates. Prices,
limits, and competitor capabilities change frequently and must be rechecked before a public claim
or packaging decision.

## Executive decision

OpenRound should not enter a quiz-feature, game-mode, AI-generation, or slide-editor arms race. The
reviewed market is already crowded with polished products that are broader, better known, and more
deeply integrated than a small team can quickly match.

OpenRound should instead own a narrower and more valuable job:

> **Turn visible confusion into an explainable action, verify whether understanding changed on a
> different question, and preserve honest evidence of what happened—without requiring participant
> accounts.**

The existing **Ask → Diagnose → Intervene → Recheck → Prove** loop is the right foundation, but the
market has moved. Confidence, peer discussion, repeated polling, and follow-up questions are not
individually unique. The defensible product is the complete chain:

1. An initial response and confidence signal.
2. A source-supported misconception diagnosis.
3. A facilitator-selected intervention or structured discussion.
4. A linked, meaningfully different immediate recheck.
5. An optional delayed transfer or retention check.
6. A privacy-preserving evidence trail with its limits visible.

The next roadmap should therefore run two tightly connected lanes:

- **Workflow fit:** reliable rooms, existing-slide companion mode, live access accommodations, and
  only the response types users repeatedly need.
- **Evidence depth:** versioned Recovery Packs, a Question Health Lab, delayed Recovery Trails, and
  privacy-safe concept trends.

With one full-time engineer, these are not two simultaneous feature trains. The 24-week commitment
is release readiness plus **one observed table-stakes blocker** and **one differentiated bet**. The
remaining items are gated options, not promises disguised as a roadmap.

Before either lane expands, the team must finish the current beta evidence. OpenRound's largest
known gap is not another feature epic: it is the absence of observed design-partner, accessibility,
security, hosted-capacity, operational, and willingness-to-pay evidence.

## Research scope and confidence

No bounded review can verify every product in a changing global market. This research instead
covered 26 representative products across live response, formative assessment, interactive
presentations, game-based review, self-study, open-source, and low-connectivity categories. It
combined:

- a repository and implementation audit;
- current first-party product, help, integration, and pricing material;
- current review-aggregator and practitioner discussions for recurring pain patterns;
- learning-science and training-evaluation research; and
- the earlier OpenRound competitive and UX research.

Evidence is used at three confidence levels:

| Level | Meaning                                                                            |
| ----- | ---------------------------------------------------------------------------------- |
| A     | Implemented repository behavior or current first-party product documentation       |
| B     | Repeated review/community pattern or peer-reviewed research                        |
| C     | Product inference or hypothesis that still requires OpenRound customer observation |

This work did **not** conduct new customer interviews, observe a production OpenRound session, or
establish willingness to pay. Review sites have selection bias, vendor pages are marketing
material, and learning studies do not prove a particular product implementation will work. The
roadmap treats those limits as gates rather than footnotes.

## Current OpenRound baseline

OpenRound is already much more than a happy-path quiz application. The audited repository includes:

- six response types, confidence, concepts, misconception labels, private feedback, linked
  rechecks, deterministic insights, and intervention tracking;
- accountless joining by code, link, or QR, durable answer acknowledgement, reconnect, pause/resume,
  cohosting, presenter credentials, and server-authoritative state;
- live Rounds plus accountless self-paced practice and report-derived follow-ups;
- moderated Q&A, Audience Pulse, disabled-by-default chat, reporting, moderation, and privacy
  thresholds;
- source-grounded authoring from text/PDF/DOCX/PPTX with citations and mandatory human review;
- JSON, CSV, bulk, and constrained QTI portability plus private cross-Round snapshot reuse;
- structured interactive Presentations, Groups, Discover, a professional workspace shell, and ten
  interface locales behind gated beta rollouts;
- creator OIDC and LTI launch/Deep Linking foundations; and
- strong local correctness, security, accessibility-automation, recovery, load, backup, and
  observability harnesses.

The current constraints matter more than the feature count:

| Boundary               | Current reality                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Public readiness       | Source CI and local production smoke are complete; thirteen gates remain, primarily awaiting external or human evidence           |
| Rollout                | Major workspace, builder, Presentation, Group, Discover, rehearsal, and practice capabilities default off or require allowlisting |
| Presentation delivery  | The newer live Presentation host and participant paths poll rather than using the mature Round Socket.IO/reconnect path           |
| Live accessibility     | Practice/follow-up accommodation passes exist; private live extra time/time-flex remains unresolved                               |
| Response breadth       | Exact short text and rank/order are absent; moderated open response, drawing, and word cloud are deliberate later decisions       |
| Existing-deck workflow | A structured Presentation builder exists, but there is no lightweight slide companion/remote or native add-in                     |
| Reuse                  | Cross-Round reuse creates independent snapshots; there is no synchronized question bank or version-aware reusable Recovery Pack   |
| Longitudinal evidence  | Reports describe one session; no privacy-safe cross-session concept view or delayed transfer trail exists                         |
| Institution mode       | LTI launch/Deep Linking exists; roster, identified learner, grade passback, SAML/SCIM, and certification remain contract-gated    |
| Maintainability        | Several routes, repositories, contracts, builders, and session services are already very large and should be split when touched   |

The implementation source of truth remains [implementation status](implementation-status.md),
[product design](design.md), [architecture](architecture.md), and the
[release-readiness ledger](release-readiness.json).

## Competitive market map

### Product archetypes

| Archetype                       | Representative products                                                                                                                                                                                                                                                                  | What they make normal                                                                                                                       | OpenRound implication                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Higher-education response       | [iClicker](https://www.iclicker.com/), [Learning Catalytics](https://www.pearson.com/en-us/higher-education/products-services/learning-catalytics.html), [Top Hat](https://tophat.com/features/), PointSolutions/EchoPoll                                                                | Confidence, attendance, broad response formats, PowerPoint, roster/grade sync, peer grouping, institutional support                         | Accountless/privacy-first use is an opening, but confidence and peer instruction are not unique |
| Learning-oriented interaction   | [Wooclap](https://www.wooclap.com/en/features/), [Wayground](https://help.wayground.com/support/solutions/articles/158000403874-understanding-wayground-plans), [Socrative](https://www.socrative.com/pricing/), Classtime                                                               | Live and self-paced delivery, many activity types, AI authoring, accommodations, analytics, libraries, and LMS workflows                    | OpenRound must win on a clearer evidence loop, not generic “active learning”                    |
| Interactive lesson/assessment   | [Nearpod](https://nearpod.com/how-nearpod-works/), [Pear Deck](https://www.peardeck.com/pricing), [Formative](https://www.formative.com/teachers), Quizalize                                                                                                                             | Full lessons, interactive video, real-time feedback, differentiated follow-up, standards/mastery views, shared content, and admin reporting | Do not build a whole-course or K–12 curriculum platform                                         |
| Presentation and audience voice | [Mentimeter](https://www.mentimeter.com/features), [Slido](https://www.slido.com/product), [Vevox](https://www.vevox.com/features), [Poll Everywhere](https://www.polleverywhere.com/plans), [AhaSlides](https://ahaslides.com/features/), [ClassPoint](https://classpoint.io/)          | Polished result visuals, PowerPoint/Google Slides/Teams integrations, Q&A, word clouds, open response, large rooms, and easy joining        | A reliable companion/overlay is more strategic than replacing users' decks                      |
| Game and content ecosystems     | [Kahoot!](https://kahoot.com/schools/how-it-works/), [Blooket](https://help.blooket.com/hc/en-us/articles/21408591795351-Blooket-Game-Mode-Previews), [Gimkit](https://help.gimkit.com/en/article/game-options-explained-16312ua/), [Wordwall](https://wordwall.net/features), StudyGlen | Familiarity, huge libraries, fast source-to-game creation, public discovery, many modes, collectibles, and strong learner pull              | Do not pursue public-marketplace scale, arcade economies, or many modes                         |
| Open/private/low-connectivity   | [Particify](https://www.particify.de/en/help/), [ClassQuiz](https://github.com/mawoka-myblock/ClassQuiz), [Plickers](https://help.plickers.com/hc/en-us/articles/360009395854-What-is-Plickers)                                                                                          | Self-hosting, privacy, guest access, or device-free/offline participation                                                                   | Open source and privacy need a concrete outcome wedge; resilience remains a meaningful need     |

### Capability comparison around OpenRound's wedge

Legend: **Strong** means prominent in current first-party material; **Partial** means present but
limited, plan-dependent, or not the product's primary workflow. An empty cell does not prove a
capability is absent.

| Product             | Live + async | Confidence | Intervention / peer recheck | Before/after evidence | Source/AI authoring | Slides/LMS | Guest/private/open |
| ------------------- | ------------ | ---------- | --------------------------- | --------------------- | ------------------- | ---------- | ------------------ |
| OpenRound           | Strong       | Strong     | Strong                      | Strong                | Strong              | Partial    | Strong             |
| Wooclap             | Strong       |            | Strong                      | Partial               | Strong              | Strong     | Partial            |
| Learning Catalytics | Strong       | Strong     | Strong                      | Partial               |                     | Partial    |                    |
| iClicker            | Strong       | Strong     | Partial                     | Partial               | Partial             | Strong     | Partial            |
| Vevox               | Strong       |            | Partial                     | Strong                | Partial             | Strong     | Partial            |
| Wayground           | Strong       |            | Partial                     | Partial               | Strong              | Strong     | Partial            |
| Formative           | Strong       |            | Partial                     | Strong                | Strong              | Strong     |                    |
| Quizalize           | Strong       |            | Partial                     | Strong                | Partial             | Partial    |                    |
| Particify           | Strong       |            |                             |                       |                     | Partial    | Strong             |

### The competitive claim that must change

OpenRound must not claim that confidence, peer discussion, re-voting, follow-up questions, or
before/after comparison are unique:

- [iClicker](https://www.iclicker.com/) now prominently markets confidence ratings, multiple
  response formats, assignments, and LMS roster/grade sync.
- [Learning Catalytics](https://help.pearsoncmg.com/learning_catalytics/instructor/en/Content/Topics/get_ready_to_deliver_lc/lc_groups.htm)
  can automatically group learners by response for discussion and a second response.
- [Wooclap's peer-learning workflow](https://www.wooclap.com/en/peer-learning/) describes first
  votes, discussion, and result comparison. Its 2026
  [AI live facilitator](https://www.wooclap.com/en/ai-live-facilitator/) also groups open answers,
  surfaces themes, summarizes, and generates an immediate follow-up question.
- [Vevox comparison polls](https://help.vevox.com/hc/en-us/articles/22996157485213-Create-before-and-after-comparisons)
  visualize how a repeated response changes during a session.
- [Formative](https://www.formative.com/back-to-school) and
  [Quizalize](https://www.quizalize.com/) increasingly turn results into recommended or assigned
  follow-up work.

The stronger claim is that OpenRound deliberately connects a diagnosed misconception, a recorded
human action, a linked different question, immediate and delayed evidence, explicit sample limits,
and guest-first privacy. This is a position to prove, not an assertion that no competitor can
assemble a similar workflow.

## What users repeatedly need

### 1. Fit existing teaching and meeting workflows

Facilitators do not want another presentation platform to maintain. Major competitors invest in
PowerPoint, Google Slides, Teams, Zoom, or LMS integrations. Mentimeter reviews repeatedly surface
presentation-integration and import friction, while ClassPoint's entire proposition is working
inside PowerPoint. The product response should be a lightweight browser companion first, not a
second full slide editor or immediate native add-in program.

**OpenRound decision:** build a reliable companion/remote that sits beside any deck, can insert a
prepared Recovery Pack or quick check, shows join/result overlays, and returns focus to the deck in
one action. Require three paying design partners before native PowerPoint or Google Slides add-ins.

### 2. Reliability and equitable access beat novelty

The 2024–25 Jisc higher-education student survey reports widespread Wi-Fi and device problems, and
current reviews of several polling products mention disconnections, lost answers, QR trouble, or
live integration failures. OpenRound's durable receipt and reconnect design are valuable only when
users can see and trust them.

**OpenRound decision:** make room health, durable save state, reconnect, and low-bandwidth behavior
visible. Harden the Presentation live path on the mature realtime/session foundation before adding
more Presentation breadth. Research shared-device and facilitator-tally fallbacks; do not commit to
physical cards or SMS without target-segment demand.

### 3. Participation must feel safe

Anonymous contribution makes it easier for quieter participants to respond, while timers, public
rankings, and identity-linked grading can add pressure or distort the learning job. OpenRound is
already well positioned with accountless entry, private-result defaults, Q&A moderation, and
accuracy-first modes.

**OpenRound decision:** keep **Learning mode** private and guest-first. Treat a future identified,
rostered **Verified mode** as a separate, disclosed, institution-controlled product boundary. A
session must never silently switch identity semantics or retroactively deanonymize participation.

### 4. Facilitators need one explainable next action

Raw charts and AI summaries are easy to produce; acting during a live session is harder. Learning
analytics research repeatedly finds that trust and use depend on mapping signals to a comprehensible
decision. OpenRound's deterministic Recovery Compass is strategically stronger than a generic
dashboard, provided real facilitators can understand it quickly.

**OpenRound decision:** preserve one phase-aware recommended action, always show the rule and sample,
and record the facilitator's choice. AI may help author or organize material, but it should not
silently decide the live intervention.

### 5. Question quality is more valuable than faster question generation

AI question generation is now common. Recent evaluation work still finds frequent violations of
multiple-choice quality guidelines and substantial need for human review. Good distractors and
concept checks improve through learner-response evidence, not prompt speed alone.

**OpenRound decision:** build a **Question Health Lab** instead of a generic authoring chatbot. It
should preflight ambiguity, distractors, source support, accessibility, mobile readability, and
recheck similarity, then use aggregate post-session evidence to suggest a new version. It must
never rewrite a published version or auto-publish a change.

### 6. Immediate improvement is not retention or transfer

Learning research supports retrieval practice, feedback, and peer discussion, but a same-session
gain is not durable learning. Workplace evaluators similarly need evidence beyond attendance and
completion. The [CDC training evaluation guidance](https://www.cdc.gov/training-development/php/about/evaluate-training-measuring-effectiveness.html)
distinguishes learning from later transfer.

**OpenRound decision:** add an optional **Delayed Recovery Trail** using a concept-matched but
different question at 24 hours, seven days, or a facilitator-selected interval. Label immediate
recovery, delayed retention, and workplace application as different evidence types, with attrition
and denominator warnings.

### 7. Accessibility is both a user need and a buying gate

[Wayground accommodations](https://help.wayground.com/support/solutions/articles/158000404955-accommodations-available-on-wayground)
include extra time, extended deadlines, read-aloud, translation, speech-to-text, reduced choices,
and reading controls. iClicker publishes current accessibility-conformance material. Institutional
technology acquisition increasingly asks for accessibility and security documentation, not just a
feature list.

**OpenRound decision:** prototype whole-room live time-flex and private extra-time behavior now;
complete manual assistive-technology evidence and an accessibility-conformance report before
claiming parity. Add reading supports only after user research establishes which needs are not
already met by browser and OS assistive technology.

### 8. Live plus self-paced, reuse, and interoperability are table stakes

The market expects the same material to work live and asynchronously, be reusable, and connect to
existing systems. OpenRound now covers live Rounds, practice, imports/exports, and snapshot reuse,
but self-paced Presentations and version-aware reusable content are incomplete.

**OpenRound decision:** make the Recovery Pack the reusable unit, with explicit version snapshots
and “update available” review rather than hidden synchronization. Add self-paced Presentation
delivery only after live Presentation reliability is proven.

### 9. Capacity and pricing create acquisition friction

Current official free live limits commonly cluster around 40–100 participants: Kahoot! 40,
Wayground 100, Socrative 50, Nearpod 40, Slido 100, Vevox 100, Poll Everywhere 40, AhaSlides 50,
and Blooket 60. OpenRound Hosted Free at 20 is visibly below this range.

**OpenRound decision:** target 50 for Hosted Free and 250 for Pro, but change neither public promise
until target-region cost, abuse, support, soak, restart, and report-reconciliation evidence passes.

## Product strategy

### Primary job

The initial behavioral ICP is a self-serve facilitator running recurring, concept-heavy sessions
for roughly 20–100 people and able to adopt without a roster, gradebook, or procurement integration.
Higher-education STEM/health teaching and workplace technical training should both enter discovery,
but the team should choose one primary acquisition channel after the first research gate rather
than fund two institutional roadmaps.

After the Phase 0 research gate, select the segment with more repeat pilots and evidence-complete
recovery loops. If the segment evidence is tied, prefer faster activation and then stronger
willingness-to-pay evidence. Keep the selection pending when reviewed evidence is incomplete or
the deciding measures conflict without a defensible winner.

For those instructors and facilitators:

> When a room is wrong, split, or confidently mistaken, help me choose what to do next and show me
> whether that action changed understanding—without embarrassing people or creating learner
> accounts.

This excludes graded high-stakes testing, certification, attendance enforcement, K–12 institutional
deployment, public content commerce, and general meeting facilitation from the initial wedge.

### Three product pillars

#### 1. Recovery Packs

A Recovery Pack is a versioned, portable teaching unit containing:

- one diagnostic question;
- concept and misconception metadata;
- source citations where applicable;
- one or more human-reviewed intervention cards, such as an explanation, worked example, or peer
  prompt;
- a linked, meaningfully different immediate recheck; and
- an optional delayed transfer/retention probe.

The existing source-grounded authoring and linked-recheck model already implement much of this
content. The product work is to make the unit visible, reusable, quality-checked, and easy to insert
into a Round, Presentation, companion session, or practice assignment.

#### 2. Question Health Lab

Before use, the lab should flag deterministic or reviewable issues:

- duplicated, overlapping, or length-cued choices;
- missing correct-answer rationale or source support;
- distractors with no authored misconception purpose;
- a recheck that is identical or tests a different concept;
- inaccessible media or missing alt text;
- mobile overflow and excessively dense prompts; and
- inconsistent scoring, confidence, timing, or purpose settings.

After enough aggregate evidence exists, it should flag—not automatically “fix”—questions with:

- unused distractors;
- unexpectedly high confident-wrong responses;
- high correct-but-unsure responses;
- extreme response-time shape;
- recheck behavior inconsistent with the intended concept; or
- large instability across comparable sessions, with cohort and sample warnings.

Every change creates a new draft/version. Historical reports remain attached to the exact version
that participants saw.

#### 3. Recovery Trail

The Recovery Trail connects:

```text
Initial signal → diagnosed issue → facilitator action → immediate recheck → optional delayed probe
```

The report must separate:

- same-question revote;
- linked near-transfer recheck;
- delayed concept check; and
- self-reported workplace application.

It must show participation/attrition and avoid causal language such as “the intervention caused the
gain.” Session Decision Replay is the facilitator-facing view of this trail; Concept Health is the
privacy-safe aggregate view across eligible sessions.

### Supporting rails

- **Companion mode:** fit existing decks and meetings.
- **Resilient room:** visible receipts, reconnect, low-bandwidth delivery, and honest capacity.
- **Accessible timing:** whole-room time-flex first, private passes only after fairness/privacy
  testing.
- **Two trust modes:** private Learning mode and future contract-gated Verified mode.
- **Open core:** community/self-hosted deployments retain the recovery engine and native exports.

## Priority portfolio

| Rank | Capability                                      | Demand evidence | Strategic fit | Differentiation | Relative effort/risk  | Decision                                      |
| ---: | ----------------------------------------------- | --------------- | ------------- | --------------- | --------------------- | --------------------------------------------- |
|    1 | Beta, production, and primary-customer evidence | Very high       | Essential     | Trust layer     | High/external         | Do now; no substitution by feature work       |
|    2 | Presentation realtime and resilient-room work   | Very high       | Essential     | Medium          | Medium                | Do now before Presentation breadth            |
|    3 | Browser slide companion/remote                  | Very high       | High          | Medium          | Medium                | Prototype in the first pilot cycle            |
|    4 | Live time-flex and private extra-time design    | High            | High          | Medium          | Medium/high           | Prototype, usability-test, then implement     |
|    5 | Recovery Pack as a reusable unit                | High            | Very high     | High            | Medium, high leverage | Build after the evidence baseline             |
|    6 | Question Health Lab                             | High            | Very high     | High            | Medium                | Highest-confidence innovative build           |
|    7 | Delayed Recovery Trail                          | Medium/high     | Very high     | High            | Medium                | Concierge-test, then build                    |
|    8 | Exact short text and rank/order                 | High            | Medium        | Low             | Medium                | Thin parity lane; do not add a format catalog |
|    9 | Session Decision Replay and Concept Health      | Medium          | Very high     | High            | Medium/high           | Build only after concept metadata is healthy  |
|   10 | Self-paced Presentation                         | Medium/high     | Medium        | Low             | Medium                | After live Presentation evidence              |
|   11 | Structured contrast-pair discussion             | Medium          | High          | Medium          | High                  | Pilot only; competitors already do grouping   |
|   12 | NRPS/AGS, identified learner, grade passback    | High for buyers | Conditional   | Low             | Very high             | Two named institutional pilots first          |
|   13 | Moderated open response/word cloud              | High            | Low/medium    | Low             | High safety cost      | Later, after moderation evaluation            |

The ordering is deliberately not pure competitor parity. Recovery Pack and Question Health rank
above several common formats because they strengthen the outcome OpenRound is trying to own.

## Development roadmap

Timing is an engineering estimate, not a launch promise. External review and pilot recruitment can
run in parallel, but a failed gate changes the next phase. Reserve roughly seven of the first 24
engineer-weeks for defects, operations, security, support, and contingency; external specialists
must perform work an engineer cannot self-certify.

### Phase 0 — prove and harden the product (weeks 0–10, overlapping tracks)

**Outcome:** know whether the current Recovery Loop solves a recurring problem and can run safely
outside a developer machine.

Product and research work:

- Interview at least six higher-education facilitators and six workplace facilitators using their
  most recent real deck, quiz, report, or training artifact.
- Recruit at least three higher-education and three workplace design partners and observe ten live
  sessions.
- Run the existing creation, action-finding, first-response, receipt, result-finding, and report-
  comprehension usability protocol.
- Prototype three concepts without full implementation: companion mode, Question Health, and a
  delayed concept-matched probe.
- Establish current create → publish → room → join → saved answer → intervention → recheck → report
  funnel baselines.

Engineering and release work:

- Move or adapt live Presentations onto the mature realtime acknowledgement/reconnect foundation;
  add a complete host/participant/reconnect/report browser journey.
- Add visible room/network health and verify low-bandwidth payload behavior without preloading
  answer keys or hidden diagnostic metadata.
- Split the largest touched Presentation/session components before expanding them.
- Provision staging and complete the release-ledger work for TLS, pinned hosts, private telemetry,
  paging, off-host backup, replacement-host restore, physical devices, target-host load/soak,
  independent accessibility/security, privacy/legal, billing, and support rehearsal.

Exit gates:

- At least eight of twelve interviewees describe a recurring post-result decision problem.
- At least six agree to a real pilot and at least three in each segment run OpenRound twice.
- At least half of eligible observed checkpoints complete diagnose → intervention → valid recheck.
- Existing beta usability thresholds pass, including unassisted first value, next-action finding,
  first response, durable receipt, result retrieval, and report comprehension.
- No critical/serious accessibility defect, answer-key leak, unreconciled response, or identity-
  mode ambiguity remains in a critical flow.

**Stop/reframe rule:** if users consistently use OpenRound only as a generic poll and do not act on
the Recovery Compass, narrow the target segment or revise the workflow before adding breadth.

### Phase 1 — remove the highest observed workflow blocker (weeks 11–14)

**Outcome:** OpenRound works beside the user's existing material and supports a calmer, more
inclusive live session.

Select exactly **one** implementation from observed sessions, in this order:

- **Access path first** if timing or connectivity excludes participants in at least three partner
  workflows, affects at least 10% of observed attempts, or produces a serious accessibility
  finding. Ship whole-room live time-flex and the highest-impact room-health/reconnect improvements.
  Do not ship private 1.5×/2× passes until research establishes reveal, privacy, and fairness
  behavior.
- **Companion path otherwise** if at least four repeat facilitators use an external deck and at
  least two observed sessions suffer a material context-switch interruption. Ship a thin browser
  companion with join overlay, prepared-question insertion, phase-aware controls, results overlay,
  and one-action return to the deck.
- **Measured-failure path otherwise:** spend the phase on the largest measured activation or
  correctness failure; do not invent a third feature.

In parallel, validate Hosted Free 50 on the actual target host and release it only after the load,
restart, cost, abuse, reconciliation, and support gates pass. Keep Pro at 100 until the corresponding
250-client target-host soak gate passes.

Non-goals:

- Native PowerPoint or Google Slides add-ins.
- Importing or editing a full deck in companion mode.
- Device geolocation, attendance enforcement, or participant profiling.

Exit gates:

- Eighty percent of first-time pilot facilitators launch a prepared interaction beside an existing
  deck within two minutes and return to that deck without coaching.
- Any companion uses the same authoritative command, acknowledgement, role-filter, and reconnect
  contracts as the normal host.
- Manual keyboard, VoiceOver, NVDA, zoom, reduced-motion, and representative-device tests pass.
- No participant is publicly marked as accommodated, and the timing model cannot leak an
  accommodation through participant-specific UI or results.

### Phase 2 — ship one differentiated bet (weeks 15–24)

**Outcome:** facilitators create reusable, defensible diagnostic sequences and improve them from
real evidence.

Default scope: build the **Question Health Lab** if prototype flags are judged actionable at least
70% of the time across 20 or more real questions and at least half lead to an accepted revision.
Start with deterministic pre-publish checks, then add only the post-session observations supported
by adequate samples.

Use the same slot for **Recovery Pack authoring instead** if observed sessions show that linked
rechecks are rarely authored because preparation cost—not question diagnosis—is the dominant
failure. In that branch, extend the source-grounded assistant to propose a diagnostic, rationale,
misconception-linked distractors, source-cited intervention card, and differently worded recheck,
all with human approval. A visible pack may begin as versioned composition over existing immutable
content before introducing a new durable aggregate.

During weeks 21–24, harden the chosen bet and run a concierge prototype of the Delayed Recovery
Trail. Do not implement both primary bets or the full delayed system in this cycle.

Exact short text and rank/order remain a thin parity option only if at least 30% of otherwise
qualified pilot sessions cannot express a required check with the existing six formats.

Exit gates:

- Every generated citation resolves to the submitted source span or is visibly rejected.
- Human correction rate, invalid-question rate, latency, and provider cost are measured on an
  approved representative corpus; no hosted enablement occurs without agreed thresholds.
- At least 70% of facilitator-reviewed Question Health flags are judged useful; false positives and
  dismissals are recorded by rule.
- Any shipped pack structure round-trips losslessly in OpenRound JSON and produces explicit loss
  reports in constrained formats.
- Old published versions and completed reports remain byte/logically reproducible.

### Later horizon A — connect immediate recovery to later evidence

**Outcome:** a facilitator can check whether an apparent recovery survives after the room.

Scope:

- Add optional delayed probes at 24 hours, seven days, or a facilitator-selected interval.
- Reuse expiring generic or labelled accountless links; do not require participant accounts or
  collect an email address merely to schedule a probe.
- Let the facilitator distribute the link through the existing LMS, email, or messaging channel;
  notification integrations are a later decision.
- Add Recovery Trail and Session Decision Replay, separating revote, linked recheck, delayed
  retention, and workplace application evidence.
- Show attrition, numerator/denominator, timing, question equivalence, and small-sample warnings.

Exit gates:

- At least 40% of invited pilot participants complete the delayed probe, or research identifies a
  credible workflow change before broader investment.
- At least half of pilot facilitators use the result to choose a next action, not merely view it.
- Expiry, revocation, resume, retention, deletion, and tenant isolation pass memory, PostgreSQL,
  API, browser, and process-restart tests.
- Reports never describe immediate gain as durable learning or imply that an intervention caused
  the change.

This horizon is not part of the first 24-week commitment. Start it only if at least 30% of eligible
pilot sessions issue the concierge delayed check, at least 50% of invited participants complete it,
and facilitators use the result to change a later action.

### Later horizon B — privacy-safe program insight

**Outcome:** repeated users can see which concepts remain fragile without creating hidden learner
profiles or misleading league tables.

Scope:

- Add a Concept Health view using only eligible versioned concept evidence with minimum cohort
  sizes, explicit date/session filters, and numerator/denominator display.
- Show recurring confident misconceptions, unresolved concepts, later-retention evidence, and
  question-quality warnings.
- Add a structured peer-discussion prototype only if observed sessions show facilitators need help
  forming discussion pairs. Start with ephemeral, facilitator-controlled groups and do not reveal
  who is correct.
- Add self-paced Presentation delivery only if live Presentation use and reliability clear the
  prior gate.

Exit gates:

- At least 60% of reused pilot content has meaningful concept metadata; otherwise improve
  authoring before building dashboards.
- Users correctly explain what a trend does and does not mean in observed report tasks.
- No participant-level cross-session profile exists in Learning mode, and aggregates suppress
  small or reconstructable cohorts.
- The main unresolved concept and its evidence can be found in under 45 seconds.

This horizon follows Delayed Recovery Trail and requires meaningful concept metadata on at least
60% of reused pilot content.

### Conditional institution lane — do not schedule by default (8–12 additional weeks)

Start this lane only after two named institutions agree that roster/grade services are required for
a paid pilot and accept the identified-data model.

Scope would include NRPS, idempotent AGS grade delivery, a separately disclosed Verified mode,
managed SSO/SCIM, admin policy, audit, retention, accessibility/security documentation,
certification/interop, support, and contracts. Learning mode remains available and cannot be
silently upgraded into identified reporting.

## Development-ready epic definitions

### Epic A — Companion mode

**User job:** “I already have a deck. Let me ask, recover, and return to it without losing the
room.”

MVP acceptance:

- compact host window or side panel with current phase, joined/answered count, one primary action,
  and connection state;
- dedicated scoped credential, never a reused creator or presenter token;
- join QR/code overlay and participant-safe result overlay;
- prepared Recovery Pack insertion and one session-only Quick Check;
- keyboard/remote-friendly next action and a reliable return-to-deck action;
- same command idempotency, fencing, acknowledgement, and reconnect behavior as the main host.

### Epic B — Live access and resilience

**User job:** “Let everyone participate without publicly disclosing who needs more time or who lost
connectivity.”

MVP acceptance:

- whole-room time-flex mode where the host closes the response window;
- explicit research decision on how private extended deadlines interact with shared reveal;
- participant-visible saved/offline/reconnecting state and host-visible aggregate room health;
- bounded, text-first low-bandwidth payloads and current-state recovery;
- no correctness or hidden metadata cached before it is authorized for that role and phase.

### Epic C — Recovery Pack

**User job:** “Give me a tested sequence, not a pile of unrelated questions.”

MVP acceptance:

- versioned diagnostic, intervention card, linked recheck, concepts, misconceptions, and citations;
- reusable immutable snapshot with source/version attribution and an explicit update review;
- insertion into Round, Presentation, practice, and companion surfaces;
- lossless OpenRound JSON and explicit QTI/CSV limitations;
- no automatic mutation of existing drafts or published versions.

### Epic D — Question Health Lab

**User job:** “Tell me whether the question—not only the learner—may be the problem.”

MVP acceptance:

- deterministic preflight rules with a reason, severity, and exact field/action;
- aggregate post-use observations only after a documented sample threshold;
- compare only compatible item versions/cohorts and show instability rather than hiding it;
- one-click create-revision workflow with undo and a before/after diff;
- author can dismiss a flag with a bounded reason; no automatic publishing or learner judgment.

### Epic E — Delayed Recovery Trail

**User job:** “Show whether the concept still holds later, without forcing accounts.”

MVP acceptance:

- different but concept-matched delayed probe with immutable source relation;
- expiring/revocable generic and labelled accountless access;
- evidence-level labels for revote, immediate linked recheck, delayed probe, and application prompt;
- completion/attrition and exact numerator/denominator;
- retention/delete/export behavior consistent with the source and the selected trust mode.

### Epic F — Two trust modes

**Learning mode:** accountless, session-scoped identity, aggregate-first reports, no attendance or
grade claim, and no participant-level cross-session profile.

**Verified mode:** institution-controlled identities, explicit learner disclosure, roster/grade
contracts, access audit, deletion/appeal behavior, and separate enablement. Identity mode is frozen
when a session or assignment is created.

## Architecture implications

| Capability               | Reuse first                                                              | Additive change                                                         | Safety rule                                                           |
| ------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Companion                | Host command controller, scoped credentials, presenter/embed projections | Companion role projection, overlay state, optional session-only item    | Never create a parallel game engine or bypass command fencing         |
| Presentation reliability | Socket.IO, snapshots, receipts, sequence journal, report reconciliation  | Presentation event adapters and complete reconnect/browser coverage     | Preserve server authority and role filtering                          |
| Recovery Pack            | Immutable quiz/presentation versions, citations, imports/exports         | Pack schema/version, item relationship roles, update-review metadata    | Published content is immutable                                        |
| Question Health          | Report aggregates, confidence, response time, version IDs                | Versioned quality observations and rule outcomes; async aggregation     | No individual ability score or automatic content rewrite              |
| Delayed trail            | Practice/follow-up attempts, access hashes, expiry, revocation           | Relation type and evidence window for delayed probes; decision timeline | No participant email/account required; show attrition                 |
| Concept Health           | Concept keys, versioned reports, retention, RLS                          | Thresholded workspace aggregates or asynchronously built summaries      | Minimum samples, bounded filters, no guest-level longitudinal profile |
| Verified mode            | OIDC/LTI foundation, audit, regional/retention controls                  | NRPS/AGS, identity-mode stamp, roster link, delivery idempotency        | Contract-gated and structurally separate from Learning mode           |

Use expand-and-contract migrations and schema versions. A completed session must always be
renderable from its frozen content, rules, theme, trust mode, response schema, and report version.

Keep AI out of the server-authoritative live decision path. It may draft a Recovery Pack, group
moderator-visible open text in a future experiment, or suggest a post-session revision, but:

- participant answers must not be sent to a provider by default;
- every provider boundary needs an explicit data-purpose and retention review;
- generated material remains a draft;
- deterministic fallback remains available to self-hosted and provider-disabled deployments; and
- the host—not an opaque model—chooses the intervention.

## Validation program

### Who to recruit

- Six higher-education instructors: at least three concept-heavy STEM/health and three other
  disciplines, including one class above 100 participants.
- Six workplace facilitators: technical, safety, compliance, or product training, excluding a
  workflow that legally requires certification until Verified mode exists.
- At least six participants who use accessibility accommodations or assistive technology.
- Two instructional technologists/LMS administrators and two accessibility, privacy, procurement,
  or security stakeholders.

### Test real work, not preference lists

Ask each facilitator to bring the most recent session artifact and complete these tasks:

1. Turn one existing concept into a diagnostic and different recheck.
2. Run it beside the actual deck or material.
3. Respond to a deliberately split or confidently wrong room.
4. Find what remains unresolved in the report.
5. Create and distribute an accountless delayed probe.
6. Decide whether they would replace their current tool, add OpenRound beside it, or not use it.

Measure preparation time, context switches, join/save/reconnect failures, time from lock to action,
intervention-to-recheck completion, report retrieval, delayed-probe completion, second-session use,
and willingness to pay. Keep participant content and identity out of repository evidence files.

### Decision gates

| Hypothesis                                    | Evidence to continue                                                                              | If it fails                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| “What next?” is a recurring pain              | At least 8/12 facilitators describe it unprompted or from a recent example                        | Reframe toward authoring quality or a narrower vertical before more recovery features |
| Companion removes adoption friction           | At least 80% launch and return uncoached; at least half prefer it to rebuilding a deck            | Keep deep links/import only; do not build native add-ins                              |
| Recovery Pack saves preparation               | Median preparation falls by at least 30% without a higher correction/invalid-item rate            | Simplify the pack and improve examples rather than adding AI breadth                  |
| Question Health produces trusted advice       | At least 70% of reviewed flags are useful and lead to a retained revision or deliberate dismissal | Remove weak rules; never mask false positives with an overall score                   |
| Delayed evidence changes a decision           | At least half of pilot facilitators act on the result and completion is at least 40%              | Keep manual follow-up links; defer scheduling and longitudinal views                  |
| Cross-session Concept Health is interpretable | Users identify the unresolved concept and explain limitations in under 45 seconds                 | Return to per-session reports and improve concept metadata                            |
| A vertical justifies identified mode          | Two named institutions require it for paid pilots and accept the privacy/contract model           | Keep Learning mode anonymous and defer NRPS/AGS                                       |

## Product and business measures

### North-star workflow measure

**Weekly returning facilitators completing at least one evidence-complete recovery loop.** An
evidence-complete loop contains an initial diagnostic, a recorded intervention, a valid linked
recheck answered by a sufficient sample, and a viewed reconciled report.

Track the eligible-session completion percentage underneath it. The returning-facilitator measure
combines the intended workflow with repeat value; neither measure rewards a high recovery rate,
which could be gamed with easy rechecks.

### Outcome measures

- Time from lock to an understood next action.
- Share of high-confidence misconception signals followed by a relevant action.
- Immediate linked-recheck recovery with numerator, denominator, and sample warning.
- Delayed-probe completion, retained understanding, and attrition.
- Percentage of unresolved concepts that receive a follow-up.
- Four-week facilitator repeat use and Recovery Pack reuse.
- Question Health flag usefulness, revision rate, and later stability.
- Create-from-source correction rate, citation validity, latency, and provider cost.

### Reliability and trust measures

- Valid join completion and first-response completion without help.
- Durable answer receipt p95/p99, reconnect success, and report reconciliation.
- Participant/device/network failures by supported profile.
- Critical/serious accessibility defects and manual assistive-technology completion.
- Retention/deletion backlog, access expiry, moderation response, and privacy incidents.
- Support contacts and facilitator recoverability during a live session.

Do not use time-on-product, raw question count, leaderboard activity, or recovery percentage alone
as the primary success measure.

## Packaging hypothesis

| Edition     | Direction after evidence                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Community   | Apache-2.0, operator-configured scale, core Recovery Packs/Trail and exports included; operator owns infrastructure/support     |
| Hosted Free | Target 50 participants, five published Rounds/Packs, core Recovery Loop, bounded reports and source authoring                   |
| Hosted Pro  | Target 250 participants, collaboration, companion controls, longer retention, exports, branding, assignments, and pack insights |
| Institution | Verified mode, SSO/LTI/roster/grade policy, region/retention/audit, accessibility/security package, support and contract        |

Do not paywall the basic recovery engine in Community or Hosted Free. Monetize team/admin workflow,
scale, integrations, retention, governance, support, and metered provider costs. Validate the
current price hypothesis with real willingness-to-switch interviews rather than matching a
competitor's per-host price.

## Explicit deferrals

Do not schedule these without new evidence:

- a public content marketplace or creator commerce;
- a full slide editor, freeform design canvas, or template race;
- native PowerPoint/Google Slides add-ins before the companion proves demand;
- an arcade economy, collectibles, persistent learner avatars, or many game modes;
- generic AI chat or an opaque live AI facilitator that chooses interventions;
- open-text grading or a public word cloud before moderation, retention, and evaluation are proven;
- attendance/geolocation surveillance in private Learning mode;
- real-time coauthoring before version-aware pack reuse and Group lifecycle basics;
- native mobile apps;
- a 1,000-person single-event claim before a multi-host architecture and evidence exist; or
- K–12 institutional sales before child-privacy, roster, contracting, support, and counsel gates.

## Principal risks and controls

| Risk                                                   | Control                                                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Competitors converge on recovery language              | Differentiate on the integrated evidence chain, privacy model, deterministic decisions, portability, and transparent limits |
| Roadmap becomes another feature-parity list            | Cap the parity lane; every item needs observed job evidence and a maintained non-goal                                       |
| AI produces polished but invalid questions             | Source citations, Question Health, human approval, corpus evaluation, immutable versions, and measured correction rate      |
| Longitudinal views become learner surveillance         | Aggregate concepts, minimum cohorts, bounded filters, no guest profile, explicit Verified mode                              |
| Recovery is mistaken for causality or lasting learning | Distinguish revote/recheck/delayed evidence, show attrition, and use careful language                                       |
| Slide integration destabilizes live sessions           | Browser companion first, scoped credentials, mature realtime path, fallback controls, and observed-device tests             |
| Institution work consumes the roadmap                  | Require two named paid-pilot partners and run it as a separate conditional lane                                             |
| Large files and coupled contracts slow safe change     | Split touched boundaries, preserve shared contracts, add compatibility fixtures, and avoid parallel engines                 |
| Higher free limits create support or abuse exposure    | Target-host load/cost/abuse/support evidence before public cap changes                                                      |

## Sources

### OpenRound evidence

- [Current implementation](../README.md)
- [Product and experience design](design.md)
- [User guide](user-guide.md)
- [Implementation status](implementation-status.md)
- [Architecture](architecture.md)
- [Release-readiness ledger](release-readiness.json)
- [Beta usability evidence template](evidence/beta-usability.md)
- [Design-partner interview template](evidence/design-partner-interview.md)
- [Earlier competitive strategy](competitive-strategy-and-roadmap.md)
- [2026 Kahoot-alternatives UX plan](kahoot-alternatives-2026-ux-gap-plan.md)

### Current competitor and market material

- [Wooclap peer learning](https://www.wooclap.com/en/peer-learning/),
  [AI live facilitation](https://www.wooclap.com/en/ai-live-facilitator/), and
  [features](https://www.wooclap.com/en/features/)
- [Learning Catalytics groups and teams](https://help.pearsoncmg.com/learning_catalytics/instructor/en/Content/Topics/get_ready_to_deliver_lc/lc_groups.htm)
  and [module types](https://help.pearsoncmg.com/learning_catalytics/instructor/en/Content/Topics/assignment_creation/module_types/lc_modules.htm)
- [iClicker product](https://www.iclicker.com/) and
  [accessibility](https://www.iclicker.com/accessibility/)
- [Wayground plans](https://help.wayground.com/support/solutions/articles/158000403874-understanding-wayground-plans)
  and [accommodations](https://help.wayground.com/support/solutions/articles/158000404955-accommodations-available-on-wayground)
- [Vevox before/after comparisons](https://help.vevox.com/hc/en-us/articles/22996157485213-Create-before-and-after-comparisons)
  and [education plans](https://www.vevox.com/pricing/education-pricing)
- [Formative real-time instruction](https://www.formative.com/teachers) and
  [2026 follow-up features](https://www.formative.com/back-to-school)
- [Quizalize differentiation and follow-up](https://www.quizalize.com/)
- [Nearpod delivery modes](https://nearpod.com/how-nearpod-works/)
- [Pear Deck plans and accessibility](https://www.peardeck.com/pricing)
- [Kahoot! assessment workflow](https://kahoot.com/schools/assessment/) and
  [learning-science guidance](https://kahoot.com/blog/2026/03/18/kahoot-impact-the-science-of-learning-behind-every-kahoot-game/)
- [Mentimeter features](https://www.mentimeter.com/features),
  [Slido product](https://www.slido.com/product),
  [Poll Everywhere plans](https://www.polleverywhere.com/plans),
  [AhaSlides features](https://ahaslides.com/features/), and
  [ClassPoint](https://classpoint.io/)
- [Particify](https://www.particify.de/en/help/),
  [ClassQuiz self-hosting](https://www.classquiz.de/docs/self-host), and
  [Plickers device-free participation](https://help.plickers.com/hc/en-us/articles/360009395854-What-is-Plickers)

### User-needs and review evidence

- [Jisc 2024–25 higher-education student digital experience findings](https://digitalinsights.jisc.ac.uk/reports-and-briefings/our-reports/2024-25-uk-higher-education-students-digital-experience-insights-survey-findings/)
- [Mentimeter reviews](https://www.g2.com/products/mentimeter/reviews?qs=pros-and-cons),
  [Wooclap reviews](https://www.g2.com/products/wooclap/reviews),
  [Poll Everywhere reviews](https://www.g2.com/products/poll-everywhere/reviews), and
  [Slido reviews](https://www.g2.com/products/slido/reviews)
- [Accessibility in technology acquisition with HECVAT 4](https://er.educause.edu/articles/2025/4/accessibility-in-technology-acquisition-with-hecvat-4)
- [2025 workplace learning and development challenges](https://assets.trainingindustry.com/content/uploads/2025/04/Learning-and-Development-Challenges-Report-2025-Watermark-1.pdf)

### Learning and evaluation research

- [Peer discussion and confidence](https://pmc.ncbi.nlm.nih.gov/articles/PMC7145884/)
- [Peer discussion plus instructor explanation](https://pmc.ncbi.nlm.nih.gov/articles/PMC3046888/)
- [Retrieval practice in classroom settings](https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2019.00005/full)
- [Confidence/certainty-based formative assessment](https://pmc.ncbi.nlm.nih.gov/articles/PMC6544949/)
- [Displaying class results can bias a second vote](https://pubmed.ncbi.nlm.nih.gov/20516358/)
- [Generative-AI multiple-choice question quality evaluation](https://researchconnect.suny.edu/en/publications/an-effectiveness-study-of-generative-artificial-intelligence-tool/)
- [CDC training-effectiveness evaluation guidance](https://www.cdc.gov/training-development/php/about/evaluate-training-measuring-effectiveness.html)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
