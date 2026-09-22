import {
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  supportedLocales,
  type SupportedLocale,
} from "@openround/contracts";

export const DEFAULT_LOCALE: SupportedLocale = "en-CA";
export { LOCALE_COOKIE_MAX_AGE_SECONDS, LOCALE_COOKIE_NAME };

export interface LocaleOption {
  value: SupportedLocale;
  nativeLabel: string;
  previewLabel?: string;
  shortLabel: string;
  direction: "ltr" | "rtl";
}

export const localeOptions: readonly LocaleOption[] = [
  { value: "en-CA", nativeLabel: "English (Canada)", shortLabel: "EN", direction: "ltr" },
  {
    value: "fr-FR",
    nativeLabel: "Français",
    previewLabel: "Aperçu",
    shortLabel: "FR",
    direction: "ltr",
  },
  {
    value: "de-DE",
    nativeLabel: "Deutsch",
    previewLabel: "Vorschau",
    shortLabel: "DE",
    direction: "ltr",
  },
  {
    value: "es-ES",
    nativeLabel: "Español",
    previewLabel: "Vista previa",
    shortLabel: "ES",
    direction: "ltr",
  },
  {
    value: "it-IT",
    nativeLabel: "Italiano",
    previewLabel: "Anteprima",
    shortLabel: "IT",
    direction: "ltr",
  },
  {
    value: "pt-PT",
    nativeLabel: "Português",
    previewLabel: "Pré-visualização",
    shortLabel: "PT",
    direction: "ltr",
  },
  {
    value: "ja-JP",
    nativeLabel: "日本語",
    previewLabel: "プレビュー",
    shortLabel: "JA",
    direction: "ltr",
  },
  {
    value: "ko-KR",
    nativeLabel: "한국어",
    previewLabel: "미리보기",
    shortLabel: "KO",
    direction: "ltr",
  },
  {
    value: "zh-CN",
    nativeLabel: "简体中文",
    previewLabel: "预览",
    shortLabel: "简",
    direction: "ltr",
  },
  {
    value: "zh-TW",
    nativeLabel: "繁體中文",
    previewLabel: "預覽",
    shortLabel: "繁",
    direction: "ltr",
  },
] as const;

const exactLocales = new Map(
  supportedLocales.map((locale) => [locale.toLowerCase(), locale] as const),
);

const languageDefaults: Record<string, SupportedLocale> = {
  en: "en-CA",
  fr: "fr-FR",
  de: "de-DE",
  es: "es-ES",
  it: "it-IT",
  pt: "pt-PT",
  ja: "ja-JP",
  ko: "ko-KR",
  zh: "zh-CN",
};

export function normalizeLocale(value: string | null | undefined): SupportedLocale | null {
  if (!value || value.length > 64) return null;
  const normalized = value.trim().replaceAll("_", "-");
  if (!normalized || normalized === "*") return null;

  const exact = exactLocales.get(normalized.toLowerCase());
  if (exact) return exact;

  let canonical: Intl.Locale;
  try {
    canonical = new Intl.Locale(normalized);
  } catch {
    return null;
  }

  const language = canonical.language.toLowerCase();
  if (language === "zh") {
    const script = canonical.script?.toLowerCase();
    const region = canonical.region?.toUpperCase();
    return script === "hant" || ["TW", "HK", "MO"].includes(region ?? "") ? "zh-TW" : "zh-CN";
  }
  return languageDefaults[language] ?? null;
}

export function localeFromAcceptLanguage(value: string | null | undefined) {
  if (!value) return null;
  const candidates = value
    .split(",")
    .slice(0, 20)
    .map((entry, index) => {
      const [tag = "", ...parameters] = entry.trim().split(";");
      const qualityParameter = parameters.find((parameter) =>
        parameter.trim().toLowerCase().startsWith("q="),
      );
      const quality = qualityParameter ? Number.parseFloat(qualityParameter.trim().slice(2)) : 1;
      return {
        tag,
        quality: Number.isFinite(quality) ? Math.min(1, Math.max(0, quality)) : 0,
        index,
      };
    })
    .filter((candidate) => candidate.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate.tag);
    if (locale) return locale;
  }
  return null;
}

export function resolveLocale(input: {
  accountLocale?: string | null;
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
}): SupportedLocale {
  return (
    normalizeLocale(input.accountLocale) ??
    normalizeLocale(input.cookieLocale) ??
    localeFromAcceptLanguage(input.acceptLanguage) ??
    DEFAULT_LOCALE
  );
}

export function localeDirection(locale: SupportedLocale) {
  return localeOptions.find((option) => option.value === locale)?.direction ?? "ltr";
}
