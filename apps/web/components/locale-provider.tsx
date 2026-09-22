"use client";

import type { SupportedLocale } from "@openround/contracts";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  englishMessages,
  loadDomainMessages,
  loadMessages,
  localeDomainsForPath,
  translate,
  type LocaleDomain,
  type MessageKey,
  type Messages,
} from "../lib/i18n/catalog";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  localeDirection,
} from "../lib/i18n/config";

interface LocaleContextValue {
  locale: SupportedLocale;
  changing: boolean;
  loadError: boolean;
  setLocale: (locale: SupportedLocale) => Promise<void>;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
}

const defaultValue: LocaleContextValue = {
  locale: DEFAULT_LOCALE,
  changing: false,
  loadError: false,
  setLocale: async () => undefined,
  t: (key, values) => translate(englishMessages, key, values),
};

const LocaleContext = createContext<LocaleContextValue>(defaultValue);

function applyDocumentLocale(locale: SupportedLocale) {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = localeDirection(locale);
}

function persistLocaleCookie(locale: SupportedLocale) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function LocaleProvider({
  initialLoadError = false,
  initialDomains = [],
  initialLocale,
  initialMessages,
  children,
}: Readonly<{
  initialDomains?: readonly LocaleDomain[];
  initialLocale: SupportedLocale;
  initialLoadError?: boolean;
  initialMessages: Messages;
  children: ReactNode;
}>) {
  const [locale, setActiveLocale] = useState(initialLocale);
  const [messages, setMessages] = useState(initialMessages);
  const [changing, setChanging] = useState(false);
  const [loadedDomains, setLoadedDomains] = useState<LocaleDomain[]>([...initialDomains]);
  const [loadError, setLoadError] = useState(initialLoadError);
  const pathname = usePathname();
  const changeSequence = useRef(0);
  const domainSequence = useRef(0);
  const requiredDomains = useMemo(() => localeDomainsForPath(pathname), [pathname]);
  const missingDomains = requiredDomains.filter((domain) => !loadedDomains.includes(domain));
  const missingDomainKey = missingDomains.join(",");

  useLayoutEffect(() => {
    applyDocumentLocale(initialLocale);
    if (!initialLoadError) persistLocaleCookie(initialLocale);
  }, [initialLoadError, initialLocale]);

  useEffect(() => {
    if (!missingDomainKey) return;
    const requestedDomains = missingDomainKey.split(",") as LocaleDomain[];
    const sequence = ++domainSequence.current;
    setLoadError(false);

    void loadDomainMessages(locale, requestedDomains)
      .catch(async () => {
        const fallback = await loadDomainMessages(DEFAULT_LOCALE, requestedDomains);
        if (sequence === domainSequence.current) setLoadError(true);
        return fallback;
      })
      .then((loaded) => {
        if (sequence !== domainSequence.current) return;
        setMessages((current) => ({ ...current, ...loaded }));
        setLoadedDomains((current) => [...new Set([...current, ...requestedDomains])]);
      });
  }, [locale, missingDomainKey]);

  const setLocale = useCallback(async (nextLocale: SupportedLocale) => {
    const sequence = ++changeSequence.current;
    ++domainSequence.current;
    setChanging(true);
    setLoadError(false);
    try {
      const nextDomains = localeDomainsForPath(window.location.pathname);
      const nextMessages = await loadMessages(nextLocale, nextDomains);
      if (sequence !== changeSequence.current) return;
      setMessages(nextMessages);
      setLoadedDomains(nextDomains);
      setActiveLocale(nextLocale);
      applyDocumentLocale(nextLocale);
      persistLocaleCookie(nextLocale);
    } catch (error) {
      if (sequence === changeSequence.current) setLoadError(true);
      throw error;
    } finally {
      if (sequence === changeSequence.current) setChanging(false);
    }
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      changing,
      loadError,
      setLocale,
      t: (key, values) => translate(messages, key, values),
    }),
    [changing, loadError, locale, messages, setLocale],
  );

  const domainsReady = missingDomains.length === 0;

  return (
    <LocaleContext.Provider value={value}>
      {domainsReady ? (
        children
      ) : (
        <div aria-busy="true" className="shell page-main" role="status">
          {translate(messages, "common.loading")}
        </div>
      )}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
