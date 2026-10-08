import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import metadata from "./help-video-metadata.json";
import { helpVideoScripts, type HelpVideoKey } from "./help-video-scripts";

function seconds(timestamp: string) {
  return timestamp.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

describe("bundled Polling Pops video guidance", () => {
  for (const key of Object.keys(helpVideoScripts) as HelpVideoKey[]) {
    it(`${key} has synchronized chapters, readable captions, and fast-start media`, () => {
      const guide = metadata[key];
      expect(guide.scriptSha256).toBe(
        createHash("sha256").update(JSON.stringify(helpVideoScripts[key])).digest("hex"),
      );
      const filename =
        key === "quickStart" ? "polling-pops-quick-start" : "polling-pops-user-guide";
      const base = new URL(`../public/guides/${filename}`, import.meta.url);
      expect(seconds(guide.duration)).toBeGreaterThan(60);
      expect(guide.chapters.map((chapter) => chapter.title)).toEqual(
        helpVideoScripts[key].map((scene) => scene.title),
      );
      expect(guide.chapters[0]!.start).toBe(0);
      for (const [index, chapter] of guide.chapters.entries()) {
        expect(chapter.start).toBeLessThan(seconds(guide.duration));
        if (index) expect(chapter.start).toBeGreaterThan(guide.chapters[index - 1]!.start);
      }
      const captions = readFileSync(new URL(`${base.href}.vtt`), "utf8");
      expect(captions.startsWith("WEBVTT")).toBe(true);
      expect(captions).toContain("Polling Pops");
      expect(captions).not.toContain("OpenRound");
      const times = [
        ...captions.matchAll(/(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/g),
      ];
      expect(times.length).toBeGreaterThan(40);
      let previousEnd = 0;
      for (const cue of times) {
        const start = seconds(cue[1]!);
        const end = seconds(cue[2]!);
        expect(start).toBeGreaterThanOrEqual(previousEnd - 0.002);
        expect(end).toBeGreaterThan(start);
        expect(end).toBeLessThanOrEqual(seconds(guide.duration));
        previousEnd = end;
      }
      const media = readFileSync(new URL(`${base.href}.mp4`));
      expect(media.toString("ascii", 4, 8)).toBe("ftyp");
      expect(media.indexOf("moov")).toBeGreaterThan(0);
      expect(media.indexOf("moov")).toBeLessThan(media.indexOf("mdat"));
      expect(readFileSync(new URL(`${base.href}-poster.jpg`)).length).toBeGreaterThan(10_000);
    });
  }
});
