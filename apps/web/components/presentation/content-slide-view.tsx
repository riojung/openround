"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import type {
  ContentSlideLayout,
  ContentSlideRegion,
  ContentSlideTextElement,
} from "@openround/contracts";
import styles from "./content-slide-view.module.css";

export const contentSlideRegions: ContentSlideRegion[] = [
  "top_left",
  "top_center",
  "top_right",
  "middle_left",
  "middle_center",
  "middle_right",
  "bottom_left",
  "bottom_center",
  "bottom_right",
];

export const contentSlideRegionLabels: Record<ContentSlideRegion, string> = {
  top_left: "Top left",
  top_center: "Top center",
  top_right: "Top right",
  middle_left: "Middle left",
  middle_center: "Center",
  middle_right: "Middle right",
  bottom_left: "Bottom left",
  bottom_center: "Bottom center",
  bottom_right: "Bottom right",
};

type ContentSlideViewBlock = {
  layout: ContentSlideLayout;
  textElements: ContentSlideTextElement[];
};

interface ContentSlideViewProps {
  block: ContentSlideViewBlock;
  media?: ReactNode;
  variant: "editor" | "preview" | "live";
  selectedElementId?: string | null;
  titlePlaceholder?: string;
  bodyPlaceholder?: string;
  onSelectElement?: (elementId: string) => void;
  onChangeElement?: (elementId: string, text: string) => void;
  onMoveElement?: (elementId: string, region: ContentSlideRegion) => void;
}

interface AutosizingTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
}

function AutosizingTextarea(props: AutosizingTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const style = window.getComputedStyle(textarea);
    const borderHeight =
      (Number.parseFloat(style.borderTopWidth) || 0) +
      (Number.parseFloat(style.borderBottomWidth) || 0);
    textarea.style.height = `${textarea.scrollHeight + borderHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resize();
  }, [props.value, resize]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    let observedWidth = textarea.clientWidth;
    const resizeWhenWidthChanges = () => {
      const nextWidth = textarea.clientWidth;
      if (nextWidth === observedWidth) return;
      observedWidth = nextWidth;
      resize();
    };
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    const observer = new ResizeObserver(resizeWhenWidthChanges);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [resize]);

  return <textarea {...props} ref={textareaRef} />;
}

function orderedTextElements(elements: ContentSlideTextElement[]) {
  return [...elements].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
}

function textElementLabel(block: ContentSlideViewBlock, element: ContentSlideTextElement) {
  if (element.role === "title") return "Slide title";
  const index = block.textElements
    .filter((candidate) => candidate.role === "body")
    .findIndex((candidate) => candidate.id === element.id);
  return `Text box ${index + 1}`;
}

function adjacentRegion(region: ContentSlideRegion, key: string): ContentSlideRegion | null {
  const index = contentSlideRegions.indexOf(region);
  const row = Math.floor(index / 3);
  const column = index % 3;
  const nextRow = row + (key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0);
  const nextColumn = column + (key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0);
  if (nextRow < 0 || nextRow > 2 || nextColumn < 0 || nextColumn > 2) return null;
  return contentSlideRegions[nextRow * 3 + nextColumn] ?? null;
}

export function ContentSlideView({
  block,
  media,
  variant,
  selectedElementId = null,
  titlePlaceholder = "Give this moment a clear title",
  bodyPlaceholder = "Add the context your audience needs",
  onSelectElement,
  onChangeElement,
  onMoveElement,
}: ContentSlideViewProps) {
  const editing = variant === "editor";
  const elementsByRegion = new Map<ContentSlideRegion, ContentSlideTextElement[]>();
  for (const region of contentSlideRegions) elementsByRegion.set(region, []);
  for (const element of block.textElements) {
    elementsByRegion.get(element.region)?.push(element);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, region: ContentSlideRegion) {
    event.preventDefault();
    const elementId = event.dataTransfer.getData("text/plain");
    if (elementId) onMoveElement?.(elementId, region);
  }

  function handleMoveKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    element: ContentSlideTextElement,
  ) {
    if (!event.key.startsWith("Arrow")) return;
    const region = adjacentRegion(element.region, event.key);
    if (!region) return;
    event.preventDefault();
    onMoveElement?.(element.id, region);
  }

  return (
    <article
      className={`${styles.slide} ${styles[`layout_${block.layout}`]} ${styles[`variant_${variant}`]}`}
      data-layout={block.layout}
      lang="en-CA"
    >
      <div className={styles.regions}>
        {contentSlideRegions.map((region) => (
          <div
            aria-label={`${contentSlideRegionLabels[region]} region`}
            className={`${styles.region} ${styles[`region_${region}`]}`}
            data-region={region}
            key={region}
            onDragOver={editing ? (event) => event.preventDefault() : undefined}
            onDrop={editing ? (event) => handleDrop(event, region) : undefined}
            role="group"
          >
            {orderedTextElements(elementsByRegion.get(region) ?? []).map((element) => {
              const selected = editing && selectedElementId === element.id;
              const label = textElementLabel(block, element);
              return (
                <div
                  aria-label={`${label}, ${contentSlideRegionLabels[region]}`}
                  className={`${styles.textElement} ${
                    element.role === "title" ? styles.titleElement : styles.bodyElement
                  } ${selected ? styles.selectedElement : ""}`}
                  key={element.id}
                  onClick={editing ? () => onSelectElement?.(element.id) : undefined}
                  role="group"
                >
                  {editing ? (
                    <button
                      aria-label={`Move ${label}. Use arrow keys to change position.`}
                      className={styles.moveHandle}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", element.id);
                      }}
                      onFocus={() => onSelectElement?.(element.id)}
                      onKeyDown={(event) => handleMoveKeyDown(event, element)}
                      onMouseDown={() => onSelectElement?.(element.id)}
                      type="button"
                    >
                      ⠿
                    </button>
                  ) : null}
                  {editing ? (
                    element.role === "title" ? (
                      <AutosizingTextarea
                        aria-label="Slide title"
                        className={styles.titleInput}
                        lang={element.text.trim() ? "" : "en-CA"}
                        maxLength={160}
                        onChange={(event) => onChangeElement?.(element.id, event.target.value)}
                        onFocus={() => onSelectElement?.(element.id)}
                        placeholder={titlePlaceholder}
                        rows={Math.max(2, Math.min(4, Math.ceil(element.text.length / 10)))}
                        value={element.text}
                      />
                    ) : (
                      <AutosizingTextarea
                        aria-label={label}
                        className={styles.bodyInput}
                        lang={element.text.trim() ? "" : "en-CA"}
                        maxLength={4_000}
                        onChange={(event) => onChangeElement?.(element.id, event.target.value)}
                        onFocus={() => onSelectElement?.(element.id)}
                        placeholder={bodyPlaceholder}
                        rows={Math.max(2, Math.min(7, Math.ceil(element.text.length / 16) + 1))}
                        value={element.text}
                      />
                    )
                  ) : element.role === "title" ? (
                    <h1 lang={element.text ? "" : "en-CA"}>
                      {element.text || (variant === "preview" ? "Untitled slide" : "")}
                    </h1>
                  ) : element.text ? (
                    <p lang="">{element.text}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {media ? <div className={styles.media}>{media}</div> : null}
    </article>
  );
}
