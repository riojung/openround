export const COLOR_MODE_STORAGE_KEY = "openround:color-mode";
export const COLOR_MODE_CHANGE_EVENT = "openround:color-mode-change";
export const COLOR_MODE_APPLIED_EVENT = "openround:color-mode-applied";

export type ColorModePreference = "light" | "dark" | "system";
export type ResolvedColorMode = "light" | "dark";

export interface ColorModeAppliedDetail {
  preference: ColorModePreference;
  resolved: ResolvedColorMode;
}

interface ColorModeTarget {
  dataset: {
    colorMode?: string;
    colorModePreference?: string;
  };
  style: {
    colorScheme: string;
  };
}

export function normalizeColorModePreference(value: unknown): ColorModePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveColorMode(
  preference: ColorModePreference,
  systemPrefersDark: boolean,
): ResolvedColorMode {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

export function applyColorMode(
  preference: ColorModePreference,
  systemPrefersDark: boolean,
  target: ColorModeTarget,
): ResolvedColorMode {
  const resolved = resolveColorMode(preference, systemPrefersDark);
  target.dataset.colorMode = resolved;
  target.dataset.colorModePreference = preference;
  target.style.colorScheme = resolved;
  return resolved;
}

export const COLOR_MODE_BOOTSTRAP_SCRIPT = `(function(){var k="${COLOR_MODE_STORAGE_KEY}";var p="system";try{p=localStorage.getItem(k)}catch(e){}if(p!=="light"&&p!=="dark"&&p!=="system")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";var r=document.documentElement;r.dataset.colorMode=d;r.dataset.colorModePreference=p;r.style.colorScheme=d})()`;
