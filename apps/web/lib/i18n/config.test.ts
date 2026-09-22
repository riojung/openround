import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, localeFromAcceptLanguage, normalizeLocale, resolveLocale } from "./config";

describe("locale resolution", () => {
  it("canonicalizes supported regional and script variants", () => {
    expect(normalizeLocale("fr-CA")).toBe("fr-FR");
    expect(normalizeLocale("de_AT")).toBe("de-DE");
    expect(normalizeLocale("zh-Hant-HK")).toBe("zh-TW");
    expect(normalizeLocale("zh-SG")).toBe("zh-CN");
    expect(normalizeLocale("ja")).toBe("ja-JP");
  });

  it("rejects malformed, unsupported, wildcard, and oversized values", () => {
    expect(normalizeLocale("../../fr-FR")).toBeNull();
    expect(normalizeLocale("ar-SA")).toBeNull();
    expect(normalizeLocale("*")).toBeNull();
    expect(normalizeLocale("x".repeat(65))).toBeNull();
  });

  it("honours Accept-Language quality weights and stable source order", () => {
    expect(localeFromAcceptLanguage("en-GB;q=0.4, ja-JP;q=0.9, fr;q=0.7")).toBe("ja-JP");
    expect(localeFromAcceptLanguage("fr-BE;q=0.8, de-DE;q=0.8")).toBe("fr-FR");
    expect(localeFromAcceptLanguage("ar, *;q=0.5")).toBeNull();
  });

  it("uses account, cookie, browser, and default precedence", () => {
    expect(
      resolveLocale({
        accountLocale: "ko-KR",
        cookieLocale: "de-DE",
        acceptLanguage: "fr-FR",
      }),
    ).toBe("ko-KR");
    expect(resolveLocale({ cookieLocale: "de-DE", acceptLanguage: "fr-FR" })).toBe("de-DE");
    expect(resolveLocale({ cookieLocale: "invalid", acceptLanguage: "fr-FR" })).toBe("fr-FR");
    expect(resolveLocale({ acceptLanguage: "ar-SA" })).toBe(DEFAULT_LOCALE);
  });
});
