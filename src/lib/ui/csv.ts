// Client-side CSV download. Values are quoted; the file opens cleanly in Excel and Sheets.
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const text = [cols.map(esc).join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
  const blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
