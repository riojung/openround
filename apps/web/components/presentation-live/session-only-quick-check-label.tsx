"use client";

import { useLocale } from "../locale-provider";

export function SessionOnlyQuickCheckLabel({ sessionOnly }: { sessionOnly?: "quick_check" }) {
  const { t } = useLocale();
  if (sessionOnly !== "quick_check") return null;
  return <p className="muted">{t("live.presentationReport.sessionOnlyQuickCheck")}</p>;
}
