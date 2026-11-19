import { describe, expect, it } from "vitest";
import { dictionaries, negotiateLocale, translate } from "./index.js";
import { zhCN } from "./zh-CN.js";
import { ja } from "./ja.js";

describe("中日双语词条", () => {
  it("两种语言的 key 集合完全一致（无缺失、无多余）", () => {
    const zhKeys = Object.keys(zhCN).sort();
    const jaKeys = Object.keys(ja).sort();
    expect(jaKeys).toEqual(zhKeys);
  });

  it("所有词条非空", () => {
    for (const [k, v] of Object.entries(zhCN)) expect(v, `zh-CN ${k}`).toBeTruthy();
    for (const [k, v] of Object.entries(ja)) expect(v, `ja ${k}`).toBeTruthy();
  });

  it("占位符插值在两种语言下都工作", () => {
    expect(translate("zh-CN", "common.yen", { amount: 8000 })).toBe("¥8000");
    expect(translate("ja", "common.yen", { amount: 8000 })).toBe("¥8000");
    expect(translate("zh-CN", "common.minutes", { n: 60 })).toBe("60 分钟");
    expect(translate("ja", "common.minutes", { n: 60 })).toBe("60 分");
  });

  it("语言协商：zh → zh-CN，ja → ja，未知默认 ja", () => {
    expect(negotiateLocale("zh-CN,zh;q=0.9")).toBe("zh-CN");
    expect(negotiateLocale("ja-JP")).toBe("ja");
    expect(negotiateLocale("en-US")).toBe("ja");
    expect(negotiateLocale(null)).toBe("ja");
  });

  it("dictionaries 覆盖两种语言", () => {
    expect(Object.keys(dictionaries).sort()).toEqual(["ja", "zh-CN"]);
  });
});
