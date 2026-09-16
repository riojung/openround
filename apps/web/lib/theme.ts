import type { BrandTheme } from "@openround/contracts";
import type { CSSProperties } from "react";

type ThemeProperties = CSSProperties & {
  "--brand-primary"?: string;
  "--brand-accent"?: string;
};

export function liveThemeStyle(theme: BrandTheme | null | undefined): ThemeProperties | undefined {
  return theme
    ? {
        "--brand-primary": theme.primaryColor,
        "--brand-accent": theme.accentColor,
      }
    : undefined;
}
