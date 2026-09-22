"use client";

import Link from "next/link";
import { useLocale } from "./locale-provider";

export function SiteFooter() {
  const { t } = useLocale();
  return (
    <footer className="footer">
      <div className="shell footer-inner">
        <span>{t("delivery.site.project", { year: new Date().getFullYear() })}</span>
        <nav className="button-row" aria-label={t("delivery.site.legalLinks")}>
          <Link href="/privacy">{t("delivery.site.privacy")}</Link>
          <Link href="/terms">{t("delivery.site.terms")}</Link>
          <Link href="/status">{t("delivery.site.status")}</Link>
        </nav>
      </div>
    </footer>
  );
}
