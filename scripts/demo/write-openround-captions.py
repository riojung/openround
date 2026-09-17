#!/usr/bin/env python3
"""Build chapter-level SRT captions from the rendered OpenRound demo."""

from __future__ import annotations

import argparse
import json
import subprocess
import textwrap
from pathlib import Path


CAPTIONS = [
    "Hi, and welcome to OpenRound. Let me show you what makes it a little different from a typical live quiz. The goal isn't just to collect answers or rank a room. It's to notice where understanding breaks down, respond while everyone is still together, and then check whether that response actually helped. We call that the Recovery Loop: ask, diagnose, intervene, recheck, and prove.",
    "Let's imagine I'm leading a short safety refresher. I sign in and create a checkpoint set about completion rates. For this question, I want more than the selected answer, so I require a confidence rating and tag the concept I'm checking. Seventy percent represents a common part-versus-whole mistake, so I add a private misconception label and feedback that participants will see only after reveal. Then I add a linked recheck using different numbers. That matters: later, I can see whether people transferred the idea, instead of simply changing their vote. Once everything is saved, I publish an immutable version, review the room defaults, and create the live session. OpenRound gives me a seven-digit code, a direct link, and a downloadable QR code, so people can join from the device already in their hand.",
    "Now let's switch to Taylor's view. Taylor scans the QR code, or enters the code, and joins without creating an account. In education mode, OpenRound can replace the typed nickname with a friendly private alias. Taylor also has a question. It goes into the facilitator's moderation queue, and the reply appears here without interrupting the round. When the checkpoint opens, Taylor chooses seventy percent and says, very sure. That confidence signal is important: a confident wrong answer usually calls for a different response than a hesitant guess. OpenRound saves the response before the confirmation appears.",
    "Back on the facilitator screen, all five people have answered. Four chose the same wrong answer, and they were confident about it. When I lock responses, OpenRound shows the exact measurement behind its suggestion: the sample size, participation, and correctness rate. This isn't an A.I. verdict. It's a transparent rule, and I still decide what makes sense for this group. I'll start with a brief peer discussion, then reveal the answer and explanation. I can also record that I gave a targeted explanation. Those interventions become part of the session timeline, so the report captures not only the outcome, but what I actually did before rechecking.",
    "Now I open the linked recheck. The numbers have changed, but the concept hasn't. Taylor applies the completed-over-total relationship and chooses eighty percent. Improvement on a fresh example is stronger evidence than changing an answer on the original question. OpenRound supports both, but reports linked rechecks and revotes separately, so we don't overstate what happened.",
    "Once the round finishes, the evidence is ready. Initial accuracy was twenty percent. Of the four people who started incorrect and answered both checkpoints, three recovered on the linked recheck. OpenRound shows that numerator and denominator, along with the small-sample warning, because this is useful session evidence, not proof of long-term learning. I can also inspect confidence versus correctness, the observed misconception, the intervention timeline, and the one concept that remains unresolved. From there, I can create a time-flex follow-up. Each participant gets a private, revocable link; there's also an anonymous option. If someone needs extra time, I can create a one-point-five or two-times accommodation pass without storing a medical reason or exposing it to the group.",
    "So, where does this fit? University lectures are an obvious example, but the same pattern works for technical training, safety briefings, compliance refreshers, and certification review. Anywhere a facilitator needs to know what landed, and has time to do something about it, OpenRound can help. Participant accounts stay optional, the full Recovery Loop is available in every edition, and teams can use the hosted service or self-host the Apache-licensed Community edition. That's OpenRound: ask, diagnose, intervene, recheck, and prove. Thanks for watching.",
]


def timestamp(seconds: float) -> str:
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{milliseconds:03}"


def caption_chunks(caption: str, words_per_caption: int = 11) -> list[str]:
    words = caption.split()
    return [
        "\n".join(textwrap.wrap(" ".join(words[index : index + words_per_caption]), width=48))
        for index in range(0, len(words), words_per_caption)
    ]


def probe_chapters(ffmpeg: Path, video: Path) -> list[float]:
    # ffmpeg-static does not bundle ffprobe. Read durations from the chapter MP4s using ffmpeg's
    # stderr, where every input reports a stable `Duration:` line.
    rendered = video.parent
    durations: list[float] = []
    for chapter in sorted(rendered.glob("[0-9][0-9]-*.mp4")):
        result = subprocess.run(
            [str(ffmpeg), "-i", str(chapter)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        marker = "Duration: "
        line = next((line for line in result.stderr.splitlines() if marker in line), "")
        raw = line.split(marker, 1)[1].split(",", 1)[0].strip()
        hours, minutes, seconds = raw.split(":")
        durations.append(int(hours) * 3600 + int(minutes) * 60 + float(seconds))
    return durations


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    durations = probe_chapters(args.ffmpeg, args.video)
    if len(durations) != len(CAPTIONS):
        raise SystemExit(
            f"Expected {len(CAPTIONS)} rendered chapters but found {len(durations)}: {json.dumps(durations)}"
        )

    blocks: list[str] = []
    start = 0.0
    caption_index = 1
    for duration, caption in zip(durations, CAPTIONS):
        chapter_end = start + duration
        chunks = caption_chunks(caption)
        word_counts = [len(chunk.replace("\n", " ").split()) for chunk in chunks]
        total_words = sum(word_counts)
        for chunk, word_count in zip(chunks, word_counts):
            end = min(chapter_end, start + duration * word_count / total_words)
            blocks.append(
                f"{caption_index}\n{timestamp(start)} --> {timestamp(end)}\n{chunk}\n"
            )
            caption_index += 1
            start = end
        start = chapter_end
    args.output.write_text("\n".join(blocks), encoding="utf-8")


if __name__ == "__main__":
    main()
