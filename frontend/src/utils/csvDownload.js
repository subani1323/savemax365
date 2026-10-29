/** Escape a single CSV cell value. */
function escapeCsvCell(value) {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build a CSV string from row arrays, or from a header row plus data rows.
 * @param {Array<string|number>} headersOrRows
 * @param {Array<Array<string|number>>} [dataRows]
 * @returns {string}
 */
export function buildCsv(headersOrRows, dataRows) {
  const rows =
    dataRows !== undefined
      ? [headersOrRows, ...dataRows]
      : headersOrRows;
  return (rows || [])
    .map((row) => (row || []).map(escapeCsvCell).join(","))
    .join("\r\n");
}

/**
 * Trigger a browser download of CSV text.
 * @param {string} filename
 * @param {string} csvContent
 */
export function downloadCsvFile(filename, csvContent) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "report.csv";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
