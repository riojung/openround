import type { QuestionDraft } from "@openround/contracts";
import type { QuestionUpdater } from "./types";

export type MediaEditorState = "idle" | "uploading" | "scanning";

export function MediaEditor({
  question,
  uxBeta,
  mediaUploadsEnabled,
  mediaState,
  mediaPreviewUrl,
  onRemoveImage,
  onUpdateQuestion,
  onUploadImage,
}: {
  question: QuestionDraft;
  uxBeta: boolean;
  mediaUploadsEnabled: boolean;
  mediaState: MediaEditorState;
  mediaPreviewUrl: string;
  onRemoveImage: () => void;
  onUpdateQuestion: QuestionUpdater;
  onUploadImage: (file: File | null) => void;
}) {
  return (
    <div className="media-editor">
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="media-alt">Optional instructional image</label>
        <input
          className="input"
          id="media-alt"
          maxLength={300}
          onChange={(event) =>
            onUpdateQuestion((item) => ({
              ...item,
              mediaAlt: event.target.value || null,
            }))
          }
          placeholder="Describe what the image teaches"
          value={question.mediaAlt ?? ""}
        />
        <label className={uxBeta ? undefined : "sr-only"} htmlFor="media-upload">
          Choose instructional image
        </label>
        <input
          accept="image/jpeg,image/png,image/webp"
          aria-describedby="media-help"
          disabled={!mediaUploadsEnabled || mediaState !== "idle"}
          id="media-upload"
          onChange={(event) => {
            onUploadImage(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
          type="file"
        />
        <small className="muted" id="media-help">
          {mediaUploadsEnabled
            ? "JPEG, PNG, or WebP up to 10 MB. Images are quarantined and scanned before use."
            : "New image uploads are disabled until this operator configures malware scanning."}
        </small>
        {mediaState !== "idle" ? (
          <span className="notice" role="status">
            {mediaState === "uploading" ? "Uploading to quarantine…" : "Checking image safety…"}
          </span>
        ) : null}
      </div>
      {mediaPreviewUrl ? (
        <div>
          <img
            alt={question.mediaAlt ?? ""}
            className="question-media"
            height={360}
            src={mediaPreviewUrl}
            width={640}
          />
          <button className="danger-link" onClick={onRemoveImage} type="button">
            Remove image
          </button>
        </div>
      ) : null}
    </div>
  );
}
