/** Excel-compatible UTF-8 CSV. Escape both quotes/newlines and formula-leading cells. */
export function csvCell(value: string | number | null | undefined): string {
  // Numeric values (including legitimate negative refunds) must remain numbers in Excel.
  if (typeof value === "number" && Number.isFinite(value)) return '"' + value.toString() + '"';
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function csvDocument(rows: (string | number | null | undefined)[][]): string {
  return "\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function saveCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const blob = new Blob([csvDocument(rows)], {type: "text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
