import { describe, expect, it } from "vitest";
import {
  applyColorMode,
  COLOR_MODE_BOOTSTRAP_SCRIPT,
  COLOR_MODE_STORAGE_KEY,
  normalizeColorModePreference,
  resolveColorMode,
} from "./color-mode";

describe("interface color mode", () => {
  it("fails closed to the system preference for unknown stored values", () => {
    expect(normalizeColorModePreference("sepia")).toBe("system");
    expect(normalizeColorModePreference(null)).toBe("system");
  });

  it("resolves explicit and system preferences", () => {
    expect(resolveColorMode("light", true)).toBe("light");
    expect(resolveColorMode("dark", false)).toBe("dark");
    expect(resolveColorMode("system", true)).toBe("dark");
    expect(resolveColorMode("system", false)).toBe("light");
  });

  it("applies both the resolved mode and retained preference", () => {
    const target = {
      dataset: {} as { colorMode?: string; colorModePreference?: string },
      style: { colorScheme: "" },
    };

    expect(applyColorMode("system", true, target)).toBe("dark");
    expect(target).toEqual({
      dataset: { colorMode: "dark", colorModePreference: "system" },
      style: { colorScheme: "dark" },
    });
  });

  it("bootstraps the same storage contract before hydration", () => {
    expect(COLOR_MODE_BOOTSTRAP_SCRIPT).toContain(COLOR_MODE_STORAGE_KEY);
    expect(COLOR_MODE_BOOTSTRAP_SCRIPT).toContain("prefers-color-scheme: dark");
    expect(COLOR_MODE_BOOTSTRAP_SCRIPT).toContain("dataset.colorMode");
  });
});
