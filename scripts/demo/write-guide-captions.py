#!/usr/bin/env python3
"""Create readable WebVTT captions for the narrated OpenRound onboarding guides."""

from __future__ import annotations

import argparse
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Segment:
    media: Path
    subtitles: Path
    duration: float


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


def timestamp(seconds: float) -> str:
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3_600_000)
    minutes, milliseconds = divmod(milliseconds, 60_000)
    seconds, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02}.{milliseconds:03}"


def media_duration(ffprobe: Path, media: Path) -> float:
    result = subprocess.run(
        [
            str(ffprobe),
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
            str(media),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def chunks(narration: str, max_words: int = 7, max_chars: int = 42) -> list[str]:
    words = narration.split()
    result: list[list[str]] = []
    current: list[str] = []
    for word in words:
        candidate = " ".join([*current, word])
        if current and (len(current) >= max_words or len(candidate) > max_chars):
            result.append(current)
            current = [word]
        else:
            current.append(word)
    if current:
        result.append(current)

    captions = [" ".join(chunk) for chunk in result]
    if len(result) > 1 and len(result[-1]) < 4:
        separator = " " if len(f"{captions[-2]} {captions[-1]}") <= max_chars else "\n"
        captions[-2:] = [f"{captions[-2]}{separator}{captions[-1]}"]

    return captions


def read_manifest(ffprobe: Path, manifest: Path) -> list[Segment]:
    segments: list[Segment] = []
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        media, subtitles = line.split("\t", 1)
        media_path = Path(media)
        segments.append(
            Segment(
                media=media_path,
                subtitles=Path(subtitles),
                duration=media_duration(ffprobe, media_path),
            )
        )
    return segments


def parse_srt_timestamp(value: str) -> float:
    hours, minutes, remainder = value.strip().replace(",", ".").split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(remainder)


def read_srt(path: Path) -> list[Cue]:
    cues: list[Cue] = []
    for block in re.split(r"\n\s*\n", path.read_text(encoding="utf-8-sig").strip()):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        timing_index = next((index for index, line in enumerate(lines) if " --> " in line), -1)
        if timing_index < 0:
            continue
        start_raw, end_raw = lines[timing_index].split(" --> ", 1)
        text = " ".join(lines[timing_index + 1 :]).strip()
        if text:
            cues.append(
                Cue(
                    start=parse_srt_timestamp(start_raw),
                    end=parse_srt_timestamp(end_raw),
                    text=text,
                )
            )
    return cues


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffprobe", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    segments = read_manifest(args.ffprobe, args.manifest)
    blocks = ["WEBVTT", ""]
    offset = 0.0
    for segment in segments:
        for source_cue in read_srt(segment.subtitles):
            captions = chunks(source_cue.text)
            character_counts = [len(caption.replace("\n", " ")) for caption in captions]
            total_characters = sum(character_counts)
            cue_start = offset + source_cue.start
            source_duration = source_cue.end - source_cue.start
            for caption, character_count in zip(captions, character_counts):
                cue_duration = source_duration * character_count / total_characters
                cue_end = min(offset + source_cue.end, cue_start + cue_duration)
                blocks.extend(
                    [
                        f"{timestamp(cue_start)} --> {timestamp(cue_end)}",
                        caption,
                        "",
                    ]
                )
                cue_start = cue_end
        offset += segment.duration

    args.output.write_text("\n".join(blocks), encoding="utf-8")


if __name__ == "__main__":
    main()
