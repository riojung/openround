import { describe, expect, it, vi } from "vitest";
import { helpFeatureGuides } from "../../../lib/help-feature-guides";
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
import Page, { generateStaticParams } from "./page";

describe("shareable written guide routes", () => {
  it("prerenders every registry route", () => {
    expect(generateStaticParams()).toEqual(helpFeatureGuides.map((guide) => ({ guide: guide.id })));
  });
  it("resolves promise-based route parameters", async () => {
    const page = await Page({ params: Promise.resolve({ guide: "audience-pulse" }) });
    expect(page.props.guide.id).toBe("audience-pulse");
  });
  it("returns not-found for unknown guides", async () => {
    await expect(Page({ params: Promise.resolve({ guide: "invalid-guide" }) })).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});
