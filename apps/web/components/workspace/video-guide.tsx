import Link from "next/link";
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
  tryHref,
  tryLabel,
}: VideoGuideProps) {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <article
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={styles.guide}
      id={id}
    >
      <div className={styles.heading}>
        <div className={styles.meta}>
          <span>Video guide</span>
          <span>Duration {duration}</span>
        </div>
        <h3 id={titleId}>{title}</h3>
        <p id={descriptionId}>{description}</p>
      </div>

      <video
        aria-label={`${title} video`}
        className={styles.video}
        controls
        height={720}
        playsInline
        poster={posterSrc}
        preload="none"
        width={1280}
      >
        <source src={videoSrc} type="video/mp4" />
        <track default kind="captions" label="English" src={captionsSrc} srcLang="en" />
        Your browser does not support embedded video. <a href={videoSrc}>Open the video file</a>.
      </video>

      <div className={styles.footer}>
        <details className={styles.transcript}>
          <summary>Read transcript for {title}</summary>
          <div className={styles.transcriptBody}>
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
