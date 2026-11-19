import type { Locale } from "@salon/shared";
import { zhCN, type MessageKey } from "./zh-CN.js";
import { ja } from "./ja.js";

export type { MessageKey };
export { zhCN, ja };

export const dictionaries: Record<Locale, Record<MessageKey, string>> = {
  "zh-CN": zhCN,
  ja,
};

/** 翻译函数：支持 {name} 占位符替换；缺词条时回退到 zh-CN，再回退到 key 本身。 */
export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const dict = dictionaries[locale] ?? zhCN;
  let text: string = dict[key] ?? zhCN[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

export function createTranslator(locale: Locale): Translator {
  return (key, params) => translate(locale, key, params);
}

/** 从浏览器/请求头协商语言：ja 优先匹配，其次 zh，默认 ja（日本市场） */
export function negotiateLocale(input: string | null | undefined): Locale {
  if (!input) return "ja";
  const lower = input.toLowerCase();
  if (lower.includes("zh")) return "zh-CN";
  if (lower.includes("ja")) return "ja";
  return "ja";
}
