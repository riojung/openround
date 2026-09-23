import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Brand, CreatorBrand, creatorLandingHref } from "./brand";

describe("Brand", () => {
  it("keeps the home link named when responsive styles hide the visible name", () => {
    const markup = renderToStaticMarkup(<Brand />);

    expect(markup).toContain('<span class="sr-only">OpenRound</span>');
    expect(markup).toContain('<span aria-hidden="true">OpenRound</span>');
    expect(markup).toContain('href="/"');
  });

  it("uses the configured organization name as the accessible name", () => {
    const markup = renderToStaticMarkup(<Brand name="Acme Learning" />);

    expect(markup).toContain('<span class="sr-only">Acme Learning</span>');
    expect(markup).toContain('<span aria-hidden="true">Acme Learning</span>');
  });

  it("routes creators only to workspace Home when that rollout is available", () => {
    const publicMarkup = renderToStaticMarkup(<Brand />);
    const betaMarkup = renderToStaticMarkup(
      <CreatorBrand productFeatures={{ workspaceShell: true }} />,
    );
    const legacyMarkup = renderToStaticMarkup(
      <CreatorBrand productFeatures={{ workspaceShell: false }} />,
    );
    const unresolvedMarkup = renderToStaticMarkup(<CreatorBrand />);

    expect(publicMarkup).toContain('href="/"');
    expect(betaMarkup).toContain('href="/home"');
    expect(legacyMarkup).toContain('href="/dashboard"');
    expect(unresolvedMarkup).toContain('href="/dashboard"');
  });

  it("fails closed to the legacy dashboard until workspace features resolve", () => {
    expect(creatorLandingHref(undefined)).toBe("/dashboard");
    expect(creatorLandingHref(null)).toBe("/dashboard");
    expect(creatorLandingHref({ workspaceShell: false })).toBe("/dashboard");
    expect(creatorLandingHref({ workspaceShell: true })).toBe("/home");
  });
});
