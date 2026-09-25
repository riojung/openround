# Research prototype evaluation record

Use this template to evaluate the allowlisted Phase 0 Prototype Lab for Companion mode,
Question Health, and a delayed concept-matched probe. The lab is a read-only research instrument:
opening it, completing a task, or exporting its summary does not pass a product gate or authorize a
production rollout.

Do not record participant names, aliases, answers, room codes, access URLs, customer prompts,
answer choices, citations, free-text feedback, or other source material in this repository. Keep
consent, identities, recordings, and unredacted notes in the approved private research system. A
repository evidence reference may contain only a stable pseudonymous reference, checksum, or
reviewed redacted aggregate.

## Protocol and build

- Evaluation ID:
- Protocol version and frozen coding rules:
- Date/time (UTC):
- Build commit and image digest:
- Prototype evidence schema/rule versions:
- Browser, device, input method, and assistive technology:
- Feature flag and workspace-allowlist state:
- Acquisition segment (higher education/workplace):
- Stable pseudonymous partner, facilitator, and workflow IDs:
- Session/observation evidence reference, when paired with a real workflow:
- Research owner and moderator:
- Independent reviewer:

Before tasks begin, freeze the definitions of unassisted completion, material context-switch
interruption, useful finding, retained revision, deliberate dismissal, meaningfully different
probe, concept match, completion, and later facilitator action. Record deviations and failed
instrumentation; do not redefine a measure after viewing outcomes.

## Companion prototype

Use the facilitator's existing deck or meeting material. The browser prototype may demonstrate a
sidecar, join overlay, participant-safe results overlay, and one primary action. “Return to deck”
means closing the prototype overlay and returning to the sidecar; it does not mean that the browser
focused another desktop application.

- Facilitator is a repeat facilitator (yes/no/excluded) and prior evidence reference:
- External deck is part of the stable workflow (yes/no/excluded):
- Prepared interaction launched unassisted within two minutes (yes/no/excluded):
- Time to launch bucket (under 1 minute/1–2 minutes/over 2 minutes/not completed):
- Primary action found and completed unassisted (yes/no/excluded):
- Overlay closed and sidecar restored unassisted (yes/no/excluded):
- Facilitator returned to the external deck without coaching (yes/no/excluded):
- Material context-switch interruption occurred (yes/no/excluded) and evidence reference:
- Preferred prototype over rebuilding the interaction (yes/no/neutral/excluded):
- Keyboard-only, zoom/reflow, screen-reader status, reduced-motion, and representative-device
  results:
- Observation deviations, failures, or assistance:

Companion prototype results may inform workflow design. Phase 1 Companion remains ineligible until
the Phase 0 Access gate explicitly fails and independently reviewed observations show at least four
repeat facilitators using external decks plus at least two real sessions with a material
context-switch interruption.

## Question Health prototype

Evaluate actual draft or published questions with deterministic advisory rules. Schema and
accessibility blockers remain separate from advisory quality findings. Never apply a prototype
suggestion to customer content; record the facilitator's intended outcome only.

For every displayed finding, record exactly one usefulness disposition and one outcome in the
private research system. Do not omit false positives or findings the facilitator ignores.

- Real questions reviewed:
- Questions producing at least one finding:
- Findings reviewed:
- Findings with a final usefulness disposition / pending usefulness disposition:
- Useful findings:
- Not-useful findings:
- Pending/excluded findings and reasons:
- Findings with a final outcome disposition / pending outcome disposition:
- Findings resulting in an intended retained revision:
- Findings resulting in a deliberate dismissal:
- Findings with neither outcome:
- Finding ruleset version plus rule IDs and versions represented:
- Stable-ID/content-change behavior verified:
- Browser/server deterministic-equivalence result, if tested:
- Accessibility or mobile-overflow observations:
- Reviewed evidence reference/checksum:

Calculate usefulness as `useful findings / findings with a final useful or not-useful disposition`.
Calculate actionability as `(retained revision + deliberate dismissal) / findings with a final
outcome disposition`. Keep any dependent aggregate pending while an in-scope finding is pending.
Question Health may be selected for Phase 2 only when at least 70% of flags are useful across at
least 20 real questions and at least half produce a retained revision or deliberate dismissal.

## Delayed concept-matched probe prototype

The prototype is a preview and does not create, persist, or distribute an access link. A candidate
is eligible only when an independent reviewer confirms both that its prompt is meaningfully
different from the source item and that it shares at least one normalized concept key. A linked
item or copied concept label alone is not evidence of either condition.

- Eligible real pilot sessions:
- Sessions in which the concierge delayed check was offered:
- Sessions issuing the concierge check outside the prototype:
- Personal source-linked invitations/completions:
- Generic cohort-link invitations/completions:
- Completion interval (24 hours/7 days/facilitator-selected):
- Distinct-prompt review (accepted/rejected/pending) and evidence reference:
- Concept-match review (accepted/rejected/pending) and evidence reference:
- Attrition numerator/denominator by personal versus generic evidence kind:
- Facilitators changing a later action because of the result:
- Small-sample, equivalence, source-retention, or availability caveats shown:
- Reviewed evidence reference/checksum:

Never combine personal paired evidence with generic cohort evidence or describe either as causal or
as proof of durable learning. A production Recovery Trail remains ineligible until at least 30% of
eligible pilot sessions issue the concierge check, at least 50% of invited participants complete
it, and facilitators use the evidence to change a later action. Broader rollout still requires at
least 40% completion and half of facilitators acting on the result.

## Export and privacy review

- Export schema/version:
- Export checksum and approved private-system location:
- Export contains only bounded enums, aggregate counts, rule IDs/versions, and duration buckets
  (pass/fail):
- Prompt, choice, rationale, citation, identifier, alias, URL, token, and free-text scan (pass/fail):
- Browser refresh clears all prototype observations (pass/fail):
- Network inspection confirms no prototype mutation or participant-answer request (pass/fail):
- Unexpected field, request, persistence, or disclosure and disposition:

Reject the record if prohibited content entered the export or if prototype state persisted beyond
the current browser page. Preserve the rejected disposition and remediation evidence.

## Independent decision

- In-scope tasks by final disposition (accepted/rejected/excluded/pending):
- Accessibility findings and severity:
- Privacy/security findings and severity:
- Prototype behavior to retain, revise, or remove:
- Evidence limitations:
- Research owner decision (accepted/rejected/pending): Pending
- Independent reviewer decision (accepted/rejected/pending): Pending

An accepted prototype evaluation supports further research only. Record Phase 1 branch selection
in the Phase 0 segment/branch decision after the ordered gates pass. Record a Phase 2 capability
decision only after its own frozen cohort, denominators, thresholds, and independent review pass.
