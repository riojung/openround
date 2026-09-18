"use client";

import type { ExperiencePresetId, RoundCategory } from "@openround/contracts";
import { experiencePresets, getExperiencePreset, presetForCategory } from "@openround/experience";
import { experienceThemeStyle } from "../lib/theme";

const categoryLabels: Record<RoundCategory, string> = {
  general: "General",
  education: "Education",
  business: "Business",
  technical: "Technical",
  safety_compliance: "Safety / compliance",
  icebreaker: "Icebreaker",
};

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
  const selected = getExperiencePreset(presetId);
  const recommendation = presetForCategory(category);
  const preview = { ...selected, soundEnabled: false };

  return (
    <div className="experience-picker">
      <div className="experience-picker-controls">
        {showCategory ? (
          <label className="field">
            <span>Round category</span>
            <select
              className="select"
              onChange={(event) => onCategoryChange?.(event.target.value as RoundCategory)}
              value={category}
            >
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <small className="muted">
              Category organizes the set and recommends an experience without changing your choice.
            </small>
          </label>
        ) : null}
        <label className="field">
          <span>Experience preset</span>
          <select
            className="select"
            onChange={(event) => onPresetChange(event.target.value as ExperiencePresetId)}
            value={presetId}
          >
            {experiencePresets.map((preset) => (
              <option key={preset.preset.id} value={preset.preset.id}>
                {preset.name} — {categoryLabels[preset.category]}
              </option>
            ))}
          </select>
          {recommendation !== presetId ? (
            <button
              className="text-button"
              onClick={() => onPresetChange(recommendation)}
              type="button"
            >
              Use recommended {getExperiencePreset(recommendation).name}
            </button>
          ) : (
            <small className="muted">Recommended for {categoryLabels[category]}.</small>
          )}
        </label>
      </div>
      <div
        aria-label={`${selected.name} experience preview`}
        className="experience-preview"
        data-corners={selected.tokens.corners}
        data-pattern={selected.tokens.pattern}
        data-typography={selected.tokens.typography}
        style={experienceThemeStyle(preview)}
      >
        <span className="status-pill">{selected.motion} motion</span>
        <h3>{selected.name}</h3>
        <p>{selected.description}</p>
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
