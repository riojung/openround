"use client";

import { useEffect, useState } from "react";
import { unlockSoundCues } from "../lib/sound";

type Preferences = { highContrast: boolean; reducedMotion: boolean; muted: boolean };

const defaults: Preferences = { highContrast: false, reducedMotion: false, muted: true };

export function ExperiencePreferences() {
  const [preferences, setPreferences] = useState(defaults);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("openround:experience-preferences") ?? "null");
      if (saved && typeof saved === "object") setPreferences({ ...defaults, ...saved });
    } catch {
      setPreferences(defaults);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.openroundContrast = preferences.highContrast
      ? "high"
      : "theme";
    document.documentElement.dataset.openroundMotion = preferences.reducedMotion
      ? "reduced"
      : "theme";
    document.documentElement.dataset.openroundMuted = preferences.muted ? "true" : "false";
    localStorage.setItem("openround:experience-preferences", JSON.stringify(preferences));
  }, [preferences]);

  function update(update: Partial<Preferences>) {
    setPreferences((current) => ({ ...current, ...update }));
  }

  return (
    <details className="experience-preferences">
      <summary>Display &amp; sound</summary>
      <div>
        <label className="checkbox-field">
          <input
            checked={preferences.highContrast}
            onChange={(event) => update({ highContrast: event.target.checked })}
            type="checkbox"
          />
          High contrast
        </label>
        <label className="checkbox-field">
          <input
            checked={preferences.reducedMotion}
            onChange={(event) => update({ reducedMotion: event.target.checked })}
            type="checkbox"
          />
          Reduce motion
        </label>
        <label className="checkbox-field">
          <input
            checked={preferences.muted}
            onChange={(event) => {
              update({ muted: event.target.checked });
              if (!event.target.checked) void unlockSoundCues();
            }}
            type="checkbox"
          />
          Mute sound cues
        </label>
      </div>
    </details>
  );
}
