#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
artifact_dir="$repo_dir/artifacts/openround-demo"
raw_dir="$artifact_dir/raw"
rendered_dir="$artifact_dir/rendered"
audio_dir="$artifact_dir/audio"
ffmpeg_bin="${OPENROUND_FFMPEG:-/tmp/openround-video-tools/node_modules/ffmpeg-static/ffmpeg}"
edge_tts_bin="${OPENROUND_EDGE_TTS:-/tmp/openround-voice-tools/bin/edge-tts}"
presenter_voice="${OPENROUND_VOICE:-en-US-AvaMultilingualNeural}"

if [[ ! -x "$ffmpeg_bin" ]]; then
  echo "ffmpeg-static is missing. Install it with:" >&2
  echo "  npm install --prefix /tmp/openround-video-tools ffmpeg-static" >&2
  exit 1
fi

if [[ ! -x "$edge_tts_bin" ]]; then
  echo "The neural voice renderer is missing. Install it with:" >&2
  echo "  python3 -m venv /tmp/openround-voice-tools" >&2
  echo "  /tmp/openround-voice-tools/bin/pip install edge-tts" >&2
  exit 1
fi

mkdir -p "$rendered_dir" "$audio_dir"

chapters=(
  "01-product-promise"
  "02-author-and-launch"
  "03-participant-experience"
  "04-diagnose-and-intervene"
  "05-linked-recheck"
  "06-evidence-and-followup"
  "07-use-cases"
)

narrations=(
  "Hi, and welcome to OpenRound. Let me show you what makes it a little different from a typical live quiz. The goal isn't just to collect answers or rank a room. It's to notice where understanding breaks down, respond while everyone is still together, and then check whether that response actually helped. We call that the Recovery Loop: ask, diagnose, intervene, recheck, and prove."
  "Let's imagine I'm leading a short safety refresher. I sign in and create a checkpoint set about completion rates. For this question, I want more than the selected answer, so I require a confidence rating and tag the concept I'm checking. Seventy percent represents a common part-versus-whole mistake, so I add a private misconception label and feedback that participants will see only after reveal. Then I add a linked recheck using different numbers. That matters: later, I can see whether people transferred the idea, instead of simply changing their vote. Once everything is saved, I publish an immutable version, review the room defaults, and create the live session. OpenRound gives me a seven-digit code, a direct link, and a downloadable QR code, so people can join from the device already in their hand."
  "Now let's switch to Taylor's view. Taylor scans the QR code, or enters the code, and joins without creating an account. In education mode, OpenRound can replace the typed nickname with a friendly private alias. Taylor also has a question. It goes into the facilitator's moderation queue, and the reply appears here without interrupting the round. When the checkpoint opens, Taylor chooses seventy percent and says, very sure. That confidence signal is important: a confident wrong answer usually calls for a different response than a hesitant guess. OpenRound saves the response before the confirmation appears."
  "Back on the facilitator screen, all five people have answered. Four chose the same wrong answer, and they were confident about it. When I lock responses, OpenRound shows the exact measurement behind its suggestion: the sample size, participation, and correctness rate. This isn't an A.I. verdict. It's a transparent rule, and I still decide what makes sense for this group. I'll start with a brief peer discussion, then reveal the answer and explanation. I can also record that I gave a targeted explanation. Those interventions become part of the session timeline, so the report captures not only the outcome, but what I actually did before rechecking."
  "Now I open the linked recheck. The numbers have changed, but the concept hasn't. Taylor applies the completed-over-total relationship and chooses eighty percent. Improvement on a fresh example is stronger evidence than changing an answer on the original question. OpenRound supports both, but reports linked rechecks and revotes separately, so we don't overstate what happened."
  "Once the round finishes, the evidence is ready. Initial accuracy was twenty percent. Of the four people who started incorrect and answered both checkpoints, three recovered on the linked recheck. OpenRound shows that numerator and denominator, along with the small-sample warning, because this is useful session evidence, not proof of long-term learning. I can also inspect confidence versus correctness, the observed misconception, the intervention timeline, and the one concept that remains unresolved. From there, I can create a time-flex follow-up. Each participant gets a private, revocable link; there's also an anonymous option. If someone needs extra time, I can create a one-point-five or two-times accommodation pass without storing a medical reason or exposing it to the group."
  "So, where does this fit? University lectures are an obvious example, but the same pattern works for technical training, safety briefings, compliance refreshers, and certification review. Anywhere a facilitator needs to know what landed, and has time to do something about it, OpenRound can help. Participant accounts stay optional, the full Recovery Loop is available in every edition, and teams can use the hosted service or self-host the Apache-licensed Community edition. That's OpenRound: ask, diagnose, intervene, recheck, and prove. Thanks for watching."
)

