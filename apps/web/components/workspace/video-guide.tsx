"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef } from "react";
import { useLocale } from "../locale-provider";
import styles from "./video-guide.module.css";

export interface VideoGuideProps {
  id: string;
  title: string;
  description: string;
  duration: string;
  videoSrc: string;
  captionsSrc: string;
  posterSrc: string;
  transcript: readonly string[];
  chapters: readonly { title: string; start: number }[];
  tryHref: string;
  tryLabel: string;
}

export function VideoGuide({
  id,
  title,
  description,
  duration,
  videoSrc,
  captionsSrc,
  posterSrc,
  transcript,
  chapters,
  tryHref,
  tryLabel,
}: VideoGuideProps) {
  const { t } = useLocale();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<number | null>(null);

  const seekTo = useCallback((start: number) => {
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState === 0) {
      pendingSeek.current = start;
      video.preload = "metadata";
      video.load();
    } else {
      video.currentTime = start;
    }
  }, []);

  // Guide links request an exact published chapter. Loading it is explicit, but never autoplays.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("watch") !== id) return;
    const index = params.get("chapter");
    if (!index || !/^(0|[1-9]\d*)$/.test(index)) return;
    const chapter = chapters[Number(index)];
    if (chapter) seekTo(chapter.start);
  }, [chapters, id, seekTo]);

  return (
    <article
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={styles.guide}
      id={id}
    >
      <div className={styles.heading}>
        <div className={styles.meta}>
          <span>{t("pages.help.videoGuide")}</span>
          <span>{t("pages.help.duration", { duration })}</span>
        </div>
        <h3 id={titleId}>{title}</h3>
        <p id={descriptionId}>{description}</p>
      </div>

      <video
        aria-label={t("pages.help.videoLabel", { title })}
        className={styles.video}
        controls
        height={720}
        playsInline
        onLoadedMetadata={() => {
          if (pendingSeek.current !== null && videoRef.current) {
            videoRef.current.currentTime = pendingSeek.current;
            pendingSeek.current = null;
          }
        }}
        poster={posterSrc}
        preload="none"
        ref={videoRef}
        width={1280}
      >
        <source src={videoSrc} type="video/mp4" />
        <track default kind="captions" label="English" src={captionsSrc} srcLang="en" />
        {t("pages.help.videoUnsupported")} <a href={videoSrc}>{t("pages.help.openVideo")}</a>.
      </video>

      <ol className={styles.chapters} lang="en-CA">
        {chapters.map(({ start, title: chapterTitle }) => {
          const seconds = Math.floor(start);
          const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
          return (
            <li key={`${id}-${start}`}>
              <button onClick={() => seekTo(start)} type="button">
                <span className={styles.chapterTime}>{label}</span>
                <span>{chapterTitle}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className={styles.footer}>
        <details className={styles.transcript}>
          <summary>{t("pages.help.readTranscript", { title })}</summary>
          <div className={styles.transcriptBody} lang="en-CA">
            {transcript.map((paragraph, index) => (
              <p key={`${id}-transcript-${index}`}>{paragraph}</p>
            ))}
          </div>
        </details>
        <Link className="button" href={tryHref}>
          {tryLabel}
        </Link>
      </div>
    </article>
  );
}
