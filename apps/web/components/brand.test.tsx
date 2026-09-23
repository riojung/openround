import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Brand, CreatorBrand } from "./brand";

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

  it("supports an authenticated home destination without changing the public default", () => {
    const publicMarkup = renderToStaticMarkup(<Brand />);
    const authenticatedMarkup = renderToStaticMarkup(<CreatorBrand />);

    expect(publicMarkup).toContain('href="/"');
    expect(authenticatedMarkup).toContain('href="/home"');
  });
});