duration_seconds() {
  local source="$1"
  local raw_duration
  raw_duration="$($ffmpeg_bin -i "$source" 2>&1 | sed -nE 's/.*Duration: ([0-9]+):([0-9]+):([0-9.]+),.*/\1 \2 \3/p' | head -1)"
  if [[ -z "$raw_duration" ]]; then
    echo "Could not determine media duration: $source" >&2
    exit 1
  fi
  awk -v duration="$raw_duration" 'BEGIN { split(duration, part, " "); print part[1] * 3600 + part[2] * 60 + part[3] }'
}

concat_file="$rendered_dir/concat.txt"
: > "$concat_file"

for index in "${!chapters[@]}"; do
  chapter="${chapters[$index]}"
  webm="$raw_dir/$chapter.webm"
  narration="$audio_dir/$chapter.mp3"
  rendered="$rendered_dir/$chapter.mp4"
  if [[ ! -f "$webm" ]]; then
    echo "Missing chapter recording: $webm" >&2
    exit 1
  fi
  "$edge_tts_bin" \
    --voice "$presenter_voice" \
    --rate=-3% \
    --pitch=-2Hz \
    --text "${narrations[$index]}" \
    --write-media "$narration"
  video_duration="$(duration_seconds "$webm")"
  narration_duration="$(duration_seconds "$narration")"
  pace_ratio="$(awk -v video="$video_duration" -v audio="$narration_duration" 'BEGIN { printf "%.6f", audio / video }')"
  "$ffmpeg_bin" -y \
    -i "$webm" \
    -i "$narration" \
    -filter_complex "[0:v]setpts=${pace_ratio}*PTS,scale=1920:1080:flags=lanczos,fps=30,format=yuv420p,tpad=stop_mode=clone:stop_duration=2[video];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[audio]" \
    -map "[video]" -map "[audio]" \
    -c:v libx264 -preset medium -crf 20 \
    -c:a aac -b:a 192k -ar 48000 \
    -shortest -movflags +faststart "$rendered"
  printf "file '%s'\n" "$rendered" >> "$concat_file"
done

silent_video="$rendered_dir/OpenRound_Product_Demo_without_captions.mp4"
"$ffmpeg_bin" -y -f concat -safe 0 -i "$concat_file" -c copy "$silent_video"

python3 "$repo_dir/scripts/demo/write-openround-captions.py" \
  --ffmpeg "$ffmpeg_bin" \
  --video "$silent_video" \
  --output "$artifact_dir/OpenRound_Product_Demo.srt"

"$ffmpeg_bin" -y \
  -i "$silent_video" \
  -i "$artifact_dir/OpenRound_Product_Demo.srt" \
  -map 0:v:0 -map 0:a:0 -map 1:0 \
  -c:v copy -c:a copy -c:s mov_text \
  -metadata:s:s:0 language=eng \
  -metadata:s:s:0 title="English" \
  -movflags +faststart \
  "$artifact_dir/OpenRound_Product_Demo.mp4"

echo "$artifact_dir/OpenRound_Product_Demo.mp4"
