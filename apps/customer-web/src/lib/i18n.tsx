import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createTranslator, negotiateLocale, type MessageKey } from "@salon/i18n";
import { SUPPORTED_LOCALES, type Locale } from "@salon/shared";

const STORAGE_KEY = "salon.locale";

type TranslateFn = (key: MessageKey, params?: Record<string, string | number>) => string;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function initialLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && (SUPPORTED_LOCALES as readonly string[]).includes(saved)) {
      return saved as Locale;
    }
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return negotiateLocale(navigator.language);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 忽略 */
    }
    document.documentElement.lang = next === "zh-CN" ? "zh-CN" : "ja";
  }, []);

  const value = useMemo<LocaleContextValue>(() => {
    const translator = createTranslator(locale);
    return { locale, setLocale, t: (key, params) => translator(key, params) };
  }, [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within LocaleProvider");
  return ctx;
}
