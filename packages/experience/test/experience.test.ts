import { describe, expect, it } from "vitest";
import { colorContrastRatio, ExperienceThemeSnapshotSchema } from "@openround/contracts";
import {
  experiencePresets,
  getExperiencePreset,
  presetForCategory,
  resolveExperienceTheme,
} from "../src/index.js";

describe("versioned experience presets", () => {
  it("ships immutable accessible presets with a recommendation for every category", () => {
    expect(experiencePresets.map((preset) => preset.preset.id)).toStrictEqual([
      "pops",
      "focus",
      "campus",
      "studio",
      "blueprint",
      "signal",
      "spark",
    ]);
    expect(presetForCategory("technical")).toBe("blueprint");
    expect(Object.isFrozen(experiencePresets)).toBe(true);
    for (const preset of experiencePresets) {
      expect(Object.isFrozen(preset)).toBe(true);
      expect(Object.isFrozen(preset.tokens)).toBe(true);
      expect(Object.isFrozen(preset.tokens.choiceColors)).toBe(true);
    }
  });

  it("layers validated workspace brand colours without changing other tokens", () => {
    const resolved = resolveExperienceTheme({
      category: "business",
      soundEnabled: true,
      brandTheme: {
        organizationName: "Northern Learning",
        primaryColor: "#0B2239",
        accentColor: "#075E63",
      },
    });
    expect(resolved).toMatchObject({
      preset: { id: "studio", version: 1 },
      soundEnabled: true,
      tokens: { primary: "#0B2239", accent: "#075E63", pattern: "none" },
    });
  });

  it("does not enable unavailable sound cues", () => {
    expect(resolveExperienceTheme({ category: "general", soundEnabled: true }).soundEnabled).toBe(
      false,
    );
  });

  it("offers Candy Pop without replacing stored legacy preset tokens", () => {
    const current = resolveExperienceTheme({ category: "general" });
    expect(current.preset).toEqual({ id: "pops", version: 1 });
    expect(ExperienceThemeSnapshotSchema.safeParse(current).success).toBe(true);
    expect(current.motion).toBe("calm");
    expect(colorContrastRatio(current.tokens.mutedText, current.tokens.canvas)).toBeGreaterThan(
      4.5,
    );
    expect(colorContrastRatio(current.tokens.accent, "#FFFFFF")).toBeGreaterThan(4.5);

    const legacy = resolveExperienceTheme({ category: "general", presetId: "focus" });
    expect(legacy.preset).toEqual({ id: "focus", version: 1 });
    expect(legacy.tokens.canvas).toBe("#F7F4EC");
    expect(legacy.tokens).toEqual(getExperiencePreset("focus").tokens);
  });
});
