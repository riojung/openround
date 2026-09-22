"use client";

import type { ExperiencePresetId, RoundCategory } from "@openround/contracts";
import { experiencePresets, getExperiencePreset, presetForCategory } from "@openround/experience";
import { experienceThemeStyle } from "../lib/theme";
import { useLocale } from "./locale-provider";

export function ExperiencePicker({
  category,
  presetId,
  onCategoryChange,
  onPresetChange,
  showCategory = true,
}: {
  category: RoundCategory;
  presetId: ExperiencePresetId;
  onCategoryChange?: (category: RoundCategory) => void;
  onPresetChange: (preset: ExperiencePresetId) => void;
  showCategory?: boolean;
}) {
  const { t } = useLocale();
  const categoryLabel = (value: RoundCategory) => t(`live.experience.category.${value}`);
  const presetName = (id: ExperiencePresetId) => t(`live.experience.preset.${id}.name`);
  const selected = getExperiencePreset(presetId);
  const recommendation = presetForCategory(category);
  const preview = { ...selected, soundEnabled: false };

  return (
    <div className="experience-picker">
      <div className="experience-picker-controls">
        {showCategory ? (
          <label className="field">
            <span>{t("live.experience.categoryLabel")}</span>
            <select
              className="select"
              onChange={(event) => onCategoryChange?.(event.target.value as RoundCategory)}
              value={category}
            >
              {(
                [
                  "general",
                  "education",
                  "business",
                  "technical",
                  "safety_compliance",
                  "icebreaker",
                ] as const
              ).map((value) => (
                <option key={value} value={value}>
                  {categoryLabel(value)}
                </option>
              ))}
            </select>
            <small className="muted">{t("live.experience.categoryHelp")}</small>
          </label>
        ) : null}
        <label className="field">
          <span>{t("live.experience.presetLabel")}</span>
          <select
            className="select"
            onChange={(event) => onPresetChange(event.target.value as ExperiencePresetId)}
            value={presetId}
          >
            {experiencePresets.map((preset) => (
              <option key={preset.preset.id} value={preset.preset.id}>
                {presetName(preset.preset.id)} — {categoryLabel(preset.category)}
              </option>
            ))}
          </select>
          {recommendation !== presetId ? (
            <button
              className="text-button"
              onClick={() => onPresetChange(recommendation)}
              type="button"
            >
              {t("live.experience.useRecommended", {
                name: presetName(recommendation),
              })}
            </button>
          ) : (
            <small className="muted">
              {t("live.experience.recommendedFor", { category: categoryLabel(category) })}
            </small>
          )}
        </label>
      </div>
      <div
        aria-label={t("live.experience.previewAria", { name: presetName(presetId) })}
        className="experience-preview"
        data-corners={selected.tokens.corners}
        data-pattern={selected.tokens.pattern}
        data-typography={selected.tokens.typography}
        style={experienceThemeStyle(preview)}
      >
        <span className="status-pill">
          {t("live.experience.motion", {
            motion: t(`live.experience.motion.${selected.motion}`),
          })}
        </span>
        <h2 className="experience-preview-title">{presetName(presetId)}</h2>
        <p>{t(`live.experience.preset.${presetId}.description`)}</p>
        <div className="experience-choice-preview" aria-hidden="true">
          <span>A</span>
          <span>B</span>
          <span>C</span>
          <span>D</span>
        </div>
      </div>
    </div>
  );
}
