import {
  PROGRESS_REPORT_COLUMNS,
  buildProgressReportRows,
} from "./progressReportUtils";
import logo from "../Assets/logo3.jpg";

const COMPANY = "365 Realty Brokerage";
const REPORT_TITLE = "Progress Report";
/** Calibrated for portrait print — table + footer only (no forced page height). */
const ROWS_FIRST_PAGE = 52;
const ROWS_CONTINUATION_PAGE = 58;

const chunkRowsForPrint = (rows) => {
  if (!rows.length) return [];
  const chunks = [];
  chunks.push(rows.slice(0, ROWS_FIRST_PAGE));
  let i = ROWS_FIRST_PAGE;
  while (i < rows.length) {
    chunks.push(rows.slice(i, i + ROWS_CONTINUATION_PAGE));
    i += ROWS_CONTINUATION_PAGE;
  }
  return chunks;
};

/**
 * Open portrait print window from report rows (e.g. after editing in the modal).
 */
export function openProgressReportPrintWindowFromRows(rows, options = {}) {
  const { reportSubtitle = "" } = options;
  const reportRows = rows || [];
  const generatedOn = new Date().toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const safe = (v) =>
    String(v ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const colgroup = PROGRESS_REPORT_COLUMNS.map((col) => {
    const widths = {
      tradeCategory: "5%",
      tradeNumber: "3.5%",
      address: "8%",
      closingDate: "4.5%",
      status: "4%",
      tradeClass: "6%",
      agentName: "7%",
      complianceStatus: "4%",
      invoiceDate: "4.5%",
      openTRSDate: "4.5%",
      closedTRSDate: "4.5%",
      price: "4%",
      arAmount: "4%",
      invoiceAmount: "4.5%",
      outsideBroker: "7%",
      paymentReceivedDate: "5%",
      paymentToAgentsDate: "5%",
      followUpDate: "4.5%",
      action: "4.5%",
      notes: "10%",
    };
    const w = widths[col.key] || "4%";
    return `<col style="width:${w}" />`;
  }).join("");

  const tableHead = `
    <thead><tr>
      ${PROGRESS_REPORT_COLUMNS.map((col) => `<th>${safe(col.label)}</th>`).join("")}
    </tr></thead>`;

  const invoicePrintStyle = (kind) => {
    if (kind === "received") {
      return "background:#e0f2fe;color:#0c4a6e;";
    }
    return "";
  };

  const rowToHtml = (r) => `
    <tr>
      ${PROGRESS_REPORT_COLUMNS.map((col) => {
        if (col.key === "invoiceDate") {
          return `<td class="col-${col.key}" style="${invoicePrintStyle(r.invoiceDateKind)}">${safe(r[col.key] ?? "")}</td>`;
        }
        return `<td class="col-${col.key}">${safe(r[col.key] ?? "")}</td>`;
      }).join("")}
    </tr>`;

  const pageChunks =
    reportRows.length > 0 ? chunkRowsForPrint(reportRows) : [];
  const totalPages = Math.max(pageChunks.length, 1);

  const pagesHtml =
    pageChunks.length > 0
      ? pageChunks
          .map((pageRows, pageIndex) => {
            const pageNum = pageIndex + 1;
            const isLast = pageIndex === pageChunks.length - 1;
            return `
          <div class="print-page">
            ${
              pageIndex === 0
                ? `<div class="header">
              <img class="logo" src="${logo}" alt="" />
              <div class="company">${safe(COMPANY)}</div>
              <div class="title">${safe(REPORT_TITLE)}</div>
              <div class="meta">Generated ${safe(generatedOn)} · ${reportRows.length} trade${reportRows.length === 1 ? "" : "s"}${reportSubtitle ? ` · ${safe(reportSubtitle)}` : ""}</div>
            </div>`
                : `<div class="page-header-mini">
              <div class="company">${safe(COMPANY)}</div>
              <div class="title">${safe(REPORT_TITLE)}</div>
            </div>`
            }
            <table>
              <colgroup>${colgroup}</colgroup>
              ${tableHead}
              <tbody>
                ${pageRows.map(rowToHtml).join("")}
              </tbody>
            </table>
            <div class="page-footer">
              Page ${pageNum} total — ${pageRows.length} trade${pageRows.length === 1 ? "" : "s"}
              ${isLast && totalPages > 1 ? ` · Report total — ${reportRows.length} trades` : ""}
            </div>
          </div>`;
          })
          .join("")
      : `<div class="print-page"><table><colgroup>${colgroup}</colgroup>${tableHead}<tbody><tr><td colspan="${PROGRESS_REPORT_COLUMNS.length}" class="empty">No trades found.</td></tr></tbody></table></div>`;

  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) return false;

  w.document.write(`
    <html>
      <head>
        <title>${REPORT_TITLE}</title>
        <style>
          @page {
            size: portrait;
            margin: 14mm 6mm 8mm 6mm;
          }
          * { box-sizing: border-box; }
          body {
            font-family: Arial, sans-serif;
            font-size: 7px;
            color: #111;
            margin: 0;
          }
          .header {
            text-align: center;
            margin-bottom: 5px;
            padding-top: 4mm;
          }
          .header .company { font-weight: 700; font-size: 11px; margin-top: 2px; }
          .header .title { font-weight: 700; font-size: 12px; margin-top: 2px; }
          .header .meta { font-size: 8px; margin-top: 2px; color: #333; }
          .logo { max-height: 30px; display: block; margin: 0 auto 2px; }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 6.5px;
          }
          th, td {
            border: 1px solid #999;
            padding: 1px 2px;
            vertical-align: top;
            overflow-wrap: break-word;
            line-height: 1.12;
          }
          th {
            background: #f2f2f2;
            text-align: left;
            font-size: 6px;
          }
          td.col-price,
          td.col-arAmount,
          td.col-invoiceAmount { text-align: right; white-space: nowrap; }
          td.empty { text-align: center; padding: 12px; }
          .print-page {
            page-break-after: always;
          }
          .print-page:last-child { page-break-after: auto; }
          .page-header-mini {
            text-align: center;
            margin-bottom: 3px;
            padding-top: 2mm;
            font-size: 8px;
          }
          .page-header-mini .company { font-weight: 700; }
          .page-footer {
            margin-top: 3px;
            padding-top: 3px;
            font-weight: 700;
            font-size: 7px;
            text-align: right;
            border-top: 2px solid #666;
          }
          .print-btn { margin: 10px; }
          @media print {
            .print-btn { display: none; }
            .header { padding-top: 0; }
          }
        </style>
      </head>
      <body>
        ${pagesHtml}
        <button class="print-btn" type="button" onclick="window.print()">Print</button>
      </body>
    </html>
  `);
  w.document.close();
  w.focus();
  w.print();
  return true;
}

/** Build rows from trades, then open print window. */
export function openProgressReportPrintWindow(trades, options = {}) {
  return openProgressReportPrintWindowFromRows(
    buildProgressReportRows(trades),
    options,
  );
}
