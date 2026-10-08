# Asset and license register

| Asset                           | Origin                                          | License    | Distribution status                                             |
| ------------------------------- | ----------------------------------------------- | ---------- | --------------------------------------------------------------- |
| Polling Pops wordmark           | Original repository text and SVG treatment      | Apache-2.0 | SVG and transparent PNG in `apps/web/public/brand`              |
| Polling Pops lollipop/poll mark | Original SVG geometry, created for Polling Pops | Apache-2.0 | Inline component, transparent SVG, browser SVG, and 180px PNG   |
| Polling Pops social card        | Original SVG composition and project copy       | Apache-2.0 | SVG master and 1200×630 PNG; generated with `pnpm brand:assets` |
| Organization initials           | Original CSS and text treatment                 | Apache-2.0 | Retained for configured workspace organization names            |
| Interface icons                 | Original text/Unicode controls                  | Apache-2.0 | Included                                                        |
| Experience patterns             | Original CSS gradients and patterns             | Apache-2.0 | Included                                                        |
| Sound cues                      | Original Web Audio oscillator sequences         | Apache-2.0 | Generated at runtime; no audio files bundled                    |
| Demo quiz content               | Test-only original factual prompts              | Apache-2.0 | Included in tests                                               |

## Onboarding video guides

These existing recordings were created under the OpenRound name. The in-product help
page labels them as pre-rebrand recordings. Their original captions remain synchronized
with the audio; new captures and narration are required to replace the recordings.

| Asset                      | Source and author                                                                                       | License or terms                                                                                                                     | Modifications                                                                                                      | Distribution status                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Guide screen captures      | Original pre-rebrand OpenRound workspace captures with synthetic example content                        | Apache-2.0                                                                                                                           | Cropped by 60 pixels at the bottom, scaled and padded to 1280×720, then sequenced into the guides                  | Source frames included in `scripts/demo/assets/guides`                                          |
| Guide scripts and captions | Original pre-rebrand project copy derived from the product workflow                                     | Apache-2.0                                                                                                                           | Audio-matched WebVTT sidecars and English captions embedded in each MP4; future rendering scripts use Polling Pops | Scripts are in `scripts/demo/render-onboarding-guides.sh`; original WebVTT files remain bundled |
| Guide narration            | Original pre-rebrand narration synthesized with Microsoft Edge neural text to speech through `edge-tts` | Project-authored text and edited compilation: Apache-2.0; generated speech remains subject to the speech provider's applicable terms | Speech rate and pitch are adjusted, then audio is loudness-normalized and encoded as AAC                           | Included in the guide MP4 files; no standalone voice model is distributed                       |
| Guide videos and posters   | Original pre-rebrand captures, script, captions, and edited narration assembled by the project          | Apache-2.0 for the project-authored visual, text, caption, and editing work, subject to the narration terms above                    | H.264/AAC MP4 with English captions, plus a generated poster frame and sidecar WebVTT file                         | Included in `apps/web/public/guides`, labeled as earlier recordings                             |

Do not add copied competitor screenshots, shapes, sound cues, question libraries, logos, illustrations, fonts, or copy. Record every future asset's source, author, license, modification, and required attribution before merge.
