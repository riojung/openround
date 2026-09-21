#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
asset_dir="$repo_dir/scripts/demo/assets/guides"
artifact_dir="$repo_dir/artifacts/onboarding-guides"
public_dir="$repo_dir/apps/web/public/guides"
ffmpeg_bin="${OPENROUND_FFMPEG:-}"
ffprobe_bin="${OPENROUND_FFPROBE:-}"
edge_tts_bin="${OPENROUND_EDGE_TTS:-/tmp/openround-voice-tools/bin/edge-tts}"
presenter_voice="${OPENROUND_VOICE:-en-US-AvaMultilingualNeural}"

if [[ -z "$ffmpeg_bin" ]]; then
  ffmpeg_bin="$(command -v ffmpeg 2>/dev/null || true)"
fi
if [[ -z "$ffprobe_bin" ]]; then
  ffprobe_bin="$(command -v ffprobe 2>/dev/null || true)"
fi

missing_media_tools=()
if [[ -z "$ffmpeg_bin" || ! -x "$ffmpeg_bin" ]]; then
  missing_media_tools+=("ffmpeg")
fi
if [[ -z "$ffprobe_bin" || ! -x "$ffprobe_bin" ]]; then
  missing_media_tools+=("ffprobe")
fi
if (( ${#missing_media_tools[@]} > 0 )); then
  printf 'Required media tool(s) missing or not executable: %s\n' "${missing_media_tools[*]}" >&2
  echo "Install ffmpeg and ffprobe, or set OPENROUND_FFMPEG and OPENROUND_FFPROBE to executable paths." >&2
  exit 1
fi

if [[ ! -x "$edge_tts_bin" ]]; then
  echo "The neural voice renderer is missing. Install it with:" >&2
  echo "  python3 -m venv /tmp/openround-voice-tools" >&2
  echo "  /tmp/openround-voice-tools/bin/pip install edge-tts" >&2
  exit 1
fi

mkdir -p "$artifact_dir" "$public_dir"

published_files=(
  "openround-quick-start.mp4"
  "openround-quick-start.vtt"
  "openround-quick-start-poster.jpg"
  "openround-builder-guide.mp4"
  "openround-builder-guide.vtt"
  "openround-builder-guide-poster.jpg"
)
publish_staging_dir="$(mktemp -d "$repo_dir/apps/web/public/.guides-stage.XXXXXX")"
publish_backup_dir=""
publish_in_progress=0
publish_complete=0

cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  set +e

  if (( publish_in_progress == 1 && publish_complete == 0 )) && [[ -n "$publish_backup_dir" ]]; then
    for filename in "${published_files[@]}"; do
      if [[ -f "$publish_backup_dir/$filename" ]]; then
        mv -f "$publish_backup_dir/$filename" "$public_dir/$filename"
      elif [[ -f "$publish_backup_dir/$filename.absent" ]]; then
        rm -f "$public_dir/$filename"
      fi
    done
  fi

  if [[ -n "$publish_staging_dir" && -d "$publish_staging_dir" ]]; then
    rm -rf "$publish_staging_dir"
  fi
  if [[ -n "$publish_backup_dir" && -d "$publish_backup_dir" ]]; then
    rm -rf "$publish_backup_dir"
  fi

  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

quick_frames=(
  "01-workspace.png"
  "02-round-start.png"
  "03-round-builder.png"
  "03-round-builder.png"
  "07-question-preview.png"
)

quick_narrations=(
  "Welcome to OpenRound. Your workspace keeps Rounds, Presentations, Sessions, Assignments, Results, Discover, and Groups together. Use Create whenever you are ready to begin."
  "For a new Round, choose a starter, bring a trusted source, import structured work, or start blank. Every route creates a reviewable draft. Nothing publishes automatically."
  "The Round Builder keeps the question map, direct-edit canvas, and inspector in view. Write the prompt and answers, mark the correct response, then use Diagnose to require confidence and tag the concepts you want to measure."
  "Use Recover to add a fresh recheck. OpenRound links the diagnostic and recheck so reports can show whether understanding improved after support. Resolve the readiness items and wait for Saved."
  "Preview the learner experience, publish the exact saved revision, then return to Library to host live or assign the Round for account-free practice. You are ready to try it."
)

builder_frames=(
  "01-workspace.png"
  "02-round-start.png"
  "03-round-builder.png"
  "03-round-builder.png"
  "04-presentation-start.png"
  "05-presentation-builder.png"
  "06-slide-preview.png"
  "07-question-preview.png"
  "01-workspace.png"
)

builder_narrations=(
  "OpenRound is organized around a professional workspace. Home summarizes active work. Library holds Rounds and Presentations. Sessions and Assignments track delivery, Results collects evidence, and Groups supports facilitator collaboration. Universal search and Create stay available from the header."
  "Creating a Round begins with one clear choice. Use a Recovery starter for speed, a trusted document for source-grounded proposals, a structural import for existing work, or a blank canvas for full control. Source and import results remain drafts until a person reviews them."
  "The Builder has three working areas. The map on the left shows order, type, readiness, and recovery relationships. The central canvas is where you edit the prompt and responses directly. The inspector on the right holds settings that should not compete with the content. Autosave, undo, preview, and publish remain in the command bar."
  "Build controls timing, points, and the explanation shown after reveal. Diagnose captures purpose, required or optional confidence, concept keys, and misconception feedback. Recover creates a fresh recheck and pairs it with the diagnostic question. The readiness panel links every blocker back to the field that needs attention."
  "Presentations have their own grounded starting methods. Bring a trusted PDF, Word document, PowerPoint deck, or pasted text; choose a facilitation starter; or begin with a blank Presentation. The conversion is structured and responsive rather than a promise of pixel-perfect slide reproduction."
  "Inside the Presentation Builder, content slides and interactive questions share one ordered map. Content blocks expose layout, media, notes, and accessibility controls. Question blocks reuse the same Build, Diagnose, and Recover model as a Round. You can also insert independent question copies from a published Round."
  "Preview moves through the authored sequence. Content slides communicate context but are never treated as evidence of learning. The facilitator controls when to advance and when to launch an interaction."
  "Interactive blocks switch to a participant-safe view. Learners see the prompt and choices, while answer keys, private notes, citations marked private, and facilitator metadata stay out of participant projections until the appropriate reveal phase."
  "After publishing, use Sessions to host live, Assignments for account-free Round practice, and Results to review response and Recovery Loop evidence. Groups lets facilitator teams curate and schedule together without forcing learners to become workspace members."
)

duration_seconds() {
  "$ffprobe_bin" -v error -show_entries format=duration -of default=nw=1:nk=1 "$1"
}

render_guide() {
  local slug="$1"
  local frames=()
  local narrations=()
  case "$slug" in
    openround-quick-start)
      frames=("${quick_frames[@]}")
      narrations=("${quick_narrations[@]}")
      ;;
    openround-builder-guide)
      frames=("${builder_frames[@]}")
      narrations=("${builder_narrations[@]}")
      ;;
    *)
      echo "Unknown onboarding guide: $slug" >&2
      exit 1
      ;;
  esac
  local work_dir="$artifact_dir/$slug"
  local concat_file="$work_dir/concat.txt"
  local caption_manifest="$work_dir/captions.tsv"
  local silent_video="$work_dir/$slug-without-captions.mp4"
  local output_video="$publish_staging_dir/$slug.mp4"
  local output_captions="$publish_staging_dir/$slug.vtt"
  local output_poster="$publish_staging_dir/$slug-poster.jpg"

  rm -rf "$work_dir"
  mkdir -p "$work_dir"
  : > "$concat_file"
  : > "$caption_manifest"

  for index in "${!frames[@]}"; do
    local number
    number="$(printf '%02d' "$((index + 1))")"
    local frame="$asset_dir/${frames[$index]}"
    local audio="$work_dir/$number.mp3"
    local subtitles="$work_dir/$number.srt"
    local clip="$work_dir/$number.mp4"
    local narration="${narrations[$index]}"

    if [[ ! -f "$frame" ]]; then
      echo "Missing guide frame: $frame" >&2
      exit 1
    fi

    "$edge_tts_bin" \
      --voice "$presenter_voice" \
      --rate=-2% \
      --pitch=-2Hz \
      --text "$narration" \
      --write-media "$audio" \
      --write-subtitles "$subtitles"

    local audio_duration
    local clip_duration
    audio_duration="$(duration_seconds "$audio")"
    clip_duration="$(awk -v duration="$audio_duration" 'BEGIN { printf "%.3f", duration + 0.65 }')"

    "$ffmpeg_bin" -y \
      -loop 1 -framerate 30 -i "$frame" \
      -i "$audio" \
      -filter_complex \
        "[0:v]crop=iw:ih-60:0:0,scale=1280:720:force_original_aspect_ratio=decrease:flags=lanczos,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0xf4f7fa,setsar=1,format=yuv420p[video];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=0.65[audio]" \
      -map "[video]" -map "[audio]" \
      -t "$clip_duration" \
      -c:v libx264 -preset medium -crf 23 -r 30 \
      -c:a aac -b:a 128k -ar 48000 \
      -movflags +faststart \
      "$clip"

    # The concat manifest lives beside these controlled clip basenames. Keeping
    # paths relative avoids quoting failures when the checkout contains an
    # apostrophe or another character meaningful to the concat demuxer.
    printf "file '%s.mp4'\n" "$number" >> "$concat_file"
    printf "%s\t%s\n" "$clip" "$subtitles" >> "$caption_manifest"
  done

  "$ffmpeg_bin" -y -f concat -safe 0 -i "$concat_file" -c copy "$silent_video"

  python3 "$repo_dir/scripts/demo/write-guide-captions.py" \
    --ffprobe "$ffprobe_bin" \
    --manifest "$caption_manifest" \
    --output "$output_captions"

  "$ffmpeg_bin" -y \
    -i "$silent_video" \
    -i "$output_captions" \
    -map 0:v:0 -map 0:a:0 -map 1:0 \
    -c:v copy -c:a copy -c:s mov_text \
    -metadata:s:s:0 language=eng \
    -metadata:s:s:0 title="English" \
    -movflags +faststart \
    "$output_video"

  "$ffmpeg_bin" -y -ss 0.4 -i "$output_video" -frames:v 1 -update 1 -q:v 2 "$output_poster"
}

