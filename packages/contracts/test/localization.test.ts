import { describe, expect, it } from "vitest";
import {
  LOCALE_COOKIE_NAME,
  MagicLinkRequestSchema,
  SupportedLocaleSchema,
  UpdateLocalePreferenceSchema,
  supportedLocales,
} from "../src/index.js";

describe("localization contracts", () => {
  it("publishes the initial EU and Asia locale allowlist", () => {
    expect(LOCALE_COOKIE_NAME).toBe("openround-locale");
    expect(supportedLocales).toEqual([
      "en-CA",
      "fr-FR",
      "de-DE",
      "es-ES",
      "it-IT",
      "pt-PT",
      "ja-JP",
      "ko-KR",
      "zh-CN",
      "zh-TW",
    ]);
    for (const locale of supportedLocales) {
      expect(SupportedLocaleSchema.parse(locale)).toBe(locale);
      expect(UpdateLocalePreferenceSchema.parse({ locale })).toEqual({ locale });
    }
  });

  it("rejects unsupported or non-canonical locale preferences", () => {
    for (const locale of ["en", "en-US", "fr-CA", "zh", "ar-SA", "not-a-locale"]) {
      expect(SupportedLocaleSchema.safeParse(locale).success).toBe(false);
      expect(UpdateLocalePreferenceSchema.safeParse({ locale }).success).toBe(false);
    }
  });

  it("rejects return paths containing URL-normalized control characters", () => {
    expect(
      MagicLinkRequestSchema.safeParse({
        email: "facilitator@example.com",
        segment: "workplace",
        acceptPolicies: true,
        returnTo: `/${String.fromCharCode(9)}/evil.example`,
      }).success,
    ).toBe(false);
  });
});
