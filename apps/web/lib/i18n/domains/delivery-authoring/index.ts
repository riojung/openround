import type { SupportedLocale } from "@openround/contracts";
import deliveryAuthoringEnglishMessages, { type DeliveryAuthoringMessages } from "./en-CA";

const loaders: Record<SupportedLocale, () => Promise<{ default: DeliveryAuthoringMessages }>> = {
  "en-CA": async () => ({ default: deliveryAuthoringEnglishMessages }),
  "fr-FR": () => import("./fr-FR"),
  "de-DE": () => import("./de-DE"),
  "es-ES": () => import("./es-ES"),
  "it-IT": () => import("./it-IT"),
  "pt-PT": () => import("./pt-PT"),
  "ja-JP": () => import("./ja-JP"),
  "ko-KR": () => import("./ko-KR"),
  "zh-CN": () => import("./zh-CN"),
  "zh-TW": () => import("./zh-TW"),
};

export async function loadDeliveryAuthoringMessages(locale: SupportedLocale) {
  return (await loaders[locale]()).default;
}

export { deliveryAuthoringEnglishMessages };
export type { DeliveryAuthoringMessageKey, DeliveryAuthoringMessages } from "./en-CA";
