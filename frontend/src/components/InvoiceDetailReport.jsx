import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FaDownload, FaPrint } from "react-icons/fa";
import { toast } from "react-toastify";
import Navbar from "./Navbar";
import axiosInstance from "../config/axios";
import { buildCsv, downloadCsvFile } from "../utils/csvDownload";
import logo from "../Assets/logo3.jpg";
import {
  INVOICE_DETAIL_COLUMNS,
  INVOICE_DETAIL_STATUS_FILTER,
  buildInvoiceDetailRows,
  buildInvoiceDetailStatusBreakdown,
  formatInvoiceDetailPeriodLabel,
} from "../utils/invoiceDetailReportUtils";

const DEFAULT_COMPANY = "365 Realty Brokerage";
const REPORT_TITLE = "Invoice Detail Report";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const InvoiceDetailReport = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isFinancePage = pathname.startsWith("/finance-");

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [companyName, setCompanyName] = useState(DEFAULT_COMPANY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const profileRes = await axiosInstance
          .get("/company-profile")
          .catch(() => ({ data: null }));
        const name = profileRes?.data?.companyName;
        if (name) setCompanyName(name);
      } catch (err) {
        console.error(err);
      }
    };
    load();
  }, []);

  /** Main table: status filter only. Summary always uses the full date period. */
  const visibleRows = useMemo(() => {
    if (!statusFilter) return rows;
    return rows.filter((row) => row.status === statusFilter);
  }, [rows, statusFilter]);

  const periodLabel = formatInvoiceDetailPeriodLabel(fromDate, toDate);
  const periodTotal = rows.length;
  const statusBreakdown = useMemo(
    () => buildInvoiceDetailStatusBreakdown(rows),
    [rows],
  );

  const handleGenerate = async () => {
    if (!fromDate && !toDate) {
      toast.error("Select a from and/or to date for the period.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await axiosInstance.get("/trades");
      const trades = res.data || [];
      const built = buildInvoiceDetailRows(trades, fromDate, toDate, "");
      setRows(built);
      setShowReport(true);
      const matchCount = statusFilter
        ? built.filter((row) => row.status === statusFilter).length
        : built.length;
      if (!matchCount) {
        toast.info(
          statusFilter
            ? `No trades with status "${statusFilter}" in that period.`
            : "No trades with an entry date in that period.",
        );
      }
    } catch (err) {
      console.error(err);
      setError("Could not load trades for the invoice detail report.");
      toast.error("Could not load trades.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCsv = () => {
    const headers = INVOICE_DETAIL_COLUMNS.map((c) => c.label);
    const data = [
      ...visibleRows.map((row) =>
        INVOICE_DETAIL_COLUMNS.map((col) => row[col.key] ?? ""),
      ),
      [],
      ["Trades shown", String(periodTotal)],
      [],
      ["Trade counts by status", "Count"],
      ...statusBreakdown.map((row) => [row.status, String(row.count)]),
      ["Total", String(periodTotal)],
    ];
    const csv = buildCsv(headers, data);
    downloadCsvFile(
      `invoice-detail-report_${fromDate || "start"}_${toDate || "end"}.csv`,
      csv,
    );
  };

  const handlePrint = () => {
    const bodyRows = visibleRows
      .map((row) => {
        const cells = INVOICE_DETAIL_COLUMNS.map((col) => {
          const val = row[col.key] ?? "";
          return `<td>${escapeHtml(val)}</td>`;
        }).join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    const breakdownRows = statusBreakdown
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.status)}</td><td>${row.count}</td></tr>`,
      )
      .join("");

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(REPORT_TITLE)}</title>
  <style>
    @page { size: portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    html, body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 9px;
      color: #111;
      margin: 0;
      padding: 0;
      width: 100%;
    }
    .header {
      text-align: center;
      margin-bottom: 10px;
    }
    .header .logo {
      display: block;
      height: 48px;
      width: auto;
      margin: 0 auto 6px;
    }
    .company { font-size: 12px; font-weight: 700; }
    .title { font-size: 13px; font-weight: 700; margin-top: 2px; }
    .period { color: #444; margin-top: 2px; font-size: 9px; }
    .table-wrap {
      width: 100%;
      border: 1px solid #000;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: none;
    }
    th, td {
      border: 1px solid #000;
      padding: 3px 4px;
      text-align: left;
      vertical-align: top;
      word-wrap: break-word;
      overflow-wrap: anywhere;
      font-size: 9px;
      line-height: 1.25;
    }
    th {
      background: #f3f4f6;
      font-size: 8.5px;
      font-weight: 700;
    }
    .footer {
      margin-top: 10px;
      font-size: 10px;
      font-weight: 700;
    }
    .breakdown { margin-top: 12px; width: 360px; }
    .breakdown h3 { font-size: 11px; margin: 0 0 6px; }
    .breakdown table { table-layout: auto; width: 100%; }
    @media print {
      html, body { margin: 0; padding: 0; }
      .table-wrap { border: 1px solid #000 !important; }
      th, td { border: 1px solid #000 !important; }
    }
  </style>
</head>
<body>
  <div class="header">
    <img class="logo" src="${logo}" alt="Logo" />
    <div class="company">${escapeHtml(companyName)}</div>
    <div class="title">${escapeHtml(REPORT_TITLE)}</div>
    <div class="period">${escapeHtml(periodLabel || "Selected period")}</div>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          ${INVOICE_DETAIL_COLUMNS.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${bodyRows || `<tr><td colspan="${INVOICE_DETAIL_COLUMNS.length}">No rows</td></tr>`}
      </tbody>
    </table>
  </div>
  <div class="footer">Trades shown: ${periodTotal}</div>
  <div class="breakdown">
    <h3>Trade counts by status</h3>
    <table>
      <thead><tr><th>Status</th><th>Count</th></tr></thead>
      <tbody>
        ${breakdownRows || `<tr><td colspan="2">No data</td></tr>`}
        <tr><td><strong>Total</strong></td><td><strong>${periodTotal}</strong></td></tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;
    const w = window.open("", "_blank", "width=1200,height=900");
    if (!w) {
      toast.error("Pop-up blocked. Allow pop-ups to print.");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => {
      try {
        w.print();
      } catch (_) {}
    }, 300);
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Navbar />
      <div className="flex-1 p-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Invoice Detail Report
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Select an entry-date period (from / to), then print or download
                CSV.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                navigate(
                  isFinancePage ? "/finance" : "/financial-reports",
                )
              }
              className="text-sm text-blue-700 hover:underline"
            >
              ← Back to Reports
            </button>
          </div>

          <div className="bg-white rounded-lg shadow border border-gray-200 p-4 mb-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">
              Period selection
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  From (entry date)
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  To (entry date)
                </label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Status filter
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                >
                  {INVOICE_DETAIL_STATUS_FILTER.map((o) => (
                    <option key={o.value || "any"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={loading}
                  className="w-full sm:w-auto px-4 py-2 bg-blue-900 text-white rounded text-sm font-medium hover:bg-blue-800 disabled:opacity-60"
                >
                  {loading ? "Generating…" : "Generate report"}
                </button>
              </div>
            </div>
            {error ? (
              <p className="text-sm text-red-600 mt-3">{error}</p>
            ) : null}
          </div>

          {showReport ? (
            <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div className="text-center w-full sm:w-auto sm:text-left">
                  <img
                    src={logo}
                    alt="Company logo"
                    className="h-10 mx-auto sm:mx-0 mb-2"
                  />
                  <div className="text-sm font-semibold text-gray-500">
                    {companyName}
                  </div>
                  <h2 className="text-xl font-bold text-gray-900">
                    {REPORT_TITLE}
                  </h2>
                  <p className="text-sm text-gray-600">
                    {periodLabel || "Selected period"}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {visibleRows.length} row(s)
                    {statusFilter ? ` · filter: ${statusFilter}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center sm:justify-end w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleDownloadCsv}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded border border-gray-300 bg-white hover:bg-gray-50"
                  >
                    <FaDownload /> CSV
                  </button>
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded bg-blue-900 text-white hover:bg-blue-800"
                  >
                    <FaPrint /> Print
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-gray-200 rounded">
                <table className="min-w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-100 text-left">
                      {INVOICE_DETAIL_COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          className="border border-gray-200 px-2 py-2 font-semibold whitespace-nowrap"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={INVOICE_DETAIL_COLUMNS.length}
                          className="border px-3 py-6 text-center text-gray-500"
                        >
                          No trades in this period
                          {statusFilter
                            ? ` with status "${statusFilter}"`
                            : ""}
                          .
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((row) => (
                        <tr key={row.rowId} className="bg-white">
                          {INVOICE_DETAIL_COLUMNS.map((col) => (
                            <td
                              key={`${row.rowId}-${col.key}`}
                              className="border border-gray-200 px-2 py-1.5 align-top"
                            >
                              {row[col.key] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-sm font-semibold text-gray-800 mt-4">
                Trades shown: {periodTotal}
              </p>

              <div className="mt-4 max-w-md">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">
                  Trade counts by status
                </h3>
                <table className="min-w-full text-xs border-collapse border border-gray-200 rounded overflow-hidden">
                  <thead>
                    <tr className="bg-gray-100 text-left">
                      <th className="border border-gray-200 px-2 py-2 font-semibold">
                        Status
                      </th>
                      <th className="border border-gray-200 px-2 py-2 font-semibold">
                        Count
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {statusBreakdown.length === 0 ? (
                      <tr>
                        <td
                          colSpan={2}
                          className="border px-3 py-4 text-center text-gray-500"
                        >
                          No data
                        </td>
                      </tr>
                    ) : (
                      <>
                        {statusBreakdown.map((row) => (
                          <tr key={row.status} className="bg-white">
                            <td className="border border-gray-200 px-2 py-1.5">
                              {row.status}
                            </td>
                            <td className="border border-gray-200 px-2 py-1.5">
                              {row.count}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 font-semibold">
                          <td className="border border-gray-200 px-2 py-1.5">
                            Total
                          </td>
                          <td className="border border-gray-200 px-2 py-1.5">
                            {periodTotal}
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default InvoiceDetailReport;
