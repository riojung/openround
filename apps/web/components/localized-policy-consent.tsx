"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useLocale } from "./locale-provider";

const TERMS_TOKEN = "__OPENROUND_TERMS__";
const PRIVACY_TOKEN = "__OPENROUND_PRIVACY__";

export function LocalizedPolicyConsent() {
  const { t } = useLocale();
  const parts = t("delivery.auth.policy", {
    terms: TERMS_TOKEN,
    privacy: PRIVACY_TOKEN,
  }).split(/(__OPENROUND_TERMS__|__OPENROUND_PRIVACY__)/);

  return (
    <span>
      {parts.map((part, index) => (
        <Fragment key={`${part}-${index}`}>
          {part === TERMS_TOKEN ? (
            <Link href="/terms">{t("delivery.site.terms")}</Link>
          ) : part === PRIVACY_TOKEN ? (
            <Link href="/privacy">{t("delivery.site.privacy")}</Link>
          ) : (
            part
          )}
        </Fragment>
      ))}
    </span>
  );
}
