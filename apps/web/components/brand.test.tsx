import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Brand } from "./brand";

describe("Brand", () => {
  it("keeps the home link named when responsive styles hide the visible name", () => {
    const markup = renderToStaticMarkup(<Brand />);

    expect(markup).toContain('aria-label="OpenRound"');
    expect(markup).toContain('href="/"');
  });

  it("uses the configured organization name as the accessible name", () => {
    const markup = renderToStaticMarkup(<Brand name="Acme Learning" />);

    expect(markup).toContain('aria-label="Acme Learning"');
  });
});
