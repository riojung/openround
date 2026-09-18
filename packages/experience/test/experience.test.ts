import { describe, expect, it } from "vitest";
import { experiencePresets, presetForCategory, resolveExperienceTheme } from "../src/index.js";

describe("versioned experience presets", () => {
  it("ships one immutable accessible preset for every category", () => {
    expect(experiencePresets.map((preset) => preset.preset.id)).toStrictEqual([
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
});
