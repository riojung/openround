"use client";

import { useLayoutEffect } from "react";
import {
  applyColorMode,
  COLOR_MODE_APPLIED_EVENT,
  COLOR_MODE_CHANGE_EVENT,
  COLOR_MODE_STORAGE_KEY,
  normalizeColorModePreference,
  type ColorModeAppliedDetail,
  type ColorModePreference,
} from "../lib/color-mode";

function readPreference(): ColorModePreference {
  try {
    return normalizeColorModePreference(window.localStorage.getItem(COLOR_MODE_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function ColorModeSync() {
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const refresh = () => {
      const preference = readPreference();
      const resolved = applyColorMode(preference, media.matches, document.documentElement);
      window.dispatchEvent(
        new CustomEvent<ColorModeAppliedDetail>(COLOR_MODE_APPLIED_EVENT, {
          detail: { preference, resolved },
        }),
      );
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === COLOR_MODE_STORAGE_KEY) refresh();
    };

    refresh();
    media.addEventListener("change", refresh);
    window.addEventListener("storage", onStorage);
    window.addEventListener(COLOR_MODE_CHANGE_EVENT, refresh);
    return () => {
      media.removeEventListener("change", refresh);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(COLOR_MODE_CHANGE_EVENT, refresh);
    };
  }, []);

  return null;
}
