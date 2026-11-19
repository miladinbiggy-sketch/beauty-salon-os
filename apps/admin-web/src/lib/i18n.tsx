import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createTranslator, type MessageKey, type Translator } from "@salon/i18n";
import type { Locale } from "@salon/shared";

const LOCALE_KEY = "salon_admin_locale";

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Translator;
}

const Ctx = createContext<I18nCtx | null>(null);

function initialLocale(): Locale {
  const saved = localStorage.getItem(LOCALE_KEY);
  if (saved === "zh-CN" || saved === "ja") return saved;
  return "ja"; // 日本市场默认日文
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const value = useMemo<I18nCtx>(
    () => ({
      locale,
      setLocale: (l: Locale) => {
        localStorage.setItem(LOCALE_KEY, l);
        setLocaleState(l);
      },
      t: createTranslator(locale),
    }),
    [locale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n outside LocaleProvider");
  return ctx;
}

/** 双语名称按当前语言取（ja 优先 nameJa，zh 优先 nameZh） */
export function localizedName(locale: Locale, nameZh: string, nameJa: string): string {
  return locale === "ja" ? nameJa : nameZh;
}

export type { MessageKey };