validate_outputs() {
  local slug
  local video
  local captions
  local poster
  local dimensions
  local video_codec
  local audio_codec
  local subtitle_codec

  for slug in "openround-quick-start" "openround-builder-guide"; do
    video="$publish_staging_dir/$slug.mp4"
    captions="$publish_staging_dir/$slug.vtt"
    poster="$publish_staging_dir/$slug-poster.jpg"

    if [[ ! -s "$video" || ! -s "$captions" || ! -s "$poster" ]]; then
      echo "Rendered guide output is missing or empty: $slug" >&2
      return 1
    fi

    dimensions="$("$ffprobe_bin" -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$video")"
    video_codec="$("$ffprobe_bin" -v error -select_streams v:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$video")"
    audio_codec="$("$ffprobe_bin" -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$video")"
    subtitle_codec="$("$ffprobe_bin" -v error -select_streams s:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$video")"

    if [[ "$dimensions" != "1280x720" || "$video_codec" != "h264" || "$audio_codec" != "aac" || "$subtitle_codec" != "mov_text" ]]; then
      echo "Rendered guide has unexpected streams: $slug ($dimensions, $video_codec, $audio_codec, $subtitle_codec)" >&2
      return 1
    fi
    if [[ "$(head -n 1 "$captions")" != "WEBVTT" ]]; then
      echo "Rendered guide captions are not valid WebVTT: $captions" >&2
      return 1
    fi

    # Decode the complete media instead of accepting a merely readable header.
    "$ffmpeg_bin" -v error -i "$video" -map 0:v:0 -map 0:a:0 -f null -
    "$ffmpeg_bin" -v error -i "$poster" -f null -
  done
}

publish_outputs() {
  local filename
  publish_backup_dir="$(mktemp -d "$repo_dir/apps/web/public/.guides-backup.XXXXXX")"

  # Capture the prior complete set before publishing. Each same-filesystem mv
  # is atomic; the EXIT/signal trap restores every prior file if one fails.
  for filename in "${published_files[@]}"; do
    if [[ -f "$public_dir/$filename" ]]; then
      cp -p "$public_dir/$filename" "$publish_backup_dir/$filename"
    else
      : > "$publish_backup_dir/$filename.absent"
    fi
  done

  publish_in_progress=1
  for filename in "${published_files[@]}"; do
    mv -f "$publish_staging_dir/$filename" "$public_dir/$filename"
  done
  publish_complete=1
  publish_in_progress=0

  rm -rf "$publish_backup_dir"
  publish_backup_dir=""
}

render_guide "openround-quick-start"
render_guide "openround-builder-guide"
validate_outputs
publish_outputs

echo "$public_dir/openround-quick-start.mp4"
echo "$public_dir/openround-builder-guide.mp4"
