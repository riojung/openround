import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatList, formatNumber, pluralCategory } from "./format";

const instant = new Date("2026-09-22T15:05:00.000Z");

describe("locale-aware formatting", () => {
  it("uses locale-specific number and percentage separators", () => {
    expect(formatNumber("en-CA", 1234.5)).not.toBe(formatNumber("de-DE", 1234.5));
    expect(formatNumber("fr-FR", 0.375, { style: "percent" })).toContain("38");
    expect(formatNumber("ja-JP", 1234)).toContain("1,234");
  });

  it("keeps timezone explicit while localizing date order", () => {
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    };
    const german = formatDate("de-DE", instant, options);
    const japanese = formatDate("ja-JP", instant, options);
    expect(german).not.toBe(japanese);
    expect(german).toContain("2026");
    expect(japanese).toContain("2026");
  });

  it("preserves time-of-day in date-time labels", () => {
    const options: Intl.DateTimeFormatOptions = {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    };
    expect(formatDateTime("en-CA", instant, options)).toMatch(/3:05|15:05/);
    expect(formatDateTime("de-DE", instant, options)).toMatch(/15:05|3:05/);
  });

  it("uses locale-specific list conjunctions", () => {
    expect(formatList("en-CA", ["Round", "Presentation"])).toContain("and");
    expect(formatList("es-ES", ["Round", "Presentación"])).toContain("y");
  });

  it("uses locale plural rules instead of English-only equality checks", () => {
    expect(pluralCategory("en-CA", 0)).toBe("other");
    expect(pluralCategory("fr-FR", 0)).toBe("one");
    expect(pluralCategory("ja-JP", 1)).toBe("other");
  });
});
