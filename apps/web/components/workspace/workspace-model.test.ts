import { describe, expect, it } from "vitest";
import {
  dashboardMessage,
  formatPercent,
  formatStarterCategory,
  prioritizeStartersForSegment,
  responseTypeLabel,
} from "./workspace-model";

describe("workspace model", () => {
  it("maps legacy dashboard query outcomes to a single status message", () => {
    expect(dashboardMessage(new URLSearchParams("welcome=1"))).toContain("Welcome");
    expect(dashboardMessage(new URLSearchParams("billing=success&welcome=1"))).toContain(
      "plan update",
    );
    expect(dashboardMessage(new URLSearchParams("invitation=accepted"))).toContain("accepted");
    expect(dashboardMessage(new URLSearchParams())).toBe("");
  });

  it("uses accessible labels for persisted response type values", () => {
    expect(responseTypeLabel("single_select")).toBe("Single choice");
    expect(responseTypeLabel("multi_select")).toBe("Multiple choice");
    expect(responseTypeLabel("numeric")).toBe("Number");
  });

  it("keeps insufficient evidence distinct from a zero percent result", () => {
    expect(formatPercent(null)).toBe("Not enough evidence");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(74.6)).toBe("75%");
  });

  it("prioritizes relevant starters without changing order inside either group", () => {
    const starters = [
      { id: "education-first", segment: "education" as const },
      { id: "shared-first", segment: "all" as const },
      { id: "workplace-first", segment: "workplace" as const },
      { id: "shared-second", segment: "all" as const },
      { id: "workplace-second", segment: "workplace" as const },
      { id: "education-second", segment: "education" as const },
    ];

    expect(prioritizeStartersForSegment(starters, "workplace").map(({ id }) => id)).toEqual([
      "shared-first",
      "workplace-first",
      "shared-second",
      "workplace-second",
      "education-first",
      "education-second",
    ]);
    expect(prioritizeStartersForSegment(starters, null)).toEqual(starters);
  });

  it("turns persisted starter categories into readable labels", () => {
    expect(formatStarterCategory("safety_compliance")).toBe("Safety Compliance");
    expect(formatStarterCategory("technical")).toBe("Technical");
  });
});
