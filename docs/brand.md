# Polling Pops brand and interface

Polling Pops is the public product name from October 7, 2026. It brings live polls,
interactive presentations, learning rounds, audience conversation, and recovery evidence
into one facilitator workspace. The tagline is **Make every voice pop.**

## Identity

The original lollipop mark combines a circular candy, a stick, and three rising poll bars.
The bars connect the playful identity to participation and evidence. Cream and yellow
strokes suggest candy ribbons; the small mint rays suggest an idea arriving.

The artwork is original repository SVG geometry. It uses no competitor logo, lettering,
flower badge, wrapper, illustration, or trademark. Project-created artwork is Apache-2.0.
See the [asset register](asset-register.md) for distribution details.

| Color         | Value     | Use                                                          |
| ------------- | --------- | ------------------------------------------------------------ |
| Berry         | `#AC2855` | Primary actions and selected navigation; supports white text |
| Pink          | `#F9688A` | Candy artwork and decorative accents                         |
| Cream         | `#FFF8EF` | Light canvas                                                 |
| Mint          | `#D8EEE3` | Decorative backgrounds                                       |
| Mint ink      | `#146552` | Readable mint controls and focus outlines                    |
| Butter yellow | `#FFC857` | Decorations; never white-text buttons                        |
| Plum          | `#39243C` | Logo outline, light-mode text, and presentation backgrounds  |

Use the shared `--ui-*` tokens for application surfaces and text. Dark mode uses plum
surfaces, light cream text, and pale berry controls with dark text. Status colors retain
their meaning. Rounded display type is reserved for the wordmark and landing headline;
editing controls and data use the existing readable system font stack.

## Assets

The source assets are in `apps/web/public/brand`:

- `polling-pops-mark.svg`: transparent standalone lollipop.
- `polling-pops-icon.svg`: cream-backed browser icon.
- `polling-pops-logo.svg` and `.png`: horizontal logo on a transparent background.
- `polling-pops-apple.png`: 180-pixel home-screen icon.
- `polling-pops-social.svg` and `.png`: 1200×630 share card.

Run `pnpm brand:assets` to regenerate the PNGs from their SVG masters. Display the
wordmark on a light surface; use the icon on a dark surface. The in-product `Brand`
component renders a decorative inline mark and one accessible product name. Workspace
organization branding keeps its organization name and initials.

## Experience rules

Candy Pop is the new signature preset (`pops`, version 1). New blank Rounds and
Presentations select it. General-category recommendations point to Candy Pop. Its motion
is calm and sound is off. All six earlier presets remain available with their original
versioned tokens; existing authored selections and frozen session themes are preserved.

Decorations surround the question rather than covering prompts, answers, codes, timers,
or reports. No new animation or sound is required. Reduced-motion, high-contrast,
keyboard, and screen-reader controls continue to take precedence over decorations.

The Recovery Loop remains Ask → Diagnose → Intervene → Recheck → Prove. Product nouns
such as Round, Presentation, Assignment, Recovery Pack, and Results retain their meaning.

## Compatibility and rollout

This is a public identity update. Existing `@openround/*` packages, environment variables,
cookies, browser resume keys, database names, migration checksums, API paths, export
format discriminators, QTI extension keys, metrics, and registry/repository locations
remain compatible. Download filenames use `polling-pops-`; native JSON still accepts and
emits the established `openround` format identifiers. Do not bulk-rename those identifiers.

Deploy the web and server images from the same release. Candy Pop adds the `pops` preset
identifier, which older clients and servers do not know. Refresh clients during promotion;
older images must not serve newly created Candy Pop content during a mixed-version rollout.

The original copyright attribution is preserved in LICENSE and NOTICE. SMTP sender
display names configured by an operator override the new default; update EMAIL_FROM
when promoting an existing deployment. Domains, GitHub repository names, image registry
paths, and DNS are separate operator changes, not prerequisites for this application update.

Set `OPENROUND_PUBLIC_URL` on the web process to the public product origin so social-card
URLs point to the deployed site. Local Compose supplies this automatically. The fallback
origin is localhost and is intended only for development, not public sharing.

The existing captioned help videos were recorded before the rebrand. They remain labeled
as earlier recordings and retain their original, audio-matched captions. New recording
scripts use Polling Pops; replacing those recordings also requires fresh screen captures.
