import type { SupportedLocale } from "@openround/contracts";

export function formatDate(
  locale: SupportedLocale,
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  return new Intl.DateTimeFormat(locale, options).format(
    value instanceof Date ? value : new Date(value),
  );
}

export function formatDateTime(
  locale: SupportedLocale,
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
) {
  return formatDate(locale, value, options);
}

export function formatNumber(
  locale: SupportedLocale,
  value: number,
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatList(
  locale: SupportedLocale,
  values: readonly string[],
  options: Intl.ListFormatOptions = { style: "long", type: "conjunction" },
) {
  return new Intl.ListFormat(locale, options).format(values);
}

export function pluralCategory(locale: SupportedLocale, value: number) {
  return new Intl.PluralRules(locale).select(value);
}
