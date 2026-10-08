// Usage: EDGE_TTS=/path/to/venv/bin/edge-tts pnpm guides:render [--audio-only]
// Requires ffmpeg, ffprobe, Python 3, and Edge TTS (7.2.8 used for this release).
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { helpVideoScripts, type HelpVideoKey } from "../../apps/web/lib/help-video-scripts";

const root = process.cwd();
const artifacts = path.join(root, "artifacts/polling-pops-guides");
const audio = path.join(artifacts, "audio");
mkdirSync(audio, { recursive: true });
const stage = mkdtempSync(path.join(artifacts, "render-"));
const publicDirectory = path.join(root, "apps/web/public/guides");
const voice = process.env.GUIDE_VOICE ?? "en-US-AvaMultilingualNeural";
const edgeTts = process.env.EDGE_TTS ?? "edge-tts";
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const ffprobe = process.env.FFPROBE ?? "ffprobe";
const metadata: Partial<
  Record<
    HelpVideoKey,
    {
      duration: string;
      chapters: { title: string; start: number }[];
      scriptSha256: string;
      voice: string;
    }
  >
> = {};
const audioOnly = process.argv.includes("--audio-only");

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout;
}

function duration(filename: string) {
  const value = Number(
    run(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      filename,
    ]).trim(),
  );
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid duration: ${filename}`);
  return value;
}

function leadingBlankSeconds(filename: string) {
  const intervals: Array<{ start: number; end: number }> = [];
  for (const prefix of ["", "negate,"]) {
    const result = spawnSync(
      ffmpeg,
      [
        "-hide_banner",
        "-i",
        filename,
        "-t",
        "8",
        "-vf",
        `${prefix}blackdetect=d=0.04:pic_th=0.995:pix_th=0.02`,
        "-an",
        "-f",
        "null",
        "-",
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(`Cannot inspect recording: ${filename}`);
    for (const match of result.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) {
      intervals.push({ start: Number(match[1]), end: Number(match[2]) });
    }
  }
  let end = 0;
  for (const interval of intervals.sort((a, b) => a.start - b.start)) {
    if (interval.start > end + 0.12) break;
    end = Math.max(end, interval.end);
  }
  return end;
}

function timeLabel(value: number) {
  const seconds = Math.ceil(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function prepareNarration(guide: HelpVideoKey, scene: { id: string; narration: string }) {
  const stem = `${guide}-${scene.id}`;
  const speech = path.join(audio, `${stem}.mp3`);
  const subtitles = path.join(audio, `${stem}.srt`);
  const stamp = path.join(audio, `${stem}.sha256`);
  const hash = createHash("sha256").update(`${voice}|-3%|-2Hz|${scene.narration}`).digest("hex");
  if (
    !existsSync(speech) ||
    !existsSync(subtitles) ||
    !existsSync(stamp) ||
    readFileSync(stamp, "utf8") !== hash
  ) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        edgeTts,
        [
          "--voice",
          voice,
          "--rate=-3%",
          "--pitch=-2Hz",
          "--text",
          scene.narration,
          "--write-media",
          speech,
          "--write-subtitles",
          subtitles,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let errors = "";
      child.stderr.on("data", (chunk) => {
        errors += String(chunk);
      });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`Narration failed (${stem}): ${errors}`)),
      );
    });
    writeFileSync(stamp, hash);
  }
  console.log(`Narration ready: ${stem}`);
}

async function main() {
  if (!audioOnly) {
    const manifest = JSON.parse(
      readFileSync(path.join(artifacts, "raw/recording.json"), "utf8"),
    ) as { recordings: Record<string, string> };
    for (const guide of Object.keys(helpVideoScripts) as HelpVideoKey[]) {
      for (const scene of helpVideoScripts[guide]) {
        const filename = `${guide}-${scene.id}.webm`;
        const hash = createHash("sha256")
          .update(readFileSync(path.join(artifacts, "raw", filename)))
          .digest("hex");
        if (manifest.recordings[filename] !== hash)
          throw new Error(
            `Incomplete or modified recording: ${filename}. Run pnpm guides:capture again.`,
          );
      }
    }
  }
  const narrationJobs = (Object.keys(helpVideoScripts) as HelpVideoKey[]).flatMap((guide) =>
    helpVideoScripts[guide].map((scene) => ({ guide, scene })),
  );
  for (let index = 0; index < narrationJobs.length; index += 3) {
    await Promise.all(
      narrationJobs
        .slice(index, index + 3)
        .map(({ guide, scene }) => prepareNarration(guide, scene)),
    );
  }

  for (const guide of Object.keys(helpVideoScripts) as HelpVideoKey[]) {
    const clips: string[] = [];
    const captions: string[] = [];
    const chapters: { title: string; start: number }[] = [];
    let offset = 0;
    for (const scene of helpVideoScripts[guide]) {
      const stem = `${guide}-${scene.id}`;
      const speech = path.join(audio, `${stem}.mp3`);
      const subtitles = path.join(audio, `${stem}.srt`);
      if (audioOnly) continue;
      const raw = path.join(artifacts, "raw", `${stem}.webm`);
      if (!existsSync(raw))
        throw new Error(`Missing screen recording. Run pnpm guides:capture first: ${raw}`);
      const audioDuration = duration(speech);
      const clipDuration = audioDuration + 0.8;
      const trim = Math.min(leadingBlankSeconds(raw), Math.max(0, duration(raw) - 2));
      const videoDuration = duration(raw) - trim;
      const clip = path.join(stage, `${stem}.mp4`);
      // Retiming keeps actions in the narrated chapter; no change to the actual UI.
      run(ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(trim),
        "-i",
        raw,
        "-i",
        speech,
        "-filter_complex",
        `[0:v]setpts=${(audioDuration / videoDuration).toFixed(8)}*(PTS-STARTPTS),fps=30,scale=1280:720,setsar=1,tpad=stop_mode=clone:stop_duration=1[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=1[a]`,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-t",
        String(clipDuration),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",
        "-ac",
        "2",
        clip,
      ]);
      chapters.push({ title: scene.title, start: Math.round(offset * 1000) / 1000 });
      offset += duration(clip);
      clips.push(`file '${clip.replaceAll("'", "'\\''")}'`);
      captions.push(`${clip}\t${subtitles}`);
      console.log(`Rendered: ${stem}`);
    }
    if (audioOnly) continue;
    const filename =
      guide === "quickStart" ? "polling-pops-quick-start" : "polling-pops-user-guide";
    const manifest = path.join(stage, `${guide}-concat.txt`);
    const captionManifest = path.join(stage, `${guide}-captions.tsv`);
    const vtt = path.join(stage, `${filename}.vtt`);
    const output = path.join(stage, `${filename}.mp4`);
    const joined = path.join(stage, `${guide}-joined.mp4`);
    writeFileSync(manifest, clips.join("\n"));
    writeFileSync(captionManifest, captions.join("\n"));
    run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      manifest,
      "-c",
      "copy",
      joined,
    ]);
    run("python3", [
      path.join(root, "scripts/demo/write-guide-captions.py"),
      "--ffprobe",
      ffprobe,
      "--manifest",
      captionManifest,
      "--output",
      vtt,
    ]);
    const chapterFile = path.join(stage, `${guide}-chapters.ffmeta`);
    const escaped = (text: string) => text.replace(/[\\=;#\n]/g, (character) => `\\${character}`);
    writeFileSync(
      chapterFile,
      ";FFMETADATA1\n" +
        chapters
          .map(
            (chapter, index) =>
              `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(chapter.start * 1000)}\nEND=${Math.round((chapters[index + 1]?.start ?? offset) * 1000)}\ntitle=${escaped(chapter.title)}\n`,
          )
          .join("\n"),
    );
    // Native MP4 captions and WebVTT for the accessible browser track.
    run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      joined,
      "-i",
      vtt,
      "-f",
      "ffmetadata",
      "-i",
      chapterFile,
      "-map_metadata",
      "2",
      "-map_chapters",
      "2",
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-map",
      "1:0",
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-c:s",
      "mov_text",
      "-metadata:s:s:0",
      "language=eng",
      "-metadata",
      "title=Polling Pops — " + (guide === "quickStart" ? "Quick start" : "User guide"),
      "-metadata",
      "comment=Current interface; synthetic demonstration data; neural narration.",
      "-movflags",
      "+faststart",
      output,
    ]);
    const streams = JSON.parse(
      run(ffprobe, ["-v", "error", "-show_streams", "-of", "json", output]),
    ).streams as Array<{ codec_name: string; width?: number; height?: number }>;
    if (
      !streams.some(
        (stream) => stream.codec_name === "h264" && stream.width === 1280 && stream.height === 720,
      ) ||
      !streams.some((stream) => stream.codec_name === "aac") ||
      !streams.some((stream) => stream.codec_name === "mov_text")
    )
      throw new Error(`Unsupported playback streams: ${filename}`);
    run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-xerror", "-i", output, "-f", "null", "-"]);
    const poster = path.join(stage, `${filename}-poster.jpg`);
    // A later chapter gives a recognisable, useful poster instead of a sign-in screen.
    run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(chapters[guide === "quickStart" ? 5 : 1]!.start - 2),
      "-i",
      output,
      "-frames:v",
      "1",
      "-update",
      "1",
      "-q:v",
      "2",
      poster,
    ]);
    metadata[guide] = {
      duration: timeLabel(duration(output)),
      chapters,
      voice,
      scriptSha256: createHash("sha256")
        .update(JSON.stringify(helpVideoScripts[guide]))
        .digest("hex"),
    };
    console.log(`Verified ${filename}: ${metadata[guide]!.duration}`);
  }

  if (!audioOnly) {
    // Publish only after BOTH videos have passed a complete decode and stream check.
    for (const filename of ["polling-pops-quick-start", "polling-pops-user-guide"]) {
      for (const suffix of [".mp4", ".vtt", "-poster.jpg"])
        copyFileSync(
          path.join(stage, filename + suffix),
          path.join(publicDirectory, filename + suffix),
        );
    }
    writeFileSync(
      path.join(root, "apps/web/lib/help-video-metadata.json"),
      JSON.stringify(metadata, null, 2) + "\n",
    );
    console.log("Published both guides and generated chapter metadata.");
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
