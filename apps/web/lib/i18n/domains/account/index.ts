import type { SupportedLocale } from "@openround/contracts";
import { accountEnglishMessages, type AccountMessages } from "./en-CA";

const loaders: Record<SupportedLocale, () => Promise<AccountMessages>> = {
  "en-CA": async () => accountEnglishMessages,
  "fr-FR": async () => (await import("./fr-FR")).default,
  "de-DE": async () => (await import("./de-DE")).default,
  "es-ES": async () => (await import("./es-ES")).default,
  "it-IT": async () => (await import("./it-IT")).default,
  "pt-PT": async () => (await import("./pt-PT")).default,
  "ja-JP": async () => (await import("./ja-JP")).default,
  "ko-KR": async () => (await import("./ko-KR")).default,
  "zh-CN": async () => (await import("./zh-CN")).default,
  "zh-TW": async () => (await import("./zh-TW")).default,
};

export function loadAccountMessages(locale: SupportedLocale) {
  return loaders[locale]();
}

export { accountEnglishMessages };
export type { AccountMessageKey, AccountMessages } from "./en-CA";
