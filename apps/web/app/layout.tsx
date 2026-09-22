import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { ColorModeSync } from "../components/color-mode-sync";
import { LocaleProvider } from "../components/locale-provider";
import { COLOR_MODE_BOOTSTRAP_SCRIPT } from "../lib/color-mode";
import { loadMessagesWithFallback, localeDomainsForPath } from "../lib/i18n/catalog";
import { LOCALE_COOKIE_NAME, localeDirection, resolveLocale } from "../lib/i18n/config";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "OpenRound", template: "%s · OpenRound" },
  description:
    "Privacy-preserving comprehension recovery: ask, diagnose, intervene, recheck, and prove.",
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  await connection();
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const requestedLocale = resolveLocale({
    cookieLocale: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: requestHeaders.get("accept-language"),
  });
  const initialDomains = localeDomainsForPath(requestHeaders.get("x-openround-pathname") ?? "/");
  const { locale, messages, fellBack } = await loadMessagesWithFallback(
    requestedLocale,
    initialDomains,
  );
  return (
    <html
      data-color-mode="light"
      data-color-mode-preference="system"
      data-scroll-behavior="smooth"
      dir={localeDirection(locale)}
      lang={locale}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: COLOR_MODE_BOOTSTRAP_SCRIPT }} nonce={nonce} />
      </head>
      <body>
        <LocaleProvider
          initialDomains={initialDomains}
          initialLoadError={fellBack}
          initialLocale={locale}
          initialMessages={messages}
        >
          <ColorModeSync />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
