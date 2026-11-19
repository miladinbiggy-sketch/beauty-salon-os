import { describe, expect, it } from "vitest";
import { csvCell, csvDocument } from "./export-csv";

describe("CSV export for Japanese Excel", () => {
  it("quotes commas, quotes, and line breaks", () => {
    expect(csvCell('佐藤, "美咲"\nVIP')).toBe('"佐藤, ""美咲""\nVIP"');
  });
  it("neutralizes formula-leading cells", () => {
    for (const input of ["=1+1", " +SUM(A1:A2)", "-5+3", "@SUM(1)", "\t=2"]) {
      expect(csvCell(input)).toMatch(/^"'/);
    }
  });
  it("keeps numeric negative refunds numeric", () => {
    expect(csvCell(-5000)).toBe('"-5000"');
  });
  it("keeps UTF-8 BOM and CRLF for Windows Excel", () => {
    const csv = csvDocument([["氏名", "金額"], ["田中", 5000]]);
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('"田中","5000"\r\n');
  });
});
